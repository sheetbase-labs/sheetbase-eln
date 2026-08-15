-- CORE-03.14: composition stays virtual until this explicit, auditable action.
CREATE TABLE api.sheet_materializations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES api.sheet_instances(id) ON DELETE RESTRICT,
  definition_version_id uuid NOT NULL REFERENCES api.sheet_definition_versions(id) ON DELETE RESTRICT,
  instance_revision bigint NOT NULL CHECK(instance_revision > 0),
  output_dataset_id uuid NOT NULL REFERENCES api.datasets(id) ON DELETE RESTRICT,
  output_dataset_version_id uuid NOT NULL REFERENCES api.dataset_versions(id) ON DELETE RESTRICT,
  output_schema_version_id uuid NOT NULL REFERENCES api.dataset_schema_versions(id) ON DELETE RESTRICT,
  source_versions jsonb NOT NULL,
  calculation_provenance jsonb NOT NULL,
  request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  actor_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
  materialized_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, actor_user_id, idempotency_key)
);
ALTER TABLE api.sheet_materializations ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheet_materializations_read ON api.sheet_materializations FOR SELECT TO authenticated
  USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
REVOKE ALL ON api.sheet_materializations FROM PUBLIC, authenticated, api_client;
GRANT SELECT ON api.sheet_materializations TO authenticated;

