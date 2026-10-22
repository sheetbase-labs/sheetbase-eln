-- ---------------------------------------------------------------------------
-- Pipeline scheduling: cron triggers, input bindings, missed-run policy and a
-- per-trigger activity log.
--
-- A trigger's spec (jsonb) now carries, beside the kind's own fields:
--   inputs          { <input name>: {mode: pinned|latest|incremental, ...} }
--   missedRunPolicy run_once | skip
-- `pinned` reads one fixed Dataset Version (the old inputVersions behaviour),
-- `latest` reads the Dataset's newest version when the run starts, and
-- `incremental` is `latest` that only runs when the Dataset has a version
-- newer than the one this trigger last processed (api.pipeline_schedules
-- .input_watermarks). The sweep resolves bindings; this migration validates
-- them where every create and update passes.
--
-- Also fixed: an event trigger started its cursor at zero, so a new trigger
-- replayed every historical event. It now starts from the workspace's current
-- change sequence, and resuming a paused trigger honours its missed-run policy.
-- ---------------------------------------------------------------------------

ALTER TABLE api.pipeline_schedules DROP CONSTRAINT chk_pipeline_schedules_kind;
--> statement-breakpoint
ALTER TABLE api.pipeline_schedules ADD CONSTRAINT chk_pipeline_schedules_kind
  CHECK (kind IN ('interval', 'daily', 'cron', 'event'));
--> statement-breakpoint
ALTER TABLE api.pipeline_schedules
  ADD COLUMN input_watermarks jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT chk_pipeline_schedules_watermarks
    CHECK (jsonb_typeof(input_watermarks) = 'object');
--> statement-breakpoint

-- Watermark moves are the sweep's bookkeeping, not a user change.
CREATE OR REPLACE FUNCTION internal.trg_change_event_connector()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity text;
  v_op text;
  v_payload jsonb;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  IF v_entity = 'pipeline_schedule' AND TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD) - 'metadata' - 'next_run_at' - 'last_run_at'
      - 'last_evaluated_at' - 'last_evaluated_sequence' - 'input_watermarks'
      - 'updated_at';
    v_after := to_jsonb(NEW) - 'metadata' - 'next_run_at' - 'last_run_at'
      - 'last_evaluated_at' - 'last_evaluated_sequence' - 'input_watermarks'
      - 'updated_at';
    IF v_before = v_after THEN
      RETURN NULL;
    END IF;
  END IF;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    v_entity,
    COALESCE(NEW.id, OLD.id),
    v_op,
    NULL,
    NULL,
    v_payload
  );
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Activity: what a trigger did instead of starting a run. Runs themselves are
-- the run history (pipeline_runs.schedule_id); this records the occurrences
-- that never became a run, so "why did nothing happen at 09:00" has an answer.
-- ---------------------------------------------------------------------------
CREATE TABLE api.pipeline_schedule_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES api.pipeline_schedules(id) ON DELETE CASCADE,
  kind text NOT NULL,
  occurrence_id text,
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pipeline_schedule_activity_kind CHECK (kind IN (
    'skipped_missed', 'skipped_unchanged', 'skipped_overlap',
    'skipped_no_version', 'input_unresolved', 'start_failed'
  )),
  CONSTRAINT chk_pipeline_schedule_activity_detail CHECK (jsonb_typeof(detail) = 'object')
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_schedule_activity_schedule
  ON api.pipeline_schedule_activity(schedule_id, occurred_at DESC);
