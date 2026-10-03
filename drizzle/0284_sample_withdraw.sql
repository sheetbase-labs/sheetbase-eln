-- LAB-01 step 1 — withdraw_sample.
--
-- A withdrawal is the existing `consume` event: `api.withdraw_sample` is built
-- on top of `api.consume_sample` rather than introducing a second quantity
-- ledger. It adds a *purpose* experiment to the canonical consume event, and can
-- atomically derive a new container — a real `api.records` sample row with its
-- canonical `create` sample event and the existing `api.record_links` lineage
-- edge (the same derived-sample pattern DSET-01.4 `request_repeat` uses).
--
-- Over-withdrawal is refused before anything is written, reporting the free
-- amount (current quantity minus reserved volume). Reserved volume is LAB-01
-- step 2; `internal.sample_reserved_quantity` is the single hook it will
-- replace, and `withdraw_sample` already subtracts it so reserved volume can
-- never be silently overdrawn. Hold/quarantine/allowed-use, disposal, archived
-- and optimistic-concurrency refusals all stay in `consume_sample`.
--
-- One new nullable column, `api.sample_events.purpose_record_id`, carries the
-- purpose on the durable event. RLS/membership is unchanged: every RPC here is
-- SECURITY INVOKER, so records/sample_events/record_links RLS remains the
-- authority; only writers (record.create) may withdraw.

ALTER TABLE "api"."sample_events" ADD COLUMN "purpose_record_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."sample_events" ADD CONSTRAINT "sample_events_purpose_record_id_records_id_fk" FOREIGN KEY ("purpose_record_id") REFERENCES "api"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- LAB-01 step 2 hook: reserved volume for a sample. Step 1 has no reservations,
-- so this returns 0. Step 2 replaces this function body with the sum of active
-- `api.sample_reservations`; `api.withdraw_sample` already subtracts the result
-- from the free balance, so no other change is needed then.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."sample_reserved_quantity"(p_record_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 0::numeric
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."sample_reserved_quantity"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "internal"."sample_reserved_quantity"(uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "internal"."sample_reserved_quantity"(uuid) IS
  'LAB-01 step 2 hook: reserved quantity currently held for a sample. Step 1 returns 0; step 2 sums active api.sample_reservations. api.withdraw_sample subtracts it from the free balance.';

-- ---------------------------------------------------------------------------
-- Extend the canonical consume with an optional purpose. The four-argument-free
-- signature is unchanged for existing callers (named arguments, defaulted sixth
-- parameter); the only new write is purpose_record_id on the durable event.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS "api"."consume_sample"(uuid, numeric, int, text, uuid);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."consume_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL,
  p_experiment_id uuid DEFAULT NULL,
  p_purpose_record_id uuid DEFAULT NULL
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
  v_permitted boolean;
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

  -- LAB-02: a disposed sample is terminal and can never be withdrawn.
  IF v_row.status = 'disposed' THEN
    RAISE EXCEPTION 'cannot withdraw a disposed sample' USING ERRCODE = 'SB004';
  END IF;

  -- LAB-02: a quarantined or past-hold sample may only be withdrawn by an
  -- explicitly allowed experiment.
  IF v_row.status IN ('hold_exceeded', 'quarantined') THEN
    v_allowed := CASE
      WHEN jsonb_typeof(v_row.properties -> 'allowedUseExperimentIds') = 'array'
        THEN v_row.properties -> 'allowedUseExperimentIds'
      ELSE '[]'::jsonb
    END;
    v_permitted := p_experiment_id IS NOT NULL AND EXISTS (
      SELECT 1
        FROM jsonb_array_elements_text(v_allowed) AS allowed(id)
       WHERE allowed.id = p_experiment_id::text
    );
    IF NOT v_permitted THEN
      RAISE EXCEPTION 'sample is % and this experiment is not allowed to withdraw it', v_row.status
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
     quantity_after, quantity_unit, actor_user_id, purpose_record_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'consume', -p_quantity, v_before, v_after,
     v_unit, "api"."current_user_id"(), p_purpose_record_id, p_notes);

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid, uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid, uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text, uuid, uuid) IS
  'REG-002/LAB-01: canonical withdrawal. Refuses over-withdrawal, archived/disposed and held/quarantined samples (unless the experiment is in allowedUseExperimentIds), checks optimistic concurrency and appends one canonical consume sample_event carrying the optional purpose record.';

