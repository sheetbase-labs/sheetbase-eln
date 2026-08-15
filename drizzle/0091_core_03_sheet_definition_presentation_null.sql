-- CORE-03 corrective: presentation query stripping must not use jsonb `-`
-- on a non-object. Null/malformed presentation must fail as SB071/SB073,
-- not PostgreSQL 22023 "cannot delete from scalar".
CREATE FUNCTION internal.sheet_document_without_presentation_queries(p_document jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_document -> 'presentation') = 'object'
      THEN jsonb_set(
        p_document,
        '{presentation}',
        (p_document -> 'presentation') - 'filters' - 'sorts'
      )
    ELSE p_document
  END
$$;
REVOKE EXECUTE ON FUNCTION internal.sheet_document_without_presentation_queries(jsonb)
  FROM PUBLIC, authenticated, api_client;

CREATE OR REPLACE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE ids text[];
BEGIN
  PERFORM internal.validate_sheet_definition_configuration_core0311(
    internal.sheet_document_without_presentation_queries(p_config)
  );
  IF jsonb_typeof(p_config->'columns')='array'
     AND jsonb_typeof(p_config->'presentation')='object' THEN
    SELECT array_agg(value->>'id') INTO ids FROM jsonb_array_elements(p_config->'columns') value;
    PERFORM internal.validate_sheet_presentation_queries(p_config->'presentation',ids,'SB071');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  PERFORM internal.validate_sheet_instance_state_core0311(
    internal.sheet_document_without_presentation_queries(p_state)
  );
  IF jsonb_typeof(p_state->'presentation')='object' THEN
    PERFORM internal.validate_sheet_presentation_queries(p_state->'presentation',NULL,'SB073');
  END IF;
EXCEPTION WHEN SQLSTATE 'SB071' THEN RAISE EXCEPTION 'invalid Sheet Instance state: %',SQLERRM USING ERRCODE='SB073';
END $$;

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
  result:=api.create_sheet_instance_from_definition_core0311(
    p_workspace_id,p_name,p_description,p_source_definition_version_id,p_project_id,p_notebook_record_id,
    internal.sheet_document_without_presentation_queries(p_state),
    p_parameter_inputs
  );
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=jsonb_set(result.state,'{presentation}',p_state->'presentation') WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_instance(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances;
BEGIN
  PERFORM internal.validate_sheet_instance_presentation(NULL,p_state);
  result:=api.create_sheet_instance_core0311(
    p_workspace_id,p_name,p_description,p_source_definition_version_id,p_project_id,p_notebook_record_id,
    internal.sheet_document_without_presentation_queries(p_state)
  );
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=jsonb_set(result.state,'{presentation}',p_state->'presentation') WHERE id=result.id RETURNING * INTO result;
  RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_definition_configuration(jsonb),internal.validate_sheet_instance_state(jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
