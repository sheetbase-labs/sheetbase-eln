-- LAB-02 step 1 — sample hold limits, automatic hold_exceeded and allowed uses.
--
-- Hold fields live in the sample's existing `records.properties` JSONB,
-- alongside sampleType/quantity/storageLocation/lowStockThreshold:
--   * holdCondition            text,   e.g. "2-8 C"
--   * holdStartedAt            text ISO timestamp (harvest/registration)
--   * holdDurationDays         number, duration from holdStartedAt
--   * holdUntil                text ISO timestamp, explicit deadline override
--   * allowedUseExperimentIds  text[], experiment record ids that may still
--                              withdraw the sample while it is on hold
--
-- The effective deadline is `holdUntil` when present, else
-- `holdStartedAt` (falling back to the record's created_at) plus
-- `holdDurationDays`. `internal.sample_hold_deadline` is the single
-- authoritative definition of that rule; the scheduled sweep uses it.
--
-- This migration adds no typed columns and no second status/log engine: the
-- transition reuses `records.status`, the existing `api.sample_events`
-- chain-of-custody log (with a System actor, i.e. a null actor_user_id) and
-- the existing `api.change_events` stream. RLS/membership is unchanged; the
-- sweep is a privileged cross-workspace job whose every write stays scoped to
-- the affected row's own workspace.

ALTER TABLE "api"."sample_events" DROP CONSTRAINT "chk_sample_events_operation";--> statement-breakpoint
ALTER TABLE "api"."sample_events" ADD CONSTRAINT "chk_sample_events_operation" CHECK ("api"."sample_events"."operation" IN ('create','receive','consume','transfer','edit','archive','restore','hold_exceeded'));--> statement-breakpoint

-- `internal.guard_record_properties` only admits properties declared in
-- `api.model_base_fields` for the kind. Register the new sample hold fields
-- there (system/protected, like the existing quantity/expiryDate entries) so
-- they can be written and read through the existing record property path.
INSERT INTO api.model_base_fields(model_key, field_key, label, presentation) VALUES
  ('sample', 'holdCondition', 'Hold condition', '{"protected":true}'),
  ('sample', 'holdStartedAt', 'Hold started at', '{"protected":true}'),
  ('sample', 'holdDurationDays', 'Hold duration days', '{"protected":true}'),
  ('sample', 'holdUntil', 'Hold until', '{"protected":true}'),
  ('sample', 'allowedUseExperimentIds', 'Allowed use experiments', '{"protected":true}')
ON CONFLICT (model_key, field_key) DO NOTHING;--> statement-breakpoint

-- Single source of truth for the effective hold deadline. IMMUTABLE so the
-- sweep predicate and the returned deadline agree, and so it is safe to use
-- in a filtered/locked scan.
CREATE OR REPLACE FUNCTION "internal"."sample_hold_deadline"(
  p_properties jsonb,
  p_created_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NULLIF(p_properties ->> 'holdUntil', '') IS NOT NULL
      THEN (p_properties ->> 'holdUntil')::timestamptz
    ELSE COALESCE(
           NULLIF(p_properties ->> 'holdStartedAt', '')::timestamptz,
           p_created_at
         ) + (
           COALESCE(NULLIF(p_properties ->> 'holdDurationDays', ''), '0')
           || ' days'
         )::interval
  END
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."sample_hold_deadline"(jsonb, timestamptz) FROM PUBLIC;--> statement-breakpoint

-- Scheduled System transition: move every non-terminal sample whose
-- configured hold limit has passed into `hold_exceeded`, appending one
-- canonical `hold_exceeded` sample event per sample. The change-event triggers
-- deliberately stay quiet without a request claim (bootstrap/migration), so
-- the job also appends the durable `record` change event itself with a null
-- (System) actor.
CREATE OR REPLACE FUNCTION api.sweep_sample_hold_limits(p_limit integer DEFAULT 100)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  r record;
  seq bigint;
  exceeded jsonb := '[]'::jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid hold-limit sweep limit' USING ERRCODE = '22023';
  END IF;

  FOR r IN
    SELECT rec.id, rec.workspace_id, rec.project_id, rec.status AS prior_status,
      "internal"."sample_hold_deadline"(rec.properties, rec.created_at) AS deadline
    FROM api.records rec
    WHERE rec.kind = 'sample'
      AND rec.deleted_at IS NULL
      AND rec.archived_at IS NULL
      AND rec.status NOT IN ('consumed', 'expired', 'hold_exceeded')
      AND (rec.properties ? 'holdDurationDays' OR rec.properties ? 'holdUntil')
      AND "internal"."sample_hold_deadline"(rec.properties, rec.created_at) <= now()
    ORDER BY rec.created_at, rec.id
    LIMIT p_limit
    FOR UPDATE OF rec SKIP LOCKED
  LOOP
    UPDATE api.records
       SET status = 'hold_exceeded',
           metadata_version = metadata_version + 1,
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO api.sample_events
      (workspace_id, record_id, operation, actor_user_id, notes)
    VALUES
      (r.workspace_id, r.id, 'hold_exceeded', NULL,
       'Hold limit exceeded; moved to hold_exceeded by the scheduled job');

    -- The record/sample_event change-event triggers skip emission without a
    -- request claim (bootstrap/migration quiet path). A scheduled System
    -- transition must still appear on the durable change stream, so the job
    -- appends the canonical change event itself with a null (System) actor —
    -- exactly as api.prune_dataset_versions does for its System removal.
    INSERT INTO api.workspace_change_seq (workspace_id, last_seq)
    VALUES (r.workspace_id, 1)
    ON CONFLICT (workspace_id) DO UPDATE
      SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO seq;

    INSERT INTO api.change_events
      (id, workspace_id, sequence, entity_type, entity_uuid, operation,
       record_id, project_id, actor_user_id, payload)
    VALUES
      (gen_random_uuid(), r.workspace_id, seq, 'record', r.id, 'update',
       r.id, r.project_id, NULL,
       jsonb_build_object(
         'status', 'hold_exceeded',
         'changedMetadata', true,
         'changes', jsonb_build_object(
           'status', jsonb_build_object(
             'from', r.prior_status,
             'to', 'hold_exceeded'
           )
         )
       ));

    exceeded := exceeded || jsonb_build_object(
      'recordId', r.id,
      'workspaceId', r.workspace_id,
      'deadline', r.deadline
    );
  END LOOP;

  RETURN jsonb_build_object(
    'exceededCount', jsonb_array_length(exceeded),
    'exceeded', exceeded
  );
END;
$$;--> statement-breakpoint

-- Privileged job-only entry point, mirroring api.prune_dataset_versions.
REVOKE ALL ON FUNCTION api.sweep_sample_hold_limits(integer) FROM PUBLIC, anon, authenticated, api_client;--> statement-breakpoint

COMMENT ON FUNCTION api.sweep_sample_hold_limits(integer) IS
  'LAB-02 step 1: bounded scheduled sweep that moves samples past their hold limit to hold_exceeded as System and appends a canonical sample_event. Run by the server job with the privileged app connection.';--> statement-breakpoint

-- LAB-02 step 1 — enforce the allowed-use list at withdrawal. consume_sample
-- stays the canonical withdrawal primitive (LAB-01 builds withdraw_sample on
-- top of it). A hold_exceeded sample may only be consumed by an experiment
-- named in properties.allowedUseExperimentIds; every other caller is refused
-- with the existing SB004 invalid-state error. The old four-argument
-- signature is dropped so there is exactly one implementation.
DROP FUNCTION IF EXISTS "api"."consume_sample"(uuid, numeric, int, text);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."consume_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL,
  p_experiment_id uuid DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_before numeric;
  v_after numeric;
  v_unit text;
  v_props jsonb;
  v_status text;
  v_allowed jsonb;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'consume quantity must be positive' USING ERRCODE = 'SB006';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot consume an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  -- LAB-02: a sample past its hold limit may only be withdrawn by an
  -- explicitly allowed experiment.
  IF v_row.status = 'hold_exceeded' THEN
    v_allowed := CASE
      WHEN jsonb_typeof(v_row.properties -> 'allowedUseExperimentIds') = 'array'
        THEN v_row.properties -> 'allowedUseExperimentIds'
      ELSE '[]'::jsonb
    END;
    IF p_experiment_id IS NULL OR NOT EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(v_allowed) AS allowed(id)
       WHERE allowed.id = p_experiment_id::text
    ) THEN
      RAISE EXCEPTION 'sample is past its hold limit and this experiment is not allowed to withdraw it'
        USING ERRCODE = 'SB004';
    END IF;
  END IF;

  v_before := NULLIF(v_row.properties ->> 'quantity', '')::numeric;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sample has no quantity to consume' USING ERRCODE = 'SB006';
  END IF;
  v_after := v_before - p_quantity;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'insufficient quantity: have %, consuming %', v_before, p_quantity
      USING ERRCODE = 'SB006';
  END IF;
  v_unit := v_row.properties ->> 'quantityUnit';
  v_props := v_row.properties || jsonb_build_object('quantity', v_after);
  -- When the sample is fully consumed, transition to the consumed lifecycle
  -- state (a permitted available/reserved -> consumed move).
  v_status := CASE WHEN v_after = 0 THEN 'consumed' ELSE v_row.status END;

  UPDATE "api"."records"
    SET properties = v_props,
        status = v_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, quantity_delta, quantity_before,
     quantity_after, quantity_unit, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'consume', -p_quantity, v_before, v_after,
     v_unit, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
