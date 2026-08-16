-- CORE-03.15: retirement prevents new use without invalidating pinned
-- consumers; archived Dataset sources remain readable through existing
-- resolved Sheet Instances only.
CREATE OR REPLACE FUNCTION api.create_sheet_instance_from_definition(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb,p_parameter_inputs jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE defaults jsonb; result api.sheet_instances;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(
    SELECT 1
    FROM api.sheet_definition_versions version
    JOIN api.sheet_definitions definition ON definition.id=version.definition_id
    WHERE version.id=p_source_definition_version_id
      AND version.lifecycle='published'
      AND definition.workspace_id=p_workspace_id
      AND definition.lifecycle='active'
  ) THEN
    RAISE EXCEPTION 'source Definition Version must be published, active, and in this workspace' USING ERRCODE='SB074';
  END IF;
  IF NOT p_state ? 'presentation' THEN
    SELECT configuration->'presentation' INTO defaults FROM api.sheet_definition_versions WHERE id=p_source_definition_version_id;
    p_state:=jsonb_set(p_state,'{presentation}',defaults,true);
  END IF;
  PERFORM internal.validate_sheet_instance_presentation(p_source_definition_version_id,p_state);
  result:=api.create_sheet_instance_from_definition_core0311(p_workspace_id,p_name,p_description,p_source_definition_version_id,p_project_id,p_notebook_record_id,jsonb_set(p_state,'{presentation}',(p_state->'presentation')-'filters'-'sorts'),p_parameter_inputs);
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=jsonb_set(result.state,'{presentation}',p_state->'presentation') WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.query_sheet_instance_rows_core036(
  p_instance_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; config jsonb; identity jsonb; root_binding text;
  root_dataset uuid; root_row record; join_item jsonb;
  left_field uuid; right_field uuid; right_dataset uuid; right_rows uuid[]; left_key uuid; left_key_count integer;
  result_rows jsonb:='[]'::jsonb; sources jsonb; source_values jsonb; source_row_id uuid;
  source_revision bigint; matched boolean; include_row boolean; identity_values jsonb:='[]'::jsonb;
  identity_column text; identity_binding text; identity_field uuid; value_item jsonb;
  root_count integer:=0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
  THEN RAISE EXCEPTION 'Sheet composition limit must be 1 to 200 and offset 0 to 10000' USING ERRCODE='22023'; END IF;
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF instance.lifecycle<>'active' OR instance.source_definition_version_id IS NULL
     OR NOT (instance.state?'resolutionProvenance') OR NOT (instance.state?'resolvedRowIdentity')
  THEN RAISE EXCEPTION 'Sheet Instance is unresolved, stale, or not composable' USING ERRCODE='SB076'; END IF;
  SELECT configuration INTO config FROM api.sheet_definition_versions WHERE id=instance.source_definition_version_id AND lifecycle='published';
  IF config IS NULL OR instance.state->'resolutionProvenance'->>'sourceDefinitionVersionId'<>instance.source_definition_version_id::text
  THEN RAISE EXCEPTION 'Sheet Instance resolution provenance is stale' USING ERRCODE='SB076'; END IF;
  identity:=instance.state->'resolvedRowIdentity';
  IF identity->>'kind'='local' THEN RAISE EXCEPTION 'local identities have no Dataset composition source' USING ERRCODE='SB076'; END IF;
  SELECT coalesce((config->'joins')->0->>'leftBindingId',(config->'bindings')->0->>'id') INTO root_binding;
  IF root_binding IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(config->'joins') j WHERE j->>'leftBindingId'<>root_binding)
  THEN RAISE EXCEPTION 'Sheet composition supports one explicit left source with bounded joins' USING ERRCODE='SB076'; END IF;
  SELECT (value->>'datasetId')::uuid INTO root_dataset FROM jsonb_array_elements(instance.state->'bindings') WHERE value->>'bindingId'=root_binding AND value->>'kind'='dataset';
  IF root_dataset IS NULL OR NOT EXISTS(SELECT 1 FROM api.datasets WHERE id=root_dataset AND workspace_id=instance.workspace_id AND lifecycle IN ('active','archived')) THEN RAISE EXCEPTION 'Sheet composition supports resolved Dataset bindings only' USING ERRCODE='SB076'; END IF;
  FOR root_row IN SELECT id,revision FROM api.dataset_rows WHERE dataset_id=root_dataset ORDER BY id LIMIT p_limit+1 OFFSET p_offset LOOP
    root_count:=root_count+1; IF root_count>p_limit THEN EXIT; END IF;
    sources:='[]'::jsonb; include_row:=true;
    SELECT internal.sheet_composition_source_values(root_row.id,root_dataset) INTO source_values;
    sources:=sources||jsonb_build_array(jsonb_build_object('bindingId',root_binding,'datasetId',root_dataset,'rowId',root_row.id,'revision',root_row.revision,'matched',true,'values',source_values));
    FOR join_item IN SELECT value FROM jsonb_array_elements(config->'joins') LOOP
      SELECT (c.value->'source'->>'sourceFieldId')::uuid INTO left_field FROM jsonb_array_elements(config->'columns') c WHERE c.value->>'id'=join_item->>'leftColumnId';
      SELECT (c.value->'source'->>'sourceFieldId')::uuid INTO right_field FROM jsonb_array_elements(config->'columns') c WHERE c.value->>'id'=join_item->>'rightColumnId';
      SELECT (value->>'datasetId')::uuid INTO right_dataset FROM jsonb_array_elements(instance.state->'bindings') WHERE value->>'bindingId'=join_item->>'rightBindingId' AND value->>'kind'='dataset';
      IF right_dataset IS NULL OR NOT EXISTS(SELECT 1 FROM api.datasets WHERE id=right_dataset AND workspace_id=instance.workspace_id AND lifecycle IN ('active','archived')) THEN RAISE EXCEPTION 'join binding is unresolved or unsupported' USING ERRCODE='SB076'; END IF;
      SELECT reference_id INTO left_key FROM api.dataset_row_values WHERE row_id=root_row.id AND field_id=left_field;
      IF left_key IS NULL THEN RAISE EXCEPTION 'join key is missing' USING ERRCODE='SB076'; END IF;
      IF join_item->>'cardinality'='one-to-one' THEN SELECT count(*) INTO left_key_count FROM api.dataset_row_values v JOIN api.dataset_rows r ON r.id=v.row_id WHERE r.dataset_id=root_dataset AND v.field_id=left_field AND v.reference_id=left_key; IF left_key_count>1 THEN RAISE EXCEPTION 'join cardinality violation: duplicate left identity' USING ERRCODE='SB076'; END IF; END IF;
      SELECT array_agg(r.id ORDER BY r.id) INTO right_rows FROM api.dataset_rows r JOIN api.dataset_row_values rv ON rv.row_id=r.id AND rv.field_id=right_field WHERE r.dataset_id=right_dataset AND rv.reference_id=left_key;
      IF coalesce(array_length(right_rows,1),0)>1 THEN RAISE EXCEPTION 'join cardinality violation: duplicate right identity' USING ERRCODE='SB076'; END IF;
      matched:=coalesce(array_length(right_rows,1),0)=1;
      IF NOT matched AND join_item->>'joinType'='inner' THEN include_row:=false; END IF;
      source_row_id:=right_rows[1];
      IF matched THEN SELECT revision INTO source_revision FROM api.dataset_rows WHERE id=source_row_id; SELECT internal.sheet_composition_source_values(source_row_id,right_dataset) INTO source_values; ELSE source_revision:=NULL; source_values:='{}'::jsonb; END IF;
      sources:=sources||jsonb_build_array(jsonb_build_object('bindingId',join_item->>'rightBindingId','datasetId',right_dataset,'rowId',source_row_id,'revision',source_revision,'matched',matched,'values',source_values));
    END LOOP;
    IF include_row THEN
      identity_values:='[]'::jsonb;
      FOR identity_column IN SELECT value FROM jsonb_array_elements_text(identity->'columnIds') LOOP
        SELECT c.value->'source'->>'bindingId',(c.value->'source'->>'sourceFieldId')::uuid INTO identity_binding,identity_field FROM jsonb_array_elements(config->'columns') c WHERE c.value->>'id'=identity_column;
        SELECT s.value->'values'->identity_field::text INTO value_item FROM jsonb_array_elements(sources) s WHERE s.value->>'bindingId'=identity_binding;
        IF value_item IS NULL OR value_item='null'::jsonb THEN RAISE EXCEPTION 'composed row is missing its resolved identity value' USING ERRCODE='SB076'; END IF;
        identity_values:=identity_values||jsonb_build_array(value_item);
      END LOOP;
      result_rows:=result_rows||jsonb_build_array(jsonb_build_object('identityValues',identity_values,'sources',sources));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('instanceId',instance.id,'revision',instance.revision,'offset',p_offset,'limit',p_limit,'hasMore',root_count>p_limit,'identity',jsonb_build_object('kind',identity->>'kind','columnIds',identity->'columnIds','logicalTypes',identity->'logicalTypes'),'rows',result_rows);
END $$;

REVOKE EXECUTE ON FUNCTION api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,api_client;
REVOKE EXECUTE ON FUNCTION api.query_sheet_instance_rows_core036(uuid,integer,integer) FROM PUBLIC,authenticated,api_client;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
