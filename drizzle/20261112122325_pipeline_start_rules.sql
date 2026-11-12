-- Pipelines: the Starts and runs tab.
--
-- A pipeline's starts (new snapshots, a webhook, schedules) stay as they are.
-- What is new is the rule set that sits across all of them, stored on the
-- pipeline itself as `start_rules`:
--
--   { "conditionsMatch": "all" | "any",
--     "window":     null | { "days": "daily" | "weekdays" | "weekends",
--                            "from": "07:00", "to": "19:00",
--                            "timeZone": "Europe/London" },
--     "minNewRows": null | 1..1000000,
--     "waitMinutes": 0..1440,          -- wait after the last event, to batch
--     "whileRunning": "skip",          -- what a start does while a run goes
--     "missedRuns": "run_once" | "skip" }
--
-- An empty object means "no extra rules": every start starts a run, as before.
-- The scheduler and the webhook read the rules; the app writes them through
-- api.set_pipeline_start_rules, which is also the API, MCP and assistant door.
--
-- The activity log grows from "why a start did not run" into "what each start
-- did": started, batched, skipped (unchanged, overlap, condition), missed.
-- Rows can now belong to a pipeline without a schedule (a webhook call), say
-- where the start came from and link to the run it began.

ALTER TABLE api.pipeline_definitions
  ADD COLUMN start_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint

ALTER TABLE api.pipeline_definitions
  ADD CONSTRAINT chk_pipeline_definitions_start_rules
  CHECK (jsonb_typeof(start_rules) = 'object');
--> statement-breakpoint

