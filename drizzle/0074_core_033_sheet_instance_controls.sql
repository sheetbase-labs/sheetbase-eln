-- CORE-03.3 controlled Sheet Instance lifecycle.  Configuration resolution is
-- intentionally deferred; this migration validates only durable identity,
-- bounded working state and workspace-owned concrete references.
CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(p_state) <> 'object' OR p_state - ARRAY['bindings','localFields','localValues','calculationOverrides','presentation','provenance'] <> '{}'::jsonb
     OR NOT p_state ?& ARRAY['bindings','localFields','localValues','calculationOverrides','presentation','provenance']
     OR octet_length(p_state::text)>1048576
     OR jsonb_typeof(p_state->'bindings')<>'array' OR jsonb_array_length(p_state->'bindings')>64
     OR jsonb_typeof(p_state->'localFields')<>'array' OR jsonb_array_length(p_state->'localFields')>256
     OR jsonb_typeof(p_state->'localValues')<>'object' OR jsonb_object_length(p_state->'localValues')>10000
     OR jsonb_typeof(p_state->'calculationOverrides')<>'object' OR jsonb_object_length(p_state->'calculationOverrides')>128
     OR jsonb_typeof(p_state->'presentation')<>'object' OR jsonb_typeof(p_state->'provenance')<>'object'
  THEN RAISE EXCEPTION 'invalid Sheet Instance state' USING ERRCODE='SB073'; END IF;
  IF p_state->'provenance'->>'createdFrom' NOT IN ('ad_hoc','definition_version','duplicate') THEN RAISE EXCEPTION 'invalid Sheet Instance provenance' USING ERRCODE='SB073'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_state->'bindings') LOOP
    IF jsonb_typeof(item)<>'object' OR item->>'kind' NOT IN ('dataset','record')
       OR item->>'bindingId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR item->>'parameterId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR (item->>'kind'='dataset' AND (item->>'datasetId' IS NULL OR jsonb_typeof(item->'policy')<>'object' OR item->'policy'->>'mode' NOT IN ('live','version')))
       OR (item->>'kind'='record' AND (item->>'recordId' IS NULL OR item->>'policy'<>'live'))
    THEN RAISE EXCEPTION 'invalid Sheet Instance binding' USING ERRCODE='SB073'; END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION internal.guard_sheet_instance() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF current_user NOT IN ('migrator','postgres') AND current_setting('sheetbase.sheet_instance_write',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Sheet Instances require controlled RPCs' USING ERRCODE='42501'; END IF;
  PERFORM internal.validate_sheet_instance_state(NEW.state);
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'project belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.notebook_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.records WHERE id=NEW.notebook_record_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Notebook Record belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.source_definition_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.sheet_definition_versions v JOIN api.sheet_definitions d ON d.id=v.definition_id WHERE v.id=NEW.source_definition_version_id AND d.workspace_id=NEW.workspace_id AND v.lifecycle='published') THEN RAISE EXCEPTION 'source version must be a published same-workspace version' USING ERRCODE='SB073'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sheet_instance BEFORE INSERT OR UPDATE ON api.sheet_instances FOR EACH ROW EXECUTE FUNCTION internal.guard_sheet_instance();

ALTER TABLE api.sheet_instances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.sheet_instances TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON api.sheet_instances FROM authenticated;
CREATE POLICY sheet_instances_read ON api.sheet_instances FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION api.create_sheet_instance(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id();
BEGIN
 IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','on',true);
 INSERT INTO api.sheet_instances(workspace_id,name,description,source_definition_version_id,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_source_definition_version_id,p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
 IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF;
 IF result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','on',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION api.archive_sheet_instance(p_instance_id uuid,p_expected_revision bigint)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
 IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 PERFORM set_config('sheetbase.sheet_instance_write','on',true); UPDATE api.sheet_instances SET lifecycle='archived',revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION api.duplicate_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_name text)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source api.sheet_instances; result api.sheet_instances; actor text:=api.current_user_id(); state jsonb;
BEGIN
 SELECT * INTO source FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
 IF source.id IS NULL OR NOT api.is_workspace_member(source.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF source.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF;
 IF source.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 state:=jsonb_set(source.state,'{provenance}',jsonb_build_object('createdFrom','duplicate','duplicatedFromInstanceId',source.id)); PERFORM set_config('sheetbase.sheet_instance_write','on',true);
 INSERT INTO api.sheet_instances(workspace_id,project_id,notebook_record_id,source_definition_version_id,name,description,state,duplicated_from_instance_id,created_by_user_id,updated_by_user_id) VALUES(source.workspace_id,source.project_id,source.notebook_record_id,source.source_definition_version_id,btrim(p_name),source.description,state,source.id,actor,actor) RETURNING * INTO result; RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION internal.validate_sheet_instance_state(jsonb),internal.guard_sheet_instance() FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.update_sheet_instance(uuid,bigint,jsonb),api.archive_sheet_instance(uuid,bigint),api.duplicate_sheet_instance(uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.update_sheet_instance(uuid,bigint,jsonb),api.archive_sheet_instance(uuid,bigint),api.duplicate_sheet_instance(uuid,bigint,text) TO authenticated;