-- ---------------------------------------------------------------------------
-- LAB-01 step 1: withdraw_sample. Throws jsonb { sample, derivedSampleId,
-- derivedSample } so the caller gets the updated sample and (when a new
-- container was requested) the derived sample id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."withdraw_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_purpose_experiment_id uuid,
  p_unit text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_new_container jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_source "api"."records";
  v_purpose "api"."records";
  v_updated "api"."records";
  v_derived "api"."records";
  v_before numeric;
  v_reserved numeric;
  v_free numeric;
  v_unit text;
  v_title text;
  v_props jsonb;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'withdraw quantity must be positive' USING ERRCODE = 'SB006';
  END IF;
  IF p_purpose_experiment_id IS NULL THEN
    RAISE EXCEPTION 'a purpose experiment is required' USING ERRCODE = '22023';
  END IF;

  -- A withdrawal is a data mutation: viewers are refused explicitly, alongside
  -- the RLS and create_record writer gates.
  IF NOT "api"."is_workspace_writer"("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'withdraw denied' USING ERRCODE = '42501';
  END IF;

  -- The purpose must be an experiment in the active workspace.
  SELECT * INTO v_purpose FROM "api"."records"
   WHERE id = p_purpose_experiment_id AND kind = 'experiment';
  IF v_purpose.id IS NULL THEN
    RAISE EXCEPTION 'purpose experiment not found in active workspace'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the source and check concurrency before doing any work.
  SELECT * INTO v_source FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_source.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_source.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot withdraw from an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_source.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_source.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_before := NULLIF(v_source.properties ->> 'quantity', '')::numeric;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sample has no quantity to withdraw' USING ERRCODE = 'SB006';
  END IF;

  -- Unit: the withdrawal unit must match the sample unit when both are set;
  -- otherwise the sample unit is used (or the supplied unit when the sample has
  -- none). No unit conversion is performed.
  v_unit := NULLIF(btrim(coalesce(v_source.properties ->> 'quantityUnit', '')), '');
  IF p_unit IS NOT NULL AND btrim(p_unit) <> ''
     AND v_unit IS NOT NULL AND btrim(p_unit) <> v_unit THEN
    RAISE EXCEPTION 'withdraw unit % does not match the sample unit %', btrim(p_unit), v_unit
      USING ERRCODE = '22023';
  END IF;
  v_unit := COALESCE(NULLIF(btrim(coalesce(p_unit, '')), ''), v_unit);

  -- LAB-01 step 2 hook: refuse anything that would drive the free balance
  -- (current - reserved) negative, reporting the available amount.
  v_reserved := COALESCE("internal"."sample_reserved_quantity"(p_record_id), 0);
  v_free := v_before - v_reserved;
  IF p_quantity > v_free THEN
    RAISE EXCEPTION 'insufficient free quantity: available %, reserved %, withdrawing %',
      v_free, v_reserved, p_quantity
      USING ERRCODE = 'SB006';
  END IF;

  -- The canonical consume event: all lifecycle, hold/quarantine/allowed-use,
  -- over-withdrawal and concurrency guards stay in consume_sample.
  SELECT * INTO v_updated FROM "api"."consume_sample"(
    p_record_id => p_record_id,
    p_quantity => p_quantity,
    p_expected_metadata_version => p_expected_metadata_version,
    p_notes => p_notes,
    p_experiment_id => p_purpose_experiment_id,
    p_purpose_record_id => p_purpose_experiment_id
  );

  IF p_new_container IS NULL OR p_new_container = 'null'::jsonb THEN
    RETURN jsonb_build_object(
      'sample', to_jsonb(v_updated),
      'derivedSampleId', NULL,
      'derivedSample', NULL
    );
  END IF;

  IF jsonb_typeof(p_new_container) <> 'object' THEN
    RAISE EXCEPTION 'new container must be a JSON object' USING ERRCODE = '22023';
  END IF;

  v_title := NULLIF(btrim(coalesce(p_new_container ->> 'title', '')), '');
  IF v_title IS NULL THEN
    v_title := COALESCE(v_source.title, v_source.identifier)
               || ' from ' || v_source.identifier;
  END IF;

  v_props := jsonb_build_object(
    'quantity', p_quantity,
    'quantityUnit', v_unit,
    'sampleType', COALESCE(
      NULLIF(btrim(coalesce(p_new_container ->> 'sampleType', '')), ''),
      v_source.properties ->> 'sampleType'
    ),
    'storageLocation', COALESCE(
      NULLIF(btrim(coalesce(p_new_container ->> 'storageLocation', '')), ''),
      v_source.properties ->> 'storageLocation'
    ),
    'barcode', NULLIF(btrim(coalesce(p_new_container ->> 'barcode', '')), '')
  );
  v_props := jsonb_strip_nulls(v_props);

  -- Derived container: the existing sample model, created through the canonical
  -- create path (identifier, workspace/project validation, RLS).
  SELECT * INTO v_derived FROM "api"."create_record"(
    p_project_id => v_source.project_id,
    p_kind => 'sample',
    p_title => v_title,
    p_status => 'available',
    p_tags => ARRAY[]::text[],
    p_properties => v_props
  );

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, quantity_delta, quantity_before,
     quantity_after, quantity_unit, actor_user_id, purpose_record_id, notes)
  VALUES
    (v_derived.workspace_id, v_derived.id, 'create', p_quantity, 0, p_quantity,
     v_unit, "api"."current_user_id"(), p_purpose_experiment_id,
     'Derived from ' || v_source.identifier || ' by withdrawal');

  -- Existing lineage model: an outgoing 'sample' link from the source, with
  -- provenance in link_metadata — the DSET-01.4 derived-sample convention.
  INSERT INTO "api"."record_links"
    (source_record_id, target_record_id, target_kind, target_identifier,
     link_type, link_metadata, created_by_user_id)
  VALUES
    (v_source.id, v_derived.id, 'sample', v_derived.identifier, 'sample',
     jsonb_build_object(
       'origin', 'withdraw_sample',
       'purposeRecordId', p_purpose_experiment_id,
       'quantity', p_quantity,
       'unit', v_unit
     ),
     "api"."current_user_id"());

  RETURN jsonb_build_object(
    'sample', to_jsonb(v_updated),
    'derivedSampleId', v_derived.id,
    'derivedSample', to_jsonb(v_derived)
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."withdraw_sample"(uuid, numeric, int, uuid, text, text, jsonb) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."withdraw_sample"(uuid, numeric, int, uuid, text, text, jsonb) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."withdraw_sample"(uuid, numeric, int, uuid, text, text, jsonb) IS
  'LAB-01 step 1: withdraw with a purpose experiment on top of the canonical consume event. Refuses over-withdrawal (reporting the free amount) and reserved volume, keeps consume_sample hold/quarantine/allowed-use refusals, and can derive a linked container sample in the same transaction. Returns { sample, derivedSampleId, derivedSample }.';

NOTIFY pgrst, 'reload schema';
