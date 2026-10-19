-- Phase 6 (bench) — three sample operations the UI needed in one step each.
--
-- * api.register_samples: register many samples in one transaction, through the
--   same create path as a single registration, so a pasted list either lands
--   whole or not at all.
-- * api.aliquot_sample: split a sample into N tubes in one transaction. Each tube
--   is a withdrawal into its own derived container (api.withdraw_sample), so the
--   consume events, lineage links and experiment link are exactly what N manual
--   withdrawals would have written; only the all-or-nothing behaviour is new.
-- * api.sample_release_check_status: the live read of the release checks a
--   quarantined sample has to pass, using the same rule set and measurement
--   read model api.release_sample evaluates, without releasing anything.
--
-- All are SECURITY INVOKER: records/sample_events RLS and the capability checks
-- inside the functions they call stay the authority.

CREATE OR REPLACE FUNCTION "api"."register_samples"(
  p_project_id uuid,
  p_samples jsonb
)
RETURNS SETOF "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_row "api"."records";
  v_props jsonb;
BEGIN
  IF p_samples IS NULL OR jsonb_typeof(p_samples) <> 'array' THEN
    RAISE EXCEPTION 'samples must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_samples) = 0 THEN
    RAISE EXCEPTION 'at least one sample is required' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_samples) > 500 THEN
    RAISE EXCEPTION 'at most 500 samples can be registered at once' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_samples) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'each sample must be an object' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(coalesce(v_item ->> 'title', '')), '') IS NULL THEN
      RAISE EXCEPTION 'each sample needs a name' USING ERRCODE = '22023';
    END IF;
    v_props := jsonb_strip_nulls(jsonb_build_object(
      'sampleType', nullif(btrim(coalesce(v_item ->> 'sampleType', '')), ''),
      'quantity', CASE WHEN nullif(btrim(coalesce(v_item ->> 'quantity', '')), '') IS NULL
                       THEN NULL ELSE (v_item ->> 'quantity')::numeric END,
      'quantityUnit', nullif(btrim(coalesce(v_item ->> 'quantityUnit', '')), ''),
      'storageLocation', nullif(btrim(coalesce(v_item ->> 'storageLocation', '')), ''),
      'barcode', nullif(btrim(coalesce(v_item ->> 'barcode', '')), '')
    ));
    SELECT * INTO v_row FROM "api"."create_model_record"(
      p_project_id => p_project_id,
      p_kind => 'sample',
      p_title => btrim(v_item ->> 'title'),
      p_status => 'available',
      p_tags => ARRAY[]::text[],
      p_properties => v_props,
      p_custom_fields => '{}'::jsonb
    );
    RETURN NEXT v_row;
  END LOOP;
  RETURN;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."register_samples"(uuid, jsonb) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."register_samples"(uuid, jsonb) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."register_samples"(uuid, jsonb) IS
  'Phase 6: register up to 500 samples in one transaction through api.create_model_record. Each item: title (required), sampleType, quantity, quantityUnit, storageLocation, barcode. Returns the new records in input order.';--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."aliquot_sample"(
  p_record_id uuid,
  p_count int,
  p_quantity_each numeric,
  p_purpose_experiment_id uuid,
  p_expected_metadata_version int,
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
  v_version int := p_expected_metadata_version;
  v_free numeric;
  v_reserved numeric;
  v_result jsonb;
  v_container jsonb;
  v_derived jsonb := '[]'::jsonb;
  v_base_title text;
  v_i int;
BEGIN
  IF p_count IS NULL OR p_count < 1 OR p_count > 96 THEN
    RAISE EXCEPTION 'aliquot count must be between 1 and 96' USING ERRCODE = '22023';
  END IF;
  IF p_quantity_each IS NULL OR p_quantity_each <= 0 THEN
    RAISE EXCEPTION 'aliquot quantity must be positive' USING ERRCODE = 'SB006';
  END IF;
  IF p_new_container IS NOT NULL AND p_new_container <> 'null'::jsonb
     AND jsonb_typeof(p_new_container) <> 'object' THEN
    RAISE EXCEPTION 'new container must be a JSON object' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM "api"."records" WHERE id = p_record_id AND kind = 'sample';
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Refuse the whole split up front when the tubes together would overdraw the
  -- free balance, so the message names the total rather than the last tube.
  v_reserved := coalesce("internal"."sample_reserved_quantity"(p_record_id), 0);
  v_free := coalesce(nullif(v_source.properties ->> 'quantity', '')::numeric, 0) - v_reserved;
  IF p_count * p_quantity_each > v_free THEN
    RAISE EXCEPTION 'insufficient free quantity: available %, reserved %, aliquoting % x % = %',
      v_free, v_reserved, p_count, p_quantity_each, p_count * p_quantity_each
      USING ERRCODE = 'SB006';
  END IF;

  v_base_title := coalesce(
    nullif(btrim(coalesce(p_new_container ->> 'title', '')), ''),
    coalesce(v_source.title, v_source.identifier)
  );

  FOR v_i IN 1..p_count LOOP
    v_container := coalesce(p_new_container, '{}'::jsonb) || jsonb_build_object(
      'title', format('%s aliquot %s of %s', v_base_title, v_i, p_count)
    );
    v_result := "api"."withdraw_sample"(
      p_record_id => p_record_id,
      p_quantity => p_quantity_each,
      p_expected_metadata_version => v_version,
      p_purpose_experiment_id => p_purpose_experiment_id,
      p_unit => p_unit,
      p_notes => p_notes,
      p_new_container => v_container
    );
    v_derived := v_derived || jsonb_build_array(v_result -> 'derivedSample');
    v_version := (v_result -> 'sample' ->> 'metadata_version')::int;
  END LOOP;

  RETURN jsonb_build_object(
    'sample', v_result -> 'sample',
    'derivedSamples', v_derived
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."aliquot_sample"(uuid, int, numeric, uuid, int, text, text, jsonb) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."aliquot_sample"(uuid, int, numeric, uuid, int, text, text, jsonb) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."aliquot_sample"(uuid, int, numeric, uuid, int, text, text, jsonb) IS
  'Phase 6: split a sample into p_count tubes of p_quantity_each, each a withdrawal into a derived container for the purpose experiment, in one transaction (all or nothing). Returns { sample, derivedSamples[] }.';--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."sample_release_check_status"(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_eval jsonb;
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;

  v_eval := "internal"."evaluate_sample_release_rules"(
    "internal"."sample_release_rules"(v_row.workspace_id, v_row.properties ->> 'sampleType'),
    "api"."sample_measurement_provenance"(p_record_id)
  );
  RETURN v_eval || jsonb_build_object(
    'sampleId', v_row.id,
    'sampleType', v_row.properties ->> 'sampleType'
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."sample_release_check_status"(uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."sample_release_check_status"(uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."sample_release_check_status"(uuid) IS
  'Phase 6: the release checks a sample has to pass, evaluated now against api.sample_measurement_provenance with the effective per-sample-type rule set. Read-only; api.release_sample enforces the same evaluation.';--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
