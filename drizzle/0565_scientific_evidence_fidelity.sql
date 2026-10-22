-- Use the selected immutable source, including its schema, in both freeze paths.
-- Snapshot exploration includes flagged values; live exploration excludes rows
-- flagged on bound fields. Persist the policy rather than reinterpreting old
-- evidence. Historical payloads without a policy keep their all-values meaning.
CREATE FUNCTION api.analysis_evidence_source(p_ref jsonb, p_workspace_id uuid, p_label text)
RETURNS api.dataset_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ds api.datasets; pinned api.dataset_versions;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO ds FROM api.datasets
    WHERE id=(p_ref->>'datasetId')::uuid AND workspace_id=p_workspace_id FOR UPDATE;
  IF ds.id IS NULL THEN RAISE EXCEPTION 'invalid dataset reference' USING ERRCODE='23514'; END IF;
  IF p_ref->>'datasetVersionId' IS NOT NULL THEN
    SELECT * INTO pinned FROM api.dataset_versions
      WHERE id=(p_ref->>'datasetVersionId')::uuid AND dataset_id=ds.id AND workspace_id=p_workspace_id;
    IF pinned.id IS NULL OR EXISTS (SELECT 1 FROM api.dataset_version_prunes WHERE dataset_version_id=pinned.id) THEN
      RAISE EXCEPTION 'invalid dataset version reference' USING ERRCODE='23514';
    END IF;
  ELSE
    pinned := api.snapshot_dataset(ds.id,ds.revision,left(p_label,200));
  END IF;
  RETURN pinned;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.analysis_evidence_source(jsonb,uuid,text) FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