-- Match CORE-03.5's `rowIdentityKey`: this receives the raw identity values
-- returned by the composition RPC (not display order or A1 coordinates).
CREATE FUNCTION internal.sheet_materialization_row_key(p_identity jsonb,p_values jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE columns_json text; types_json text; values_json text; canonical text;
BEGIN
  SELECT '['||coalesce(string_agg(to_json(value)::text,','),'')||']' INTO columns_json
    FROM jsonb_array_elements_text(p_identity->'columnIds') value;
  SELECT '['||coalesce(string_agg(to_json(value)::text,','),'')||']' INTO types_json
    FROM jsonb_array_elements_text(p_identity->'logicalTypes') value;
  SELECT '['||coalesce(string_agg(value::text,','),'')||']' INTO values_json
    FROM jsonb_array_elements(p_values) value;
  canonical := '{"v":1,"kind":'||to_json(p_identity->>'kind')::text||',"columns":'||columns_json||',"types":'||types_json||',"values":'||values_json||'}';
  RETURN 'sb-row-v1:'||encode(sha256(convert_to(canonical,'UTF8')),'hex');
END $$;

CREATE FUNCTION internal.sheet_materialization_preview(p_instance api.sheet_instances, p_schema_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE config jsonb; fields jsonb; source_versions jsonb; selected_count integer; expected_count integer;
BEGIN
  IF p_instance.lifecycle <> 'active' OR p_instance.source_definition_version_id IS NULL THEN
    RAISE EXCEPTION 'active Definition-backed Sheet Instance required' USING ERRCODE='SB089';
  END IF;
  SELECT configuration INTO config FROM api.sheet_definition_versions
    WHERE id=p_instance.source_definition_version_id AND lifecycle='published';
  IF config IS NULL THEN RAISE EXCEPTION 'pinned Definition Version is unavailable' USING ERRCODE='SB089'; END IF;
  fields := coalesce((SELECT jsonb_agg(jsonb_build_object('id',value->>'id','kind','definition-column','field',value->'field','source',value->'source') ORDER BY ordinality)
    FROM jsonb_array_elements(config->'columns') WITH ORDINALITY item(value,ordinality)
    WHERE value->'field'->>'lifecycle'='active'), '[]'::jsonb)
    || coalesce((SELECT jsonb_agg(jsonb_build_object('id',value->>'fieldId','kind','local-field','field',value) ORDER BY ordinality)
      FROM jsonb_array_elements(p_instance.state->'localFields') WITH ORDINALITY item(value,ordinality)
      WHERE value->>'lifecycle'='active'), '[]'::jsonb)
    || coalesce((SELECT jsonb_agg(jsonb_build_object('id',value->>'id','kind','instance-calculation','field',value->'outputField','calculationId',value->>'id') ORDER BY ordinality)
      FROM jsonb_array_elements(coalesce(p_instance.state->'instanceCalculations','[]'::jsonb)) WITH ORDINALITY item(value,ordinality)
      WHERE value->>'lifecycle'='active'), '[]'::jsonb);
  IF jsonb_array_length(fields)=0 THEN RAISE EXCEPTION 'materialization requires an active output field' USING ERRCODE='SB089'; END IF;
  source_versions := coalesce((SELECT jsonb_agg(jsonb_build_object(
    'bindingId',binding->>'bindingId','datasetId',binding->>'datasetId',
    'datasetRevision',dataset.revision,'schemaVersionId',dataset.schema_version_id,
    'pinKind',CASE WHEN binding->'policy'->>'mode'='version' THEN 'pinned-version' ELSE 'live-snapshot' END,
    'datasetVersionId',CASE WHEN binding->'policy'->>'mode'='version' THEN binding->'policy'->>'datasetVersionId' ELSE NULL END,
    'policy',binding->'policy'
  ) ORDER BY binding->>'bindingId')
    FROM jsonb_array_elements(p_instance.state->'bindings') binding
    JOIN api.datasets dataset ON dataset.id=(binding->>'datasetId')::uuid
    WHERE binding->>'kind'='dataset' AND dataset.workspace_id=p_instance.workspace_id
  ), '[]'::jsonb);
  IF jsonb_array_length(source_versions)=0 THEN RAISE EXCEPTION 'materialization requires Dataset composition sources' USING ERRCODE='SB089'; END IF;
  IF p_schema_version_id IS NOT NULL THEN
    SELECT count(*) INTO selected_count FROM api.dataset_schema_version_fields f
      JOIN api.dataset_schema_versions v ON v.id=f.schema_version_id
      JOIN api.dataset_schema_definitions d ON d.id=v.schema_id
      WHERE f.schema_version_id=p_schema_version_id AND f.lifecycle='active'
        AND v.lifecycle='active' AND d.workspace_id=p_instance.workspace_id;
    SELECT count(*) INTO expected_count FROM jsonb_array_elements(fields);
    IF selected_count<>expected_count OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(fields) field
      WHERE NOT EXISTS(SELECT 1 FROM api.dataset_schema_version_fields f
        WHERE f.schema_version_id=p_schema_version_id AND f.lifecycle='active'
          AND f.field_id=(field->'field'->>'fieldId')::uuid
          AND (jsonb_build_object('logicalType',f.logical_type,'nullable',f.nullable,'cardinality',f.cardinality,'quantity',f.quantity,'validation',f.validation,'category',f.category,'relationship',f.relationship)
            IS DISTINCT FROM jsonb_build_object('logicalType',field->'field'->>'logicalType','nullable',(field->'field'->>'nullable')::boolean,'cardinality',field->'field'->>'cardinality','quantity',field->'field'->'quantity','validation',field->'field'->'validation','category',field->'field'->'category','relationship',field->'field'->'relationship')))
    ) THEN RAISE EXCEPTION 'selected output Dataset Schema is not semantically compatible' USING ERRCODE='SB089'; END IF;
  END IF;
  RETURN jsonb_build_object('instanceId',p_instance.id,'instanceRevision',p_instance.revision,
    'definitionVersionId',p_instance.source_definition_version_id,'outputSchemaVersionId',p_schema_version_id,
    'derivedOutputFields',fields,'sourceVersions',source_versions,
    'previewDigest',encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance.id,'revision',p_instance.revision,'schemaVersionId',p_schema_version_id,'fields',fields,'sources',source_versions)::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION api.preview_sheet_materialization(p_instance_id uuid,p_expected_instance_revision bigint,p_output_schema_version_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR SHARE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB089'; END IF;
  RETURN internal.sheet_materialization_preview(instance,p_output_schema_version_id);
END $$;

CREATE FUNCTION api.materialize_sheet_instance(
  p_instance_id uuid,p_expected_instance_revision bigint,p_output_name text,
  p_output_schema_version_id uuid,p_preview_digest text,p_idempotency_key uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; actor text:=api.current_user_id(); prior api.sheet_materializations;
  preview jsonb; request_digest text; source jsonb; snapshot api.dataset_versions; schema_version uuid;
  schema_id uuid; output api.datasets; output_snapshot api.dataset_versions; composition jsonb; row_item jsonb;
  config jsonb; column_item jsonb; values jsonb; cell_value jsonb; materialized_row_key text; rows jsonb:='[]'::jsonb; batch_result jsonb; field_count integer:=0;
BEGIN
  IF actor IS NULL OR p_idempotency_key IS NULL OR length(btrim(p_output_name)) NOT BETWEEN 1 AND 200
     OR p_preview_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid materialization request' USING ERRCODE='22023'; END IF;
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  request_digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_instance_revision,'name',p_output_name,'schemaVersionId',p_output_schema_version_id,'previewDigest',p_preview_digest)::text,'UTF8')),'hex');
  SELECT * INTO prior FROM api.sheet_materializations WHERE workspace_id=instance.workspace_id AND actor_user_id=actor AND idempotency_key=p_idempotency_key;
  IF prior.id IS NOT NULL THEN
    IF prior.request_digest<>request_digest THEN RAISE EXCEPTION 'idempotency key was used for a different materialization' USING ERRCODE='23505'; END IF;
    RETURN jsonb_build_object('materializationId',prior.id,'datasetId',prior.output_dataset_id,'datasetVersionId',prior.output_dataset_version_id,'idempotent',true);
  END IF;
  IF instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB089'; END IF;
  -- Lock every live Dataset before composition; the existing controlled bulk
  -- writer takes this same lock, so the previewed source revisions cannot race.
  FOR source IN SELECT value FROM jsonb_array_elements(instance.state->'bindings') LOOP
    IF source->>'kind'='dataset' AND source->'policy'->>'mode'='live' THEN
      PERFORM 1 FROM api.datasets WHERE id=(source->>'datasetId')::uuid AND workspace_id=instance.workspace_id FOR UPDATE;
    END IF;
  END LOOP;
  preview:=internal.sheet_materialization_preview(instance,p_output_schema_version_id);
  IF preview->>'previewDigest'<>p_preview_digest THEN RAISE EXCEPTION 'materialization preview is stale' USING ERRCODE='SB089'; END IF;
  FOR source IN SELECT value FROM jsonb_array_elements(preview->'sourceVersions') LOOP
    IF source->'policy'->>'mode'='live' THEN
      SELECT * INTO snapshot FROM api.snapshot_dataset((source->>'datasetId')::uuid,(source->>'datasetRevision')::bigint,'Sheet materialization source');
      preview:=jsonb_set(preview,'{sourceVersions}',(
        SELECT jsonb_agg(CASE WHEN value->>'bindingId'=source->>'bindingId' THEN value||jsonb_build_object('datasetVersionId',snapshot.id) ELSE value END ORDER BY value->>'bindingId')
        FROM jsonb_array_elements(preview->'sourceVersions') value),true);
    END IF;
  END LOOP;
  schema_version:=p_output_schema_version_id;
  IF schema_version IS NULL THEN
    INSERT INTO api.dataset_schema_definitions(workspace_id,key,name,description,lifecycle,created_by_user_id)
      VALUES(instance.workspace_id,'sheet_materialized_'||substr(replace(gen_random_uuid()::text,'-',''),1,12),p_output_name,'Derived from Sheet materialization','draft',actor) RETURNING id INTO schema_id;
    INSERT INTO api.dataset_schema_versions(schema_id,version,lifecycle,created_by_user_id) VALUES(schema_id,1,'draft',actor) RETURNING id INTO schema_version;
    FOR column_item IN SELECT value FROM jsonb_array_elements(preview->'derivedOutputFields') LOOP
      IF column_item->'field'->>'lifecycle'='active' THEN
        field_count:=field_count+1;
        INSERT INTO api.dataset_schema_version_fields(schema_version_id,field_id,key,label,description,logical_type,nullable,default_value,quantity,validation,category,relationship,cardinality,lifecycle,display_order)
        VALUES(schema_version,(column_item->'field'->>'fieldId')::uuid,column_item->'field'->>'key',column_item->'field'->>'label',nullif(column_item->'field'->'description','null'::jsonb)#>>'{}',column_item->'field'->>'logicalType',(column_item->'field'->>'nullable')::boolean,nullif(column_item->'field'->'defaultValue','null'::jsonb),nullif(column_item->'field'->'quantity','null'::jsonb),coalesce(nullif(column_item->'field'->'validation','null'::jsonb),'{}'::jsonb),nullif(column_item->'field'->'category','null'::jsonb),nullif(column_item->'field'->'relationship','null'::jsonb),column_item->'field'->>'cardinality','active',field_count);
      END IF;
    END LOOP;
    UPDATE api.dataset_schema_versions SET lifecycle='active',published_at=now() WHERE id=schema_version;
  END IF;
  INSERT INTO api.datasets(workspace_id,schema_version_id,name,created_by_user_id) VALUES(instance.workspace_id,schema_version,btrim(p_output_name),actor) RETURNING * INTO output;
  composition:=api.query_sheet_instance_rows(instance.id,200,0);
  IF (composition->>'hasMore')::boolean THEN
    RAISE EXCEPTION 'materialization exceeds the current bounded composition window' USING ERRCODE='SB089';
  END IF;
  SELECT configuration INTO config FROM api.sheet_definition_versions WHERE id=instance.source_definition_version_id;
  FOR row_item IN SELECT value FROM jsonb_array_elements(composition->'rows') LOOP
    materialized_row_key:=internal.sheet_materialization_row_key(composition->'identity',row_item->'identityValues');
    values:='{}'::jsonb;
    FOR column_item IN SELECT value FROM jsonb_array_elements(config->'columns') LOOP
      IF column_item->'field'->>'lifecycle'='active' THEN
        IF column_item->'source'->>'kind'='bound' THEN
          SELECT source_row->'values'->(column_item->'source'->>'sourceFieldId') INTO cell_value
            FROM jsonb_array_elements(row_item->'sources') source_row
            WHERE source_row->>'bindingId'=column_item->'source'->>'bindingId';
          values:=values||jsonb_build_object(column_item->'field'->>'fieldId',coalesce(cell_value,'null'::jsonb));
        ELSIF column_item->'source'->>'kind'='declared' THEN
          values:=values||jsonb_build_object(column_item->'field'->>'fieldId',coalesce(instance.state->'localValues'->materialized_row_key->(column_item->'field'->>'fieldId'),'null'::jsonb));
        ELSE
          SELECT value INTO cell_value FROM internal.sheet_instance_calculation_results result
            WHERE result.instance_id=instance.id AND result.calculation_id=(column_item->'source'->>'calculationId')::uuid
              AND result.row_key=materialized_row_key AND result.instance_revision=instance.revision AND result.result_kind='value'
              AND internal.sheet_calculation_result_current(instance.revision,result.instance_revision,result.source_revisions);
          IF cell_value IS NULL THEN RAISE EXCEPTION 'materialization requires current successful calculation evidence' USING ERRCODE='SB089'; END IF;
          values:=values||jsonb_build_object(column_item->'field'->>'fieldId',cell_value);
        END IF;
      END IF;
    END LOOP;
    FOR column_item IN SELECT value FROM jsonb_array_elements(instance.state->'localFields') LOOP
      IF column_item->>'lifecycle'='active' THEN
        values:=values||jsonb_build_object(column_item->>'fieldId',coalesce(instance.state->'localValues'->materialized_row_key->(column_item->>'fieldId'),'null'::jsonb));
      END IF;
    END LOOP;
    FOR column_item IN SELECT value FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) LOOP
      IF column_item->>'lifecycle'='active' THEN
        SELECT value INTO cell_value FROM internal.sheet_instance_calculation_results result
          WHERE result.instance_id=instance.id AND result.calculation_id=(column_item->>'id')::uuid
            AND result.row_key=materialized_row_key AND result.instance_revision=instance.revision AND result.result_kind='value'
            AND internal.sheet_calculation_result_current(instance.revision,result.instance_revision,result.source_revisions);
        IF cell_value IS NULL THEN RAISE EXCEPTION 'materialization requires current successful calculation evidence' USING ERRCODE='SB089'; END IF;
        values:=values||jsonb_build_object(column_item->>'id',cell_value);
      END IF;
    END LOOP;
    rows:=rows||jsonb_build_array(jsonb_build_object('operation','create','rowId',gen_random_uuid(),'values',values));
  END LOOP;
  IF jsonb_array_length(rows)>0 THEN
    SELECT api.commit_dataset_row_batch(output.id,output.revision,rows,'materialize:'||p_idempotency_key::text) INTO batch_result;
    IF (batch_result->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'materialized output failed Dataset bulk validation: %',batch_result USING ERRCODE='SB089'; END IF;
  END IF;
  SELECT * INTO output_snapshot FROM api.snapshot_dataset(output.id,(SELECT revision FROM api.datasets WHERE id=output.id),'Sheet materialization output');
  INSERT INTO api.sheet_materializations(workspace_id,instance_id,definition_version_id,instance_revision,output_dataset_id,output_dataset_version_id,output_schema_version_id,source_versions,calculation_provenance,request_digest,idempotency_key,actor_user_id)
  VALUES(instance.workspace_id,instance.id,instance.source_definition_version_id,instance.revision,output.id,output_snapshot.id,schema_version,preview->'sourceVersions',jsonb_build_object(
    'resultSource','trusted_sheet_calculation_results','instanceRevision',instance.revision,
    'results',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'calculationId',result.calculation_id,'rowKey',result.row_key,'scope',result.scope,
      'definitionVersionId',result.definition_version_id,'resultKind',result.result_kind,
      'value',result.value,'errorCode',result.error_code,'sourceRevisions',result.source_revisions,
      'dependencyProvenance',result.dependency_provenance,'calculatedAt',result.calculated_at
    ) ORDER BY result.row_key,result.calculation_id)
      FROM internal.sheet_instance_calculation_results result
      WHERE result.instance_id=instance.id AND result.instance_revision=instance.revision),'[]'::jsonb)
  ),request_digest,p_idempotency_key,actor)
  RETURNING id INTO prior.id;
  RETURN jsonb_build_object('materializationId',prior.id,'datasetId',output.id,'datasetVersionId',output_snapshot.id,'schemaVersionId',schema_version,'sourceVersions',preview->'sourceVersions','idempotent',false);
END $$;

REVOKE EXECUTE ON FUNCTION internal.sheet_materialization_row_key(jsonb,jsonb),internal.sheet_materialization_preview(api.sheet_instances,uuid) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.preview_sheet_materialization(uuid,bigint,uuid),api.materialize_sheet_instance(uuid,bigint,text,uuid,text,uuid) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.preview_sheet_materialization(uuid,bigint,uuid),api.materialize_sheet_instance(uuid,bigint,text,uuid,text,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
