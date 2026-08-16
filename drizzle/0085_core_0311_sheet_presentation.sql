-- CORE-03.11: bounded presentation preferences are mutable Instance state;
-- immutable Definition configurations provide optional defaults only.

CREATE FUNCTION internal.validate_sheet_presentation_queries(p_presentation jsonb,p_column_ids text[],p_code text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item jsonb; column_id text;
BEGIN
  IF p_presentation ? 'filters' THEN
    IF jsonb_typeof(p_presentation->'filters')<>'array' OR jsonb_array_length(p_presentation->'filters')>32 THEN RAISE EXCEPTION 'invalid bounded presentation filters' USING ERRCODE=p_code; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_presentation->'filters') LOOP
      PERFORM internal.assert_sheet_definition_object(item,ARRAY['columnId','operator'],ARRAY['columnId','operator','value'],'presentation.filters');
      column_id:=internal.sheet_definition_uuid(item->>'columnId','presentation filter column')::text;
      IF (p_column_ids IS NOT NULL AND column_id<>ALL(p_column_ids)) OR item->>'operator' NOT IN ('equals','not-equals','is-empty','is-not-empty')
         OR ((item->>'operator' IN ('is-empty','is-not-empty')) <> NOT (item ? 'value'))
         OR (item ? 'value' AND jsonb_typeof(item->'value') NOT IN ('string','number','boolean','null')) THEN RAISE EXCEPTION 'invalid presentation filter' USING ERRCODE=p_code; END IF;
    END LOOP;
  END IF;
  IF p_presentation ? 'sorts' THEN
    IF jsonb_typeof(p_presentation->'sorts')<>'array' OR jsonb_array_length(p_presentation->'sorts')>8 THEN RAISE EXCEPTION 'invalid bounded presentation sorts' USING ERRCODE=p_code; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_presentation->'sorts') LOOP
      PERFORM internal.assert_sheet_definition_object(item,ARRAY['columnId','direction'],ARRAY['columnId','direction'],'presentation.sorts');
      column_id:=internal.sheet_definition_uuid(item->>'columnId','presentation sort column')::text;
      IF (p_column_ids IS NOT NULL AND column_id<>ALL(p_column_ids)) OR item->>'direction' NOT IN ('asc','desc') THEN RAISE EXCEPTION 'invalid presentation sort' USING ERRCODE=p_code; END IF;
    END LOOP;
  END IF;
END $$;

ALTER FUNCTION internal.validate_sheet_definition_configuration(jsonb)
  RENAME TO validate_sheet_definition_configuration_core0311;
CREATE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE ids text[];
BEGIN
  PERFORM internal.validate_sheet_definition_configuration_core0311(jsonb_set(p_config,'{presentation}',(p_config->'presentation')-'filters'-'sorts'));
  SELECT array_agg(value->>'id') INTO ids FROM jsonb_array_elements(p_config->'columns') value;
  PERFORM internal.validate_sheet_presentation_queries(p_config->'presentation',ids,'SB071');
END $$;

ALTER FUNCTION internal.validate_sheet_instance_state(jsonb)
  RENAME TO validate_sheet_instance_state_core0311;
CREATE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM internal.validate_sheet_instance_state_core0311(jsonb_set(p_state,'{presentation}',(p_state->'presentation')-'filters'-'sorts'));
  PERFORM internal.validate_sheet_presentation_queries(p_state->'presentation',NULL,'SB073');
EXCEPTION WHEN SQLSTATE 'SB071' THEN RAISE EXCEPTION 'invalid Sheet Instance state: %',SQLERRM USING ERRCODE='SB073';
END $$;

