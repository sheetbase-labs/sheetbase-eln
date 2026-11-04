-- Pool samples: combine several samples into one new sample, taking a volume
-- from each. Each take is a normal withdrawal (so holds, reservations, the
-- ledger and the purpose experiment all apply), the pool is a new sample, and
-- every source gets a lineage link to it recording how much it gave. The pool's
-- history shows where it came from; each source's history shows the withdrawal.

CREATE FUNCTION api.pool_samples(p_sources jsonb, p_purpose_experiment_id uuid, p_unit text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_new_container jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_count int;
  v_entry jsonb;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
  v_qty numeric;
  v_total numeric := 0;
  v_source "api"."records";
  v_first "api"."records";
  v_units text[];
  v_unit text;
  v_types text[];
  v_type text;
  v_result jsonb;
  v_updated jsonb := '[]'::jsonb;
  v_pool "api"."records";
  v_title text;
  v_props jsonb;
  v_idents text;
  v_from jsonb := '[]'::jsonb;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
    RAISE EXCEPTION 'sources must be a list' USING ERRCODE = '22023';
  END IF;
  v_count := jsonb_array_length(p_sources);
  IF v_count < 2 OR v_count > 50 THEN
    RAISE EXCEPTION 'a pool needs between 2 and 50 samples' USING ERRCODE = '22023';
  END IF;
  IF p_purpose_experiment_id IS NULL THEN
    RAISE EXCEPTION 'a purpose experiment is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_container IS NOT NULL AND p_new_container <> 'null'::jsonb
     AND jsonb_typeof(p_new_container) <> 'object' THEN
    RAISE EXCEPTION 'new container must be a JSON object' USING ERRCODE = '22023';
  END IF;

  -- Validate the list first: distinct samples, positive amounts, one unit.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
    v_id := (v_entry ->> 'recordId')::uuid;
    v_qty := (v_entry ->> 'quantity')::numeric;
    IF v_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'every sample in a pool needs an amount above zero' USING ERRCODE = 'SB006';
    END IF;
    IF v_id = ANY (v_ids) THEN
      RAISE EXCEPTION 'a sample can only be pooled once' USING ERRCODE = '22023';
    END IF;
    v_ids := v_ids || v_id;
    v_total := v_total + v_qty;
    SELECT * INTO v_source FROM "api"."records" WHERE id = v_id AND kind = 'sample';
    IF v_source.id IS NULL THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
    END IF;
    IF v_first.id IS NULL THEN v_first := v_source; END IF;
    v_units := v_units || NULLIF(btrim(coalesce(v_source.properties ->> 'quantityUnit', '')), '');
    v_types := v_types || NULLIF(btrim(coalesce(v_source.properties ->> 'sampleType', '')), '');
  END LOOP;

  SELECT array_agg(DISTINCT u) INTO v_units FROM unnest(v_units) AS u WHERE u IS NOT NULL;
  IF coalesce(cardinality(v_units), 0) > 1 THEN
    RAISE EXCEPTION 'pooled samples must share one unit, got %', array_to_string(v_units, ', ')
      USING ERRCODE = '22023';
  END IF;
  v_unit := coalesce(NULLIF(btrim(coalesce(p_unit, '')), ''), v_units[1]);

  SELECT array_agg(DISTINCT ty) INTO v_types FROM unnest(v_types) AS ty WHERE ty IS NOT NULL;
  IF coalesce(cardinality(v_types), 0) = 1 THEN v_type := v_types[1]; END IF;

  -- Take the volume from each source with the canonical withdrawal.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
    v_id := (v_entry ->> 'recordId')::uuid;
    v_result := "api"."withdraw_sample"(
      p_record_id => v_id,
      p_quantity => (v_entry ->> 'quantity')::numeric,
      p_expected_metadata_version => (v_entry ->> 'expectedMetadataVersion')::int,
      p_purpose_experiment_id => p_purpose_experiment_id,
      p_unit => v_unit,
      p_notes => coalesce(p_notes, 'Taken for a pool'),
      p_new_container => NULL
    );
    v_updated := v_updated || jsonb_build_array(v_result -> 'sample');
  END LOOP;

  SELECT string_agg(r.identifier, ', ' ORDER BY r.identifier) INTO v_idents
    FROM "api"."records" r WHERE r.id = ANY (v_ids);

  v_title := NULLIF(btrim(coalesce(p_new_container ->> 'title', '')), '');
  IF v_title IS NULL THEN
    v_title := 'Pool of ' || v_idents;
  END IF;

  v_props := jsonb_strip_nulls(jsonb_build_object(
    'quantity', v_total,
    'quantityUnit', v_unit,
    'sampleType', coalesce(NULLIF(btrim(coalesce(p_new_container ->> 'sampleType', '')), ''), v_type),
    'storageLocation', coalesce(
      NULLIF(btrim(coalesce(p_new_container ->> 'storageLocation', '')), ''),
      v_first.properties ->> 'storageLocation'
    ),
    'barcode', NULLIF(btrim(coalesce(p_new_container ->> 'barcode', '')), '')
  ));

  SELECT * INTO v_pool FROM "api"."create_record"(
    p_project_id => v_first.project_id,
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
    (v_pool.workspace_id, v_pool.id, 'create', v_total, 0, v_total,
     v_unit, "api"."current_user_id"(), p_purpose_experiment_id,
     'Pooled from ' || v_idents);

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_sources) LOOP
    v_id := (v_entry ->> 'recordId')::uuid;
    SELECT * INTO v_source FROM "api"."records" WHERE id = v_id;
    INSERT INTO "api"."record_links"
      (source_record_id, target_record_id, target_kind, target_identifier,
       link_type, link_metadata, created_by_user_id)
    VALUES
      (v_source.id, v_pool.id, 'sample', v_pool.identifier, 'sample',
       jsonb_build_object(
         'origin', 'pool_samples',
         'relation', 'Pooled',
         'purposeRecordId', p_purpose_experiment_id,
         'quantity', (v_entry ->> 'quantity')::numeric,
         'unit', v_unit
       ),
       "api"."current_user_id"());
  END LOOP;

  RETURN jsonb_build_object(
    'pool', to_jsonb(v_pool),
    'sources', v_updated
  );
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.pool_samples(jsonb, uuid, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
COMMENT ON FUNCTION api.pool_samples(jsonb, uuid, text, text, jsonb) IS 'Combine samples into one new sample: a withdrawal from each source ([{recordId, quantity, expectedMetadataVersion}]), a pooled sample holding the total, and a lineage link from every source to it. All or nothing. Returns { pool, sources[] }.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.pool_samples(jsonb, uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.pool_samples(jsonb, uuid, text, text, jsonb) TO authenticated;