CREATE FUNCTION internal.normalise_pipeline_start_rules(p_rules jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $$
DECLARE
  v_window jsonb;
  v_days text;
  v_from text;
  v_to text;
  v_zone text;
  v_min jsonb;
  v_wait jsonb;
  v_match text;
  v_running text;
  v_missed text;
  v_out jsonb := '{}'::jsonb;
BEGIN
  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RAISE EXCEPTION 'start rules must be an object' USING ERRCODE = 'SB034';
  END IF;
  IF p_rules = '{}'::jsonb THEN
    RETURN v_out;
  END IF;

  v_match := COALESCE(p_rules->>'conditionsMatch', 'all');
  IF v_match NOT IN ('all', 'any') THEN
    RAISE EXCEPTION 'conditionsMatch must be all or any' USING ERRCODE = 'SB034';
  END IF;

  v_window := p_rules->'window';
  IF v_window IS NOT NULL AND v_window <> 'null'::jsonb THEN
    IF jsonb_typeof(v_window) <> 'object' THEN
      RAISE EXCEPTION 'the time window must be an object' USING ERRCODE = 'SB034';
    END IF;
    v_days := COALESCE(v_window->>'days', 'daily');
    v_from := v_window->>'from';
    v_to := v_window->>'to';
    v_zone := COALESCE(v_window->>'timeZone', 'UTC');
    IF v_days NOT IN ('daily', 'weekdays', 'weekends') THEN
      RAISE EXCEPTION 'the window days must be daily, weekdays or weekends'
        USING ERRCODE = 'SB034';
    END IF;
    IF v_from IS NULL OR v_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR v_to IS NULL OR v_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'the window opens and closes at HH:MM' USING ERRCODE = 'SB034';
    END IF;
    IF v_from >= v_to THEN
      RAISE EXCEPTION 'the window must open before it closes' USING ERRCODE = 'SB034';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_zone) THEN
      RAISE EXCEPTION 'unknown time zone: %', v_zone USING ERRCODE = 'SB034';
    END IF;
    v_out := v_out || jsonb_build_object('window', jsonb_build_object(
      'days', v_days, 'from', v_from, 'to', v_to, 'timeZone', v_zone));
  ELSE
    v_out := v_out || jsonb_build_object('window', NULL);
  END IF;

  v_min := p_rules->'minNewRows';
  IF v_min IS NOT NULL AND v_min <> 'null'::jsonb THEN
    IF jsonb_typeof(v_min) <> 'number'
       OR (v_min #>> '{}')::numeric <> trunc((v_min #>> '{}')::numeric)
       OR (v_min #>> '{}')::numeric NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'minNewRows must be a whole number from 1 to 1000000'
        USING ERRCODE = 'SB034';
    END IF;
    v_out := v_out || jsonb_build_object('minNewRows', v_min);
  ELSE
    v_out := v_out || jsonb_build_object('minNewRows', NULL);
  END IF;

  v_wait := COALESCE(p_rules->'waitMinutes', '0'::jsonb);
  IF jsonb_typeof(v_wait) <> 'number'
     OR (v_wait #>> '{}')::numeric <> trunc((v_wait #>> '{}')::numeric)
     OR (v_wait #>> '{}')::numeric NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'waitMinutes must be a whole number from 0 to 1440'
      USING ERRCODE = 'SB034';
  END IF;

  v_running := COALESCE(p_rules->>'whileRunning', 'skip');
  IF v_running <> 'skip' THEN
    RAISE EXCEPTION 'whileRunning can only be skip' USING ERRCODE = 'SB034';
  END IF;

  v_missed := COALESCE(p_rules->>'missedRuns', 'run_once');
  IF v_missed NOT IN ('run_once', 'skip') THEN
    RAISE EXCEPTION 'missedRuns must be run_once or skip' USING ERRCODE = 'SB034';
  END IF;

  RETURN v_out || jsonb_build_object(
    'conditionsMatch', v_match,
    'waitMinutes', v_wait,
    'whileRunning', v_running,
    'missedRuns', v_missed);
END $$;
--> statement-breakpoint

ALTER FUNCTION internal.normalise_pipeline_start_rules(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.set_pipeline_start_rules(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_rules jsonb
) RETURNS api.pipeline_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v api.pipeline_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  UPDATE api.pipeline_definitions SET
    start_rules = internal.normalise_pipeline_start_rules(p_rules),
    revision = revision + 1,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_definition_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint

ALTER FUNCTION api.set_pipeline_start_rules(uuid, uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.set_pipeline_start_rules(uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.set_pipeline_start_rules(uuid, uuid, jsonb)
  TO authenticated, api_client;
--> statement-breakpoint

-- Activity: what each start did, not only why one did not run.
ALTER TABLE api.pipeline_schedule_activity
  ALTER COLUMN schedule_id DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE api.pipeline_schedule_activity
  ADD COLUMN definition_id uuid REFERENCES api.pipeline_definitions(id) ON DELETE CASCADE,
  ADD COLUMN source text,
  ADD COLUMN label text,
  ADD COLUMN run_id uuid REFERENCES api.pipeline_runs(id) ON DELETE SET NULL;
--> statement-breakpoint

UPDATE api.pipeline_schedule_activity a
   SET definition_id = s.definition_id,
       source = CASE WHEN s.kind = 'event' THEN 'event' ELSE 'schedule' END
  FROM api.pipeline_schedules s
 WHERE s.id = a.schedule_id;
--> statement-breakpoint

ALTER TABLE api.pipeline_schedule_activity
  ALTER COLUMN definition_id SET NOT NULL;
--> statement-breakpoint

ALTER TABLE api.pipeline_schedule_activity
  ADD CONSTRAINT chk_pipeline_schedule_activity_source
  CHECK (source IS NULL OR source IN ('event', 'schedule', 'webhook'));
--> statement-breakpoint

ALTER TABLE api.pipeline_schedule_activity
  DROP CONSTRAINT chk_pipeline_schedule_activity_kind;
--> statement-breakpoint

ALTER TABLE api.pipeline_schedule_activity
  ADD CONSTRAINT chk_pipeline_schedule_activity_kind
  CHECK (kind = ANY (ARRAY[
    'started', 'batched', 'skipped_condition',
    'skipped_missed', 'skipped_unchanged', 'skipped_overlap',
    'skipped_no_version', 'input_unresolved', 'start_failed']));
--> statement-breakpoint

CREATE INDEX idx_pipeline_schedule_activity_definition
  ON api.pipeline_schedule_activity (definition_id, occurred_at DESC);
--> statement-breakpoint

-- New rows a snapshot added: rows in it that the Dataset's previous snapshot
-- did not hold. The first snapshot of a Dataset counts all of its rows.
CREATE FUNCTION internal.dataset_version_new_rows(p_version_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT count(*)::integer
    FROM api.dataset_version_rows r
   WHERE r.dataset_version_id = p_version_id
     AND NOT EXISTS (
       SELECT 1
         FROM api.dataset_versions cur
         JOIN LATERAL (
           SELECT prev.id
             FROM api.dataset_versions prev
            WHERE prev.dataset_id = cur.dataset_id
              AND (prev.created_at, prev.id) < (cur.created_at, cur.id)
            ORDER BY prev.created_at DESC, prev.id DESC
            LIMIT 1) p ON true
         JOIN api.dataset_version_rows pr
           ON pr.dataset_version_id = p.id AND pr.row_id = r.row_id
        WHERE cur.id = p_version_id);
$$;
--> statement-breakpoint

ALTER FUNCTION internal.dataset_version_new_rows(uuid) OWNER TO migrator;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.dataset_version_new_rows(uuid) FROM PUBLIC;
