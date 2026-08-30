-- SCI-04: freeze metadata keeps every ChartSpec-referenced field, including
-- typeParams.heatmap.valueField. The SQL helper mirrors
-- chartSpecReferencedFieldIds() in src/lib/chart-spec.ts.

CREATE OR REPLACE FUNCTION "api"."chart_spec_referenced_field_ids"(p_spec jsonb)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  ids text[] := ARRAY[]::text[];
  fields jsonb := COALESCE(p_spec->'fields', '{}'::jsonb);
  filter jsonb;
  transformation jsonb;
  params jsonb;
BEGIN
  ids := ARRAY[
    fields->'x'->>'fieldId',
    fields->'y'->>'fieldId',
    fields->'series'->>'fieldId',
    fields->'color'->>'fieldId',
    fields->'size'->>'fieldId',
    fields->'facet'->>'fieldId',
    fields->'facetRow'->>'fieldId',
    fields->'facetCol'->>'fieldId',
    fields->'group'->>'fieldId',
    fields->'shape'->>'fieldId',
    fields->'label'->>'fieldId',
    p_spec#>>'{overlays,errorBars,fieldId}',
    p_spec#>>'{overlays,errorBars,lowerFieldId}',
    p_spec#>>'{overlays,errorBars,upperFieldId}',
    p_spec#>>'{typeParams,heatmap,valueField,fieldId}'
  ];
  IF jsonb_typeof(p_spec->'filters') = 'array' THEN
    FOR filter IN SELECT value FROM jsonb_array_elements(p_spec->'filters')
    LOOP
      ids := ids || (filter->>'fieldId');
    END LOOP;
  END IF;
  IF jsonb_typeof(p_spec->'transformations') = 'array' THEN
    FOR transformation IN SELECT value FROM jsonb_array_elements(p_spec->'transformations')
    LOOP
      params := COALESCE(transformation->'params', '{}'::jsonb);
      ids := ids || ARRAY[
        params->>'fieldId',
        params->>'xField',
        params->>'yField',
        params->>'seriesField'
      ];
    END LOOP;
  END IF;
  RETURN ARRAY(
    SELECT DISTINCT u
      FROM unnest(ids) AS u
     WHERE u IS NOT NULL AND u <> ''
     ORDER BY 1
  );
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."chart_spec_referenced_field_ids"(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."chart_spec_referenced_field_ids"(jsonb) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."freeze_chart"(
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
  v_spec jsonb;
  v_payload jsonb;
  v_dataset jsonb;
  v_ds "api"."datasets";
  v_version_row "api"."dataset_versions";
  v_schema_version int;
  v_f "api"."dataset_schema_version_fields"%ROWTYPE;
  v_keep_fields text[];
  v_col_meta jsonb := '[]'::jsonb;
  v_rowcount int;
  v_checksum text;
  v_frozen jsonb;
  v_data jsonb;
BEGIN
  SELECT * INTO v_block FROM "api"."blocks" WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'chart' THEN
    RAISE EXCEPTION 'block is not a chart' USING ERRCODE = '23514';
  END IF;
  IF v_block.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, v_block.version USING ERRCODE = 'SB001';
  END IF;
  IF jsonb_typeof(v_block.payload->'frozen') = 'object' THEN
    RAISE EXCEPTION 'chart is already frozen' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(v_block.payload->'spec') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid chart spec' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_owner FROM "api"."records" WHERE id = v_block.record_id;
  IF v_owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503'; END IF;
  IF v_owner.workspace_id IS DISTINCT FROM "api"."current_workspace_id"()
     OR NOT "api"."is_workspace_writer"(v_owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;

  v_spec := v_block.payload->'spec';
  v_dataset := v_spec->'datasets'->0;
  SELECT * INTO v_ds FROM "api"."datasets"
    WHERE id = (v_dataset->>'datasetId')::uuid AND lifecycle = 'active';
  IF v_ds.id IS NULL OR v_ds.workspace_id <> v_owner.workspace_id THEN
    RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE = '23514';
  END IF;
  SELECT sv.version INTO v_schema_version FROM "api"."dataset_schema_versions" sv
    WHERE sv.id = v_ds.schema_version_id;

  v_version_row := "api"."snapshot_dataset"(
    v_ds.id,
    v_ds.revision,
    left('chart block ' || v_block.id::text, 200)
  );

  v_keep_fields := "api"."chart_spec_referenced_field_ids"(v_spec);

  FOR v_f IN
    SELECT * FROM "api"."dataset_schema_version_fields" f
     WHERE f.schema_version_id = v_ds.schema_version_id AND f.lifecycle = 'active'
     ORDER BY f.display_order, f.field_id
  LOOP
    IF v_f.field_id::text = ANY(v_keep_fields) THEN
      v_col_meta := v_col_meta || jsonb_build_object(
        'fieldId', v_f.field_id,
        'label', v_f.label,
        'unit', COALESCE(v_f.quantity, 'null'::jsonb),
        'logicalType', v_f.logical_type
      );
    END IF;
  END LOOP;

  SELECT count(*)::int INTO v_rowcount
    FROM "api"."dataset_version_rows"
    WHERE dataset_version_id = v_version_row.id;
  IF v_rowcount = 0 THEN
    RAISE EXCEPTION 'empty dataset' USING ERRCODE = '23514';
  END IF;

  SELECT md5(COALESCE(string_agg(
    vr.row_id::text || ':' || coalesce(vv.field_id::text, '') || ':' ||
    coalesce(vv.ordinal::text, '0') || ':' ||
    coalesce(
      vv.numeric_value::text,
      vv.integer_value::text,
      vv.text_value,
      vv.boolean_value::text,
      vv.date_value::text,
      vv.timestamp_value::text,
      vv.category_option_id::text,
      vv.reference_id::text,
      ''
    ),
    E'\n' ORDER BY vr.row_id, vv.field_id, vv.ordinal
  ), ''))
    INTO v_checksum
    FROM "api"."dataset_version_rows" vr
    LEFT JOIN "api"."dataset_version_values" vv
      ON vv.dataset_version_id = vr.dataset_version_id
     AND vv.row_id = vr.row_id
   WHERE vr.dataset_version_id = v_version_row.id;

  v_data := jsonb_build_object(
    'columns', v_col_meta,
    'rows', '[]'::jsonb,
    'series', '[]'::jsonb
  );

  v_frozen := jsonb_build_object(
    'revisionId', 'null'::jsonb,
    'frozenAt', to_jsonb(to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
    'frozenByUserId', to_jsonb("api"."current_user_id"()),
    'datasetProvenance', jsonb_build_array(jsonb_build_object(
      'datasetId', v_ds.id,
      'datasetVersionId', v_version_row.id,
      'schemaVersionNumber', v_schema_version,
      'rowCount', v_rowcount,
      'checksum', v_checksum
    )),
    'data', v_data
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
REVOKE EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."freeze_chart"(uuid, int) TO authenticated;