--> statement-breakpoint
GRANT SELECT ON api.pipeline_schedule_activity TO authenticated;
--> statement-breakpoint
ALTER TABLE api.pipeline_schedule_activity ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_schedule_activity_select ON api.pipeline_schedule_activity
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Cron. api.pipeline_cron_field expands one field to its sorted values;
-- api.pipeline_cron_next finds the next instant on an explicit zone's wall
-- clock. Mirrors src/lib/pipeline-cron.ts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.pipeline_cron_field(p_field text, p_min integer, p_max integer)
RETURNS integer[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_out integer[] := '{}'::integer[];
  v_part text;
  v_match text[];
  v_step integer;
  v_lo integer;
  v_hi integer;
BEGIN
  FOREACH v_part IN ARRAY string_to_array(p_field, ',') LOOP
    v_match := regexp_match(v_part, '^(\*|[0-9]{1,3}(?:-[0-9]{1,3})?)(?:/([1-9][0-9]{0,2}))?$');
    IF v_match IS NULL THEN
      RAISE EXCEPTION 'invalid cron field' USING ERRCODE = 'SB034';
    END IF;
    v_step := COALESCE(v_match[2]::integer, 1);
    IF v_match[1] = '*' THEN
      v_lo := p_min;
      v_hi := p_max;
    ELSIF position('-' IN v_match[1]) > 0 THEN
      v_lo := split_part(v_match[1], '-', 1)::integer;
      v_hi := split_part(v_match[1], '-', 2)::integer;
    ELSE
      v_lo := v_match[1]::integer;
      v_hi := CASE WHEN v_match[2] IS NULL THEN v_lo ELSE p_max END;
    END IF;
    IF v_lo < p_min OR v_hi > p_max OR v_lo > v_hi THEN
      RAISE EXCEPTION 'invalid cron field' USING ERRCODE = 'SB034';
    END IF;
    v_out := v_out || ARRAY(SELECT g FROM generate_series(v_lo, v_hi, v_step) g);
  END LOOP;
  RETURN ARRAY(SELECT DISTINCT x FROM unnest(v_out) x ORDER BY x);
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.pipeline_cron_next(p_expr text, p_tz text, p_from timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parts text[];
  v_minutes integer[];
  v_hours integer[];
  v_doms integer[];
  v_months integer[];
  v_dows integer[];
  v_any_dom boolean;
  v_any_dow boolean;
  v_tz text := COALESCE(p_tz, 'UTC');
  v_first date;
  v_day date;
  v_dom_ok boolean;
  v_dow_ok boolean;
  v_hour integer;
  v_minute integer;
  v_at timestamptz;
BEGIN
  v_parts := regexp_split_to_array(btrim(p_expr), '\s+');
  IF array_length(v_parts, 1) IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'invalid cron expression' USING ERRCODE = 'SB034';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    RAISE EXCEPTION 'invalid schedule time zone' USING ERRCODE = 'SB034';
  END IF;
  v_minutes := api.pipeline_cron_field(v_parts[1], 0, 59);
  v_hours := api.pipeline_cron_field(v_parts[2], 0, 23);
  v_doms := api.pipeline_cron_field(v_parts[3], 1, 31);
  v_months := api.pipeline_cron_field(v_parts[4], 1, 12);
  -- Day of week is 0-7 with 0 and 7 both Sunday.
  v_dows := ARRAY(SELECT DISTINCT d % 7 FROM unnest(api.pipeline_cron_field(v_parts[5], 0, 7)) d ORDER BY 1);
  v_any_dom := left(v_parts[3], 1) = '*';
  v_any_dow := left(v_parts[5], 1) = '*';

  v_first := (p_from AT TIME ZONE v_tz)::date;
  FOR i IN 0..1500 LOOP
    v_day := v_first + i;
    IF NOT (extract(month FROM v_day)::integer = ANY(v_months)) THEN
      CONTINUE;
    END IF;
    v_dom_ok := extract(day FROM v_day)::integer = ANY(v_doms);
    v_dow_ok := extract(dow FROM v_day)::integer = ANY(v_dows);
    IF NOT (
      CASE
        WHEN v_any_dom AND v_any_dow THEN true
        WHEN v_any_dom THEN v_dow_ok
        WHEN v_any_dow THEN v_dom_ok
        ELSE v_dom_ok OR v_dow_ok
      END
    ) THEN
      CONTINUE;
    END IF;
    FOREACH v_hour IN ARRAY v_hours LOOP
      FOREACH v_minute IN ARRAY v_minutes LOOP
        v_at := (v_day + make_time(v_hour, v_minute, 0)) AT TIME ZONE v_tz;
        IF v_at > p_from THEN
          RETURN v_at;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RAISE EXCEPTION 'cron expression never fires' USING ERRCODE = 'SB034';
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_cron_field(text, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION api.pipeline_cron_next(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_cron_next(text, text, timestamptz) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.pipeline_schedule_next_run(p_kind text, p_spec jsonb, p_from timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at_local timestamp;
  v_tz text;
  v_from_local timestamp;
BEGIN
  IF p_kind = 'interval' THEN
    IF jsonb_typeof(p_spec->'intervalMinutes') <> 'number'
       OR (p_spec->>'intervalMinutes') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid interval schedule' USING ERRCODE = 'SB034';
    END IF;
    RETURN p_from + make_interval(mins => (p_spec->>'intervalMinutes')::int);
  ELSIF p_kind = 'daily' THEN
    IF jsonb_typeof(p_spec->'dailyAt') <> 'string'
       OR p_spec->>'dailyAt' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'invalid daily schedule' USING ERRCODE = 'SB034';
    END IF;
    -- Explicit IANA time zone (default UTC); never the DB/server session
    -- time zone, so behaviour is deployment-independent and deterministic.
    v_tz := COALESCE(p_spec->>'timeZone', 'UTC');
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
      RAISE EXCEPTION 'invalid schedule time zone' USING ERRCODE = 'SB034';
    END IF;
    v_from_local := p_from AT TIME ZONE v_tz;
    v_at_local := date_trunc('day', v_from_local) + (p_spec->>'dailyAt')::time;
    IF v_at_local <= v_from_local THEN
      v_at_local := v_at_local + interval '1 day';
    END IF;
    RETURN v_at_local AT TIME ZONE v_tz;
  ELSIF p_kind = 'cron' THEN
    IF jsonb_typeof(p_spec->'cron') <> 'string' THEN
      RAISE EXCEPTION 'invalid cron schedule' USING ERRCODE = 'SB034';
    END IF;
    RETURN api.pipeline_cron_next(p_spec->>'cron', p_spec->>'timeZone', p_from);
  ELSIF p_kind = 'event' THEN
    -- Event schedules are evaluated by the server sweep, not wall-clock.
    RETURN NULL;
  ELSE
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Spec validation: bindings, missed-run policy, parameters. Event specs also
-- pass through the event validator. Returns the spec to store.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.validate_pipeline_schedule_spec(
  p_workspace_id uuid,
  p_kind text,
  p_spec jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_spec jsonb := p_spec;
  v_policy jsonb;
  v_name text;
  v_binding jsonb;
BEGIN
  IF v_spec IS NULL OR jsonb_typeof(v_spec) <> 'object' THEN
    RAISE EXCEPTION 'schedule spec must be an object' USING ERRCODE = 'SB034';
  END IF;
  v_policy := v_spec->'missedRunPolicy';
  IF v_policy IS NOT NULL AND v_policy <> 'null'::jsonb
     AND (jsonb_typeof(v_policy) <> 'string'
          OR (v_spec->>'missedRunPolicy') NOT IN ('run_once', 'skip')) THEN
    RAISE EXCEPTION 'invalid missed-run policy' USING ERRCODE = 'SB034';
  END IF;
  IF v_spec->'parameters' IS NOT NULL
     AND v_spec->'parameters' <> 'null'::jsonb
     AND jsonb_typeof(v_spec->'parameters') <> 'object' THEN
    RAISE EXCEPTION 'schedule parameters must be an object' USING ERRCODE = 'SB034';
  END IF;
  IF v_spec->'inputs' IS NOT NULL AND v_spec->'inputs' <> 'null'::jsonb THEN
    IF jsonb_typeof(v_spec->'inputs') <> 'object' THEN
      RAISE EXCEPTION 'schedule inputs must be an object' USING ERRCODE = 'SB034';
    END IF;
    FOR v_name, v_binding IN SELECT entry.key, entry.value FROM jsonb_each(v_spec->'inputs') entry LOOP
      IF v_name !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        RAISE EXCEPTION 'invalid input name: %', v_name USING ERRCODE = 'SB034';
      END IF;
      IF jsonb_typeof(v_binding) <> 'object' THEN
        RAISE EXCEPTION 'input % needs a binding', v_name USING ERRCODE = 'SB034';
      END IF;
      IF v_binding->>'mode' = 'pinned' THEN
        IF jsonb_typeof(v_binding->'versionId') <> 'string'
           OR (v_binding->>'versionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR NOT EXISTS (
             SELECT 1 FROM api.dataset_versions
              WHERE id = (v_binding->>'versionId')::uuid
                AND workspace_id = p_workspace_id
           ) THEN
          RAISE EXCEPTION 'input % must pin an existing Dataset Version', v_name
            USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_binding->>'mode' IN ('latest', 'incremental') THEN
        IF jsonb_typeof(v_binding->'datasetId') <> 'string'
           OR (v_binding->>'datasetId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR NOT EXISTS (
             SELECT 1 FROM api.datasets
              WHERE id = (v_binding->>'datasetId')::uuid
                AND workspace_id = p_workspace_id
           ) THEN
          RAISE EXCEPTION 'input % must name an existing Dataset', v_name
            USING ERRCODE = 'SB034';
        END IF;
        IF v_binding->>'mode' = 'incremental' AND p_kind = 'event' THEN
          RAISE EXCEPTION 'input %: an event trigger already runs only on new data', v_name
            USING ERRCODE = 'SB034';
        END IF;
      ELSE
        RAISE EXCEPTION 'input % has an unknown mode', v_name USING ERRCODE = 'SB034';
      END IF;
    END LOOP;
  END IF;
  IF p_kind = 'event' THEN
    v_spec := api.validate_pipeline_event_spec(v_spec);
  END IF;
  RETURN v_spec;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.validate_pipeline_schedule_spec(uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- create / update: shared validation, cron, and a sane event cursor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.create_pipeline_schedule(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_kind text,
  p_spec jsonb,
  p_enabled boolean DEFAULT true
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_definition api.pipeline_definitions;
  v_spec jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_kind NOT IN ('interval', 'daily', 'cron', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  v_spec := api.validate_pipeline_schedule_spec(p_workspace_id, p_kind, p_spec);
  INSERT INTO api.pipeline_schedules(
    workspace_id, definition_id, kind, spec, enabled, next_run_at,
    last_evaluated_sequence, created_by_user_id
  ) VALUES (
    p_workspace_id, p_definition_id, p_kind, v_spec, p_enabled,
    api.pipeline_schedule_next_run(p_kind, v_spec, now()),
    -- A new event trigger watches what happens from now on; it does not
    -- replay the workspace's history.
    CASE WHEN p_kind = 'event' THEN COALESCE((
      SELECT max(sequence) FROM api.change_events WHERE workspace_id = p_workspace_id
    ), 0) END,
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_pipeline_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_kind text DEFAULT NULL,
  p_spec jsonb DEFAULT NULL,
  p_enabled boolean DEFAULT NULL
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_kind text;
  v_spec jsonb;
  v_resuming boolean;
  v_fast_forward boolean;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_schedules
   WHERE id = p_schedule_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline schedule not found' USING ERRCODE = 'SB036';
  END IF;
  v_kind := COALESCE(p_kind, v.kind);
  IF v_kind NOT IN ('interval', 'daily', 'cron', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  v_spec := api.validate_pipeline_schedule_spec(
    p_workspace_id, v_kind, COALESCE(p_spec, v.spec)
  );
  v_resuming := p_enabled IS TRUE AND NOT v.enabled;
  -- An event trigger resumed (or switched to events) under the skip policy
  -- ignores what happened while it was off; under run_once the waiting events
  -- are processed.
  v_fast_forward := v_kind = 'event' AND (
    v.kind <> 'event'
    OR (v_resuming AND COALESCE(v_spec->>'missedRunPolicy', 'run_once') = 'skip')
  );
  UPDATE api.pipeline_schedules SET
    kind = v_kind,
    spec = v_spec,
    enabled = COALESCE(p_enabled, enabled),
    next_run_at = api.pipeline_schedule_next_run(v_kind, v_spec, now()),
    last_evaluated_sequence = CASE
      WHEN v_fast_forward THEN COALESCE((
        SELECT max(sequence) FROM api.change_events WHERE workspace_id = p_workspace_id
      ), 0)
      ELSE last_evaluated_sequence
    END,
    updated_at = now()
  WHERE id = p_schedule_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
