-- R5-STUDIO-01 — analyse mode states its method.
--
-- The frozen analysis payload now records the analysis-method definition
-- version it was computed under (`methodVersion`), alongside the verbatim
-- definition it already pinned. A citation therefore names the method it ran:
-- reconstruction refuses to present numbers under a different method version
-- rather than silently recomputing them under a method the citation never
-- named. `methodVersion` is mirrored by ANALYSIS_METHOD_VERSION in
-- src/lib/analysis-definition.ts; the two move together, and
-- src/lib/analysis-definition.test.ts asserts that they agree.
--
-- A frozen payload may only be written by this SECURITY DEFINER RPC, so this
-- is the only place the recorded version can be stamped. Payloads frozen
-- before this revision carry no `methodVersion`; readers report that as
-- "method version not recorded" instead of assuming agreement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."freeze_analysis_block"(
  p_block_id uuid,
  p_expected_version int
)
RETURNS "api"."blocks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_block "api"."blocks";
  v_owner "api"."records";
  v_payload jsonb;
  v_definition_id uuid;
  v_definition jsonb;
  v_definition_name text;
  v_definition_version int;
  v_dataset_ref jsonb;
  v_ds "api"."datasets";
  v_schema_version int;
  v_version_row "api"."dataset_versions";
  v_f "api"."dataset_schema_version_fields"%ROWTYPE;
  v_bound_fields text[];
  v_columns jsonb := '[]'::jsonb;
  v_rowcount bigint;
  v_checksum text;
  v_provenance jsonb := '[]'::jsonb;
  v_frozen jsonb;
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'analysis' THEN
    RAISE EXCEPTION 'block is not an analysis' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  IF jsonb_typeof(v_block.payload->'frozen') = 'object' THEN
    RAISE EXCEPTION 'analysis is already frozen' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503'; END IF;
  -- SECURITY DEFINER bypasses RLS; revalidate the caller's authority.
  IF v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_writer"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;

  BEGIN
    v_definition_id := (v_block.payload->>'definitionId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'invalid analysis definition UUID' USING ERRCODE = '23514';
  END;

  SELECT d.definition, d.name, d.version INTO v_definition, v_definition_name, v_definition_version
    FROM "api"."analysis_definitions" d
   WHERE d.id = v_definition_id AND d.workspace_id = v_owner.workspace_id;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'invalid analysis definition reference' USING ERRCODE = '23514';
  END IF;

  -- Exactly one input dataset in this contract revision (decision 0041).
  IF jsonb_typeof(v_definition->'datasets') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_definition->'datasets') <> 1 THEN
    RAISE EXCEPTION 'definition must reference exactly one dataset' USING ERRCODE = '23514';
  END IF;
  v_dataset_ref := v_definition->'datasets'->0;
  SELECT * INTO v_ds FROM "api"."datasets"
    WHERE id = (v_dataset_ref->>'datasetId')::uuid AND lifecycle = 'active';
  IF v_ds.id IS NULL OR v_ds.workspace_id <> v_owner.workspace_id THEN
    RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE = '23514';
  END IF;
  SELECT sv.version INTO v_schema_version FROM "api"."dataset_schema_versions" sv
    WHERE sv.id = v_ds.schema_version_id;

  -- Column metadata for every bound field: labels/types render honestly even
  -- after schema evolution. Metadata only — no rows are embedded.
  v_bound_fields := ARRAY_remove(ARRAY[
    v_definition#>>'{value,fieldId}',
    v_definition#>>'{group,fieldId}',
    v_definition#>>'{outcome,fieldId}',
    v_definition#>>'{predictor,fieldId}'
  ]::text[], NULL);
  FOR v_f IN
    SELECT * FROM "api"."dataset_schema_version_fields" f
     WHERE f.schema_version_id = v_ds.schema_version_id AND f.lifecycle = 'active'
     ORDER BY f.display_order, f.field_id
  LOOP
    IF v_f.field_id::text = ANY(v_bound_fields) THEN
      v_columns := v_columns || jsonb_build_object(
        'fieldId', v_f.field_id,
        'label', v_f.label,
        'logicalType', v_f.logical_type,
        'unit', COALESCE(v_f.quantity, 'null'::jsonb)
      );
    END IF;
  END LOOP;

  -- Immutable point-in-time snapshot. Substantial by design (ADR 0037):
  -- submission evidence is one of its sanctioned triggers.
  v_version_row := "api"."snapshot_dataset"(
    v_ds.id,
    v_ds.revision,
    left('analysis block ' || v_block.id::text, 200)
  );

  -- Row count and checksum over the Version's values for bound fields,
  -- ordered by row_id. A reader reconstructing evidence from the Version
  -- recomputes the same inputs deterministically.
  SELECT count(*), md5(coalesce(jsonb_agg(row_values ORDER BY row_id)::text, '[]'))
    INTO v_rowcount, v_checksum
    FROM (
      SELECT vr.row_id,
             COALESCE((SELECT jsonb_object_agg(j.field_id, j.val)
               FROM (
                 SELECT v.field_id,
                        CASE WHEN count(*) = 1
                          THEN (jsonb_agg(COALESCE(to_jsonb(v.text_value), to_jsonb(v.integer_value), to_jsonb(v.numeric_value), to_jsonb(v.boolean_value), to_jsonb(v.date_value), to_jsonb(v.timestamp_value), to_jsonb(v.category_option_id), to_jsonb(v.reference_id)) ORDER BY v.ordinal))->0
                          ELSE jsonb_agg(COALESCE(to_jsonb(v.text_value), to_jsonb(v.integer_value), to_jsonb(v.numeric_value), to_jsonb(v.boolean_value), to_jsonb(v.date_value), to_jsonb(v.timestamp_value), to_jsonb(v.category_option_id), to_jsonb(v.reference_id)) ORDER BY v.ordinal)
                        END AS val
                   FROM "api"."dataset_version_values" v
                  WHERE v.dataset_version_id = v_version_row.id
                    AND v.field_id::text = ANY(v_bound_fields)
                    AND v.row_id = vr.row_id
                  GROUP BY v.field_id
               ) j), '{}'::jsonb) AS row_values
        FROM "api"."dataset_version_rows" vr
       WHERE vr.dataset_version_id = v_version_row.id
    ) per_row;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'empty dataset' USING ERRCODE = '23514';
  END IF;

  v_provenance := jsonb_build_array(jsonb_build_object(
    'datasetId', v_ds.id,
    'datasetVersionId', v_version_row.id,
    'schemaVersionNumber', v_schema_version,
    'sourceDatasetRevision', v_version_row.source_dataset_revision,
    'rowCount', v_rowcount,
    'checksum', v_checksum
  ));

  v_frozen := jsonb_build_object(
    'revisionId', 'null'::jsonb,
    'frozenAt', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'frozenByUserId', to_jsonb("api"."current_user_id"()),
    -- R5-STUDIO-01: the analysis-method definition version this freeze was
    -- computed under (mirrors ANALYSIS_METHOD_VERSION in the kernel). Bump it
    -- with the kernel so a citation can never silently change method.
    'methodVersion', 1,
    'definition', v_definition,
    'definitionName', to_jsonb(v_definition_name),
    'definitionVersion', to_jsonb(v_definition_version),
    'columns', v_columns,
    'datasetProvenance', v_provenance
  );

  v_payload := jsonb_set(v_block.payload, ARRAY['frozen'], v_frozen);

  UPDATE "api"."blocks"
    SET payload = v_payload,
        version = v_block.version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_block_id
    RETURNING * INTO v_block;

  RETURN v_block;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."freeze_analysis_block"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."freeze_analysis_block"(uuid, int) TO authenticated;--> statement-breakpoint