-- The existing version flag table stays private. Return frozen flag provenance
-- only after checking the same membership boundary as version row queries.
CREATE FUNCTION api.analysis_dataset_version_flags(p_dataset_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE pinned api.dataset_versions; result jsonb;
BEGIN
  SELECT * INTO pinned FROM api.dataset_versions
    WHERE id=p_dataset_version_id AND workspace_id=api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  IF pinned.id IS NULL THEN RAISE EXCEPTION 'dataset version denied' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',f.dataset_version_id::text || ':' || f.row_id::text || ':' || f.field_id::text || ':' || f.kind || ':' || f.source,
    'datasetId',pinned.dataset_id,'rowId',f.row_id,'fieldId',f.field_id,
    'kind',f.kind,'source',f.source,'systemRule',f.system_rule,
    'reason',f.reason,'comment',f.comment,'evaluatedValue',f.evaluated_value,
    'threshold',f.threshold,'evaluatedAt',f.evaluated_at,'setAt',f.set_at
  ) ORDER BY f.row_id,f.field_id,f.kind,f.source),'[]'::jsonb) INTO result
  FROM api.dataset_version_flags f WHERE f.dataset_version_id=pinned.id;
  RETURN result;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.analysis_dataset_version_flags(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.analysis_dataset_version_flags(uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.freeze_analysis_block(p_block_id uuid,p_expected_version int)
RETURNS api.blocks LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b api.blocks; owner api.records; definition jsonb; definition_name text; definition_version int;
  chart jsonb; ref jsonb; pinned api.dataset_versions; schema_version int;
  bound_fields text[]; columns jsonb; rowcount bigint; checksum text; frozen jsonb;
BEGIN
  SELECT * INTO b FROM api.blocks WHERE id=p_block_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE='42501'; END IF;
  IF b.type<>'analysis' THEN RAISE EXCEPTION 'block is not an analysis' USING ERRCODE='23514'; END IF;
  IF b.version<>p_expected_version THEN RAISE EXCEPTION 'block version mismatch' USING ERRCODE='SB001'; END IF;
  IF jsonb_typeof(b.payload->'frozen')='object' THEN RAISE EXCEPTION 'analysis is already frozen' USING ERRCODE='23514'; END IF;
  SELECT * INTO owner FROM api.records WHERE id=b.record_id;
  IF owner.id IS NULL OR owner.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE='42501';
  END IF;
  SELECT d.definition,d.name,d.version INTO definition,definition_name,definition_version
    FROM api.analysis_definitions d WHERE d.id=(b.payload->>'definitionId')::uuid AND d.workspace_id=owner.workspace_id;
  IF definition IS NULL THEN RAISE EXCEPTION 'invalid analysis definition reference' USING ERRCODE='23514'; END IF;
  IF jsonb_typeof(definition->'datasets') IS DISTINCT FROM 'array' OR jsonb_array_length(definition->'datasets')<>1 THEN
    RAISE EXCEPTION 'definition must reference exactly one dataset' USING ERRCODE='23514';
  END IF;
  ref := definition->'datasets'->0;
  chart := nullif(definition->'chart','null'::jsonb);
  IF definition->>'kind'='chart' AND jsonb_typeof(chart) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a chart analysis must carry its chart' USING ERRCODE='23514';
  END IF;
  IF chart IS NOT NULL AND (jsonb_typeof(chart) IS DISTINCT FROM 'object'
    OR jsonb_typeof(chart->'datasets') IS DISTINCT FROM 'array' OR jsonb_array_length(chart->'datasets')<>1
    OR chart#>>'{datasets,0,datasetId}' IS DISTINCT FROM ref->>'datasetId'
    OR chart#>>'{datasets,0,datasetVersionId}' IS DISTINCT FROM ref->>'datasetVersionId') THEN
    RAISE EXCEPTION 'the chart must read the analysis dataset and version' USING ERRCODE='23514';
  END IF;
  pinned := api.analysis_evidence_source(ref,owner.workspace_id,'analysis block ' || b.id::text);
  SELECT sv.version INTO schema_version FROM api.dataset_schema_versions sv WHERE sv.id=pinned.schema_version_id;
  bound_fields := array_remove(ARRAY[definition#>>'{value,fieldId}',definition#>>'{group,fieldId}',
    definition#>>'{outcome,fieldId}',definition#>>'{predictor,fieldId}']::text[],NULL);
  IF chart IS NOT NULL THEN bound_fields := bound_fields || api.chart_spec_referenced_field_ids(chart); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId',f.field_id,'label',f.label,
    'logicalType',f.logical_type,'unit',f.quantity) ORDER BY f.display_order,f.field_id),'[]'::jsonb)
    INTO columns FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id=pinned.schema_version_id AND f.lifecycle='active' AND f.field_id::text=ANY(bound_fields);
  SELECT count(*),md5(coalesce(jsonb_agg(row_values ORDER BY row_id)::text,'[]')) INTO rowcount,checksum FROM (
    SELECT vr.row_id,coalesce((SELECT jsonb_object_agg(j.field_id,j.val) FROM (
      SELECT v.field_id,CASE WHEN count(*)=1 THEN
        (jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),
          to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal))->0
        ELSE jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),
          to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal) END AS val
      FROM api.dataset_version_values v WHERE v.dataset_version_id=pinned.id AND v.row_id=vr.row_id
        AND v.field_id::text=ANY(bound_fields) GROUP BY v.field_id
    ) j),'{}'::jsonb) AS row_values FROM api.dataset_version_rows vr WHERE vr.dataset_version_id=pinned.id
  ) per_row;
  IF rowcount=0 THEN RAISE EXCEPTION 'empty dataset' USING ERRCODE='23514'; END IF;
  IF rowcount>100000 THEN RAISE EXCEPTION 'dataset exceeds 100000-row analysis limit' USING ERRCODE='23514'; END IF;
  frozen := jsonb_build_object('revisionId',NULL,'frozenAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'frozenByUserId',api.current_user_id(),'methodVersion',1,
    'exclusionPolicy',CASE WHEN ref->>'datasetVersionId' IS NULL THEN 'exclude_bound_fields' ELSE 'include_flagged' END,
    'definition',definition,'definitionName',definition_name,'definitionVersion',definition_version,'columns',columns,
    'datasetProvenance',jsonb_build_array(jsonb_build_object('datasetId',pinned.dataset_id,'datasetVersionId',pinned.id,
      'schemaVersionNumber',schema_version,'sourceDatasetRevision',pinned.source_dataset_revision,
      'rowCount',rowcount,'checksum',checksum)));
  UPDATE api.blocks SET payload=jsonb_set(b.payload,ARRAY['frozen'],frozen),version=b.version+1,
    updated_by_user_id=api.current_user_id() WHERE id=p_block_id RETURNING * INTO b;
  RETURN b;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.freeze_analysis_block(uuid,int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.freeze_analysis_block(uuid,int) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.freeze_chart(p_block_id uuid,p_expected_version int)
RETURNS api.blocks LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  b api.blocks; owner api.records; spec jsonb; ref jsonb; pinned api.dataset_versions;
  schema_version int; columns jsonb; rowcount bigint; checksum text; frozen jsonb;
BEGIN
  SELECT * INTO b FROM api.blocks WHERE id=p_block_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE='42501'; END IF;
  IF b.type<>'chart' THEN RAISE EXCEPTION 'block is not a chart' USING ERRCODE='23514'; END IF;
  IF b.version<>p_expected_version THEN RAISE EXCEPTION 'block version mismatch' USING ERRCODE='SB001'; END IF;
  IF jsonb_typeof(b.payload->'frozen')='object' THEN RAISE EXCEPTION 'chart is already frozen' USING ERRCODE='23514'; END IF;
  SELECT * INTO owner FROM api.records WHERE id=b.record_id;
  IF owner.id IS NULL OR owner.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(owner.workspace_id) THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE='42501';
  END IF;
  spec := b.payload->'spec';
  IF jsonb_typeof(spec) IS DISTINCT FROM 'object' OR jsonb_array_length(spec->'datasets')<>1 THEN
    RAISE EXCEPTION 'invalid chart spec' USING ERRCODE='23514';
  END IF;
  ref := spec->'datasets'->0;
  pinned := api.analysis_evidence_source(ref,owner.workspace_id,'chart block ' || b.id::text);
  SELECT sv.version INTO schema_version FROM api.dataset_schema_versions sv WHERE sv.id=pinned.schema_version_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId',f.field_id,'label',f.label,
    'logicalType',f.logical_type,'unit',f.quantity) ORDER BY f.display_order,f.field_id),'[]'::jsonb)
    INTO columns FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id=pinned.schema_version_id AND f.lifecycle='active'
      AND f.field_id::text=ANY(api.chart_spec_referenced_field_ids(spec));
  SELECT count(*) INTO rowcount FROM api.dataset_version_rows WHERE dataset_version_id=pinned.id;
  IF rowcount=0 THEN RAISE EXCEPTION 'empty dataset' USING ERRCODE='23514'; END IF;
  IF rowcount>100000 THEN RAISE EXCEPTION 'dataset exceeds 100000-row analysis limit' USING ERRCODE='23514'; END IF;
  SELECT md5(coalesce(string_agg(vr.row_id::text || ':' || coalesce(vv.field_id::text,'') || ':' ||
    coalesce(vv.ordinal::text,'0') || ':' || coalesce(vv.numeric_value::text,vv.integer_value::text,vv.text_value,
      vv.boolean_value::text,vv.date_value::text,vv.timestamp_value::text,vv.category_option_id::text,vv.reference_id::text,''),
    E'\n' ORDER BY vr.row_id,vv.field_id,vv.ordinal),'')) INTO checksum
    FROM api.dataset_version_rows vr LEFT JOIN api.dataset_version_values vv
      ON vv.dataset_version_id=vr.dataset_version_id AND vv.row_id=vr.row_id WHERE vr.dataset_version_id=pinned.id;
  frozen := jsonb_build_object('revisionId',NULL,'frozenAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'frozenByUserId',api.current_user_id(),
    'exclusionPolicy',CASE WHEN ref->>'datasetVersionId' IS NULL THEN 'exclude_bound_fields' ELSE 'include_flagged' END,
    'datasetProvenance',jsonb_build_array(jsonb_build_object('datasetId',pinned.dataset_id,'datasetVersionId',pinned.id,
      'schemaVersionNumber',schema_version,'rowCount',rowcount,'checksum',checksum)),
    'data',jsonb_build_object('columns',columns,'rows','[]'::jsonb,'series','[]'::jsonb));
  UPDATE api.blocks SET payload=jsonb_set(b.payload,ARRAY['frozen'],frozen),version=b.version+1,
    updated_by_user_id=api.current_user_id() WHERE id=p_block_id RETURNING * INTO b;
  RETURN b;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.freeze_chart(uuid,int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.freeze_chart(uuid,int) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