CREATE FUNCTION internal.validate_sheet_instance_presentation(p_source_definition_version_id uuid,p_state jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE ids text[];
BEGIN
  SELECT array_agg(id) INTO ids FROM (
    SELECT value->>'fieldId' id FROM jsonb_array_elements(p_state->'localFields') value
    UNION ALL SELECT value->>'id' FROM jsonb_array_elements(coalesce((SELECT configuration->'columns' FROM api.sheet_definition_versions WHERE id=p_source_definition_version_id),'[]'::jsonb)) value
    UNION ALL SELECT value->>'id' FROM jsonb_array_elements(coalesce(p_state->'instanceCalculations','[]'::jsonb)) value
  ) columns;
  PERFORM internal.validate_sheet_presentation_queries(p_state->'presentation',coalesce(ids,'{}'),'SB073');
END $$;

ALTER FUNCTION api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb)
  RENAME TO create_sheet_instance_from_definition_core0311;
CREATE FUNCTION api.create_sheet_instance_from_definition(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb,p_parameter_inputs jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE defaults jsonb; result api.sheet_instances;
BEGIN
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

ALTER FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb)
  RENAME TO create_sheet_instance_core0311;
CREATE FUNCTION api.create_sheet_instance(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances;
BEGIN
  PERFORM internal.validate_sheet_instance_presentation(NULL,p_state);
  result:=api.create_sheet_instance_core0311(p_workspace_id,p_name,p_description,p_source_definition_version_id,p_project_id,p_notebook_record_id,jsonb_set(p_state,'{presentation}',(p_state->'presentation')-'filters'-'sorts'));
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=jsonb_set(result.state,'{presentation}',p_state->'presentation') WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END $$;

ALTER FUNCTION api.update_sheet_instance(uuid,bigint,jsonb)
  RENAME TO update_sheet_instance_core0311;
CREATE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
 IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' OR result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
 IF p_state->'localFields' IS DISTINCT FROM result.state->'localFields' OR p_state->'localValues' IS DISTINCT FROM result.state->'localValues' THEN RAISE EXCEPTION 'local fields and values require the controlled local mutation RPC' USING ERRCODE='SB073'; END IF;
 IF coalesce(p_state->'instanceCalculations','[]'::jsonb) IS DISTINCT FROM coalesce(result.state->'instanceCalculations','[]'::jsonb) THEN RAISE EXCEPTION 'calculation definitions require the controlled calculation mutation RPC' USING ERRCODE='SB083'; END IF;
 PERFORM internal.validate_sheet_instance_presentation(result.source_definition_version_id,p_state);
 p_state:=jsonb_set(jsonb_set(jsonb_set(p_state,'{provenance}',result.state->'provenance',true),'{localFields}',result.state->'localFields',true),'{localValues}',result.state->'localValues',true);
 IF result.state ? 'instanceCalculations' THEN p_state:=jsonb_set(p_state,'{instanceCalculations}',result.state->'instanceCalculations',true); ELSE p_state:=p_state-'instanceCalculations'; END IF;
 IF result.source_definition_version_id IS NOT NULL THEN p_state:=(p_state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',result.state->'bindings','parameterValues',coalesce(result.state->'parameterValues','[]'::jsonb),'resolutionProvenance',result.state->'resolutionProvenance','resolvedRowIdentity',result.state->'resolvedRowIdentity'); ELSE SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb)); p_state:=(p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',stripped_bindings); END IF;
 IF NOT result.state ? 'resolvedRowIdentity' THEN p_state:=p_state-'resolvedRowIdentity'; END IF;
 PERFORM internal.validate_sheet_instance_state(p_state);
 PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result;
 RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_definition_configuration_core0311(jsonb),internal.validate_sheet_definition_configuration(jsonb),internal.validate_sheet_presentation_queries(jsonb,text[],text),internal.validate_sheet_instance_state_core0311(jsonb),internal.validate_sheet_instance_state(jsonb),internal.validate_sheet_instance_presentation(uuid,jsonb),api.create_sheet_instance_from_definition_core0311(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb),api.create_sheet_instance_core0311(uuid,text,text,uuid,uuid,uuid,jsonb),api.update_sheet_instance_core0311(uuid,bigint,jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb),api.update_sheet_instance(uuid,bigint,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb),api.update_sheet_instance(uuid,bigint,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
