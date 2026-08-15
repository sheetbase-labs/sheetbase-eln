-- CORE-03.5 stable semantic row identity. Keys are generated in the shared
-- domain module; this boundary persists only the authoritative resolution.
ALTER FUNCTION internal.validate_sheet_definition_configuration(jsonb)
  RENAME TO validate_sheet_definition_configuration_core034;

CREATE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE column_item jsonb; identity_column jsonb; identity_kind text:=p_config->'rowIdentity'->>'kind'; count_columns integer:=jsonb_array_length(p_config->'rowIdentity'->'columnIds');
BEGIN
  PERFORM internal.validate_sheet_definition_configuration_core034(p_config);
  IF (identity_kind='source' AND count_columns<>1) OR (identity_kind='composite' AND count_columns NOT BETWEEN 2 AND 8) OR (identity_kind='local' AND count_columns<>1) THEN RAISE EXCEPTION 'invalid Sheet Definition row identity cardinality' USING ERRCODE='SB071'; END IF;
  FOR identity_column IN SELECT value FROM jsonb_array_elements(p_config->'rowIdentity'->'columnIds') LOOP
    SELECT value INTO column_item FROM jsonb_array_elements(p_config->'columns') WHERE value->>'id'=identity_column#>>'{}';
    IF column_item->'source'->>'kind'='calculated' OR column_item->'field'->>'cardinality'<>'one' OR column_item->'field'->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'row identity columns must be stored scalar columns' USING ERRCODE='SB071'; END IF;
    IF identity_kind IN ('source','composite') AND column_item->'source'->>'kind'<>'bound' THEN RAISE EXCEPTION 'source and composite identity columns must be bound' USING ERRCODE='SB071'; END IF;
    IF identity_kind='local' AND (column_item->'source'->>'kind'<>'declared' OR column_item->'field'->>'logicalType'<>'reference') THEN RAISE EXCEPTION 'local row identity must be one declared reference UUID column' USING ERRCODE='SB071'; END IF;
  END LOOP;
END $$;

ALTER FUNCTION internal.validate_sheet_instance_state(jsonb)
  RENAME TO validate_sheet_instance_state_core034;

CREATE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE identity jsonb:=p_state->'resolvedRowIdentity'; identity_column text; logical_type text;
BEGIN
  PERFORM internal.validate_sheet_instance_state_core034(p_state-'resolvedRowIdentity');
  IF identity IS NOT NULL THEN
    PERFORM internal.assert_sheet_definition_object(identity,ARRAY['formatVersion','kind','columnIds','logicalTypes','sourceBindingId','sourceFieldId'],ARRAY['formatVersion','kind','columnIds','logicalTypes','sourceBindingId','sourceFieldId'],'resolvedRowIdentity');
    IF identity->>'formatVersion'<>'1' OR identity->>'kind' NOT IN ('source','composite','local') OR jsonb_typeof(identity->'columnIds')<>'array' OR jsonb_typeof(identity->'logicalTypes')<>'array' OR jsonb_array_length(identity->'columnIds')<>jsonb_array_length(identity->'logicalTypes') OR jsonb_array_length(identity->'columnIds') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(identity->'columnIds') x GROUP BY x HAVING count(*)>1) OR jsonb_typeof(identity->'sourceBindingId') NOT IN ('string','null') OR jsonb_typeof(identity->'sourceFieldId') NOT IN ('string','null') THEN RAISE EXCEPTION 'invalid resolved row identity' USING ERRCODE='SB073'; END IF;
    FOR identity_column IN SELECT value FROM jsonb_array_elements_text(identity->'columnIds') LOOP PERFORM internal.sheet_definition_uuid(identity_column,'resolvedRowIdentity.columnIds'); END LOOP;
    FOR logical_type IN SELECT value FROM jsonb_array_elements_text(identity->'logicalTypes') LOOP IF logical_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference') THEN RAISE EXCEPTION 'invalid resolved row identity logical type' USING ERRCODE='SB073'; END IF; END LOOP;
    IF (identity->>'kind'='source' AND (jsonb_array_length(identity->'columnIds')<>1 OR jsonb_typeof(identity->'sourceBindingId')<>'string' OR jsonb_typeof(identity->'sourceFieldId')<>'string')) OR (identity->>'kind' IN ('composite','local') AND (identity->'sourceBindingId' IS DISTINCT FROM 'null'::jsonb OR identity->'sourceFieldId' IS DISTINCT FROM 'null'::jsonb)) OR (identity->>'kind'='local' AND identity->'logicalTypes'->>0<>'reference') THEN RAISE EXCEPTION 'invalid row identity provenance' USING ERRCODE='SB073'; END IF;
    IF identity->>'kind'='source' THEN PERFORM internal.sheet_definition_uuid(identity->>'sourceBindingId','resolvedRowIdentity.sourceBindingId'); PERFORM internal.sheet_definition_uuid(identity->>'sourceFieldId','resolvedRowIdentity.sourceFieldId'); END IF;
  END IF;
END $$;

CREATE FUNCTION api.resolve_sheet_instance_row_identity(p_instance_id uuid,p_expected_revision bigint)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; config jsonb; identity jsonb; column_item jsonb; actor text:=api.current_user_id();
BEGIN
  SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF result.lifecycle<>'active' OR result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF result.source_definition_version_id IS NULL THEN RAISE EXCEPTION 'row identity requires a pinned Definition Version' USING ERRCODE='SB073'; END IF;
  SELECT configuration INTO config FROM api.sheet_definition_versions WHERE id=result.source_definition_version_id;
  identity:=config->'rowIdentity';
  SELECT value INTO column_item FROM jsonb_array_elements(config->'columns') WHERE value->>'id'=identity->'columnIds'->>0;
  identity:=identity||jsonb_build_object('formatVersion',1,'logicalTypes',(SELECT jsonb_agg(column_value->'field'->>'logicalType' ORDER BY ids.ordinality) FROM jsonb_array_elements(identity->'columnIds') WITH ORDINALITY ids JOIN LATERAL jsonb_array_elements(config->'columns') column_value ON column_value->>'id'=ids.value#>>'{}'),'sourceBindingId',CASE WHEN identity->>'kind'='source' THEN column_item->'source'->>'bindingId' ELSE NULL END,'sourceFieldId',CASE WHEN identity->>'kind'='source' THEN column_item->'source'->>'sourceFieldId' ELSE NULL END);
  IF result.state ? 'resolvedRowIdentity' AND result.state->'resolvedRowIdentity'<>identity THEN RAISE EXCEPTION 'resolved row identity is immutable' USING ERRCODE='SB073'; END IF;
  IF result.state->'resolvedRowIdentity'=identity THEN RETURN result; END IF;
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=jsonb_set(result.state,'{resolvedRowIdentity}',identity,true),revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF; IF result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 p_state:=jsonb_set(p_state,'{provenance}',result.state->'provenance',true);
 IF result.source_definition_version_id IS NOT NULL THEN p_state:=(p_state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',result.state->'bindings','parameterValues',coalesce(result.state->'parameterValues','[]'::jsonb),'resolutionProvenance',result.state->'resolutionProvenance','resolvedRowIdentity',result.state->'resolvedRowIdentity'); ELSE SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb)); p_state:=(p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',stripped_bindings); END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_definition_configuration_core034(jsonb),internal.validate_sheet_definition_configuration(jsonb),internal.validate_sheet_instance_state_core034(jsonb),internal.validate_sheet_instance_state(jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.resolve_sheet_instance_row_identity(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.resolve_sheet_instance_row_identity(uuid,bigint) TO authenticated;
NOTIFY pgrst,'reload schema';
