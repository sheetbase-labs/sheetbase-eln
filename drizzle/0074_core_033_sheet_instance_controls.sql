-- CORE-03.3 controlled Sheet Instance identity and working-state persistence.
-- Existing scientific Sheet/Notebook/Template storage remains untouched.
ALTER TABLE api.sheet_instances
  ADD CONSTRAINT chk_sheet_instances_name CHECK(length(btrim(name)) BETWEEN 1 AND 200),
  ADD CONSTRAINT chk_sheet_instances_description CHECK(description IS NULL OR length(description)<=2000);

CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item jsonb; nested jsonb; id text; binding_ids text[]:='{}'; parameter_ids text[]:='{}'; field_ids text[]:='{}'; object_key text; object_value jsonb;
BEGIN
  IF octet_length(p_state::text)>1048576 THEN RAISE EXCEPTION 'Sheet Instance state exceeds 1 MiB' USING ERRCODE='SB073'; END IF;
  PERFORM internal.assert_sheet_definition_object(p_state,
    ARRAY['bindings','localFields','localValues','calculationOverrides','presentation','provenance'],
    ARRAY['bindings','localFields','localValues','calculationOverrides','presentation','provenance'],'instance state');
  IF jsonb_typeof(p_state->'bindings')<>'array' OR jsonb_array_length(p_state->'bindings')>64
     OR jsonb_typeof(p_state->'localFields')<>'array' OR jsonb_array_length(p_state->'localFields')>256
     OR jsonb_typeof(p_state->'localValues')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_state->'localValues'))>10000
     OR jsonb_typeof(p_state->'calculationOverrides')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_state->'calculationOverrides'))>128
  THEN RAISE EXCEPTION 'invalid or oversized Sheet Instance state section' USING ERRCODE='SB073'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_state->'bindings') LOOP
    IF item->>'kind'='dataset' THEN
      PERFORM internal.assert_sheet_definition_object(item,ARRAY['bindingId','parameterId','kind','datasetId','policy'],ARRAY['bindingId','parameterId','kind','datasetId','policy'],'bindings');
      PERFORM internal.sheet_definition_uuid(item->>'datasetId','bindings.datasetId');
      IF item->'policy'->>'mode'='live' THEN PERFORM internal.assert_sheet_definition_object(item->'policy',ARRAY['mode'],ARRAY['mode'],'bindings.policy');
      ELSIF item->'policy'->>'mode'='version' THEN PERFORM internal.assert_sheet_definition_object(item->'policy',ARRAY['mode','datasetVersionId'],ARRAY['mode','datasetVersionId'],'bindings.policy'); PERFORM internal.sheet_definition_uuid(item->'policy'->>'datasetVersionId','bindings.policy.datasetVersionId');
      ELSE RAISE EXCEPTION 'invalid Dataset binding policy' USING ERRCODE='SB073'; END IF;
    ELSIF item->>'kind'='record' THEN
      PERFORM internal.assert_sheet_definition_object(item,ARRAY['bindingId','parameterId','kind','recordId','policy'],ARRAY['bindingId','parameterId','kind','recordId','policy'],'bindings');
      PERFORM internal.sheet_definition_uuid(item->>'recordId','bindings.recordId');
      IF item->'policy'<>'"live"'::jsonb THEN RAISE EXCEPTION 'invalid Record binding policy' USING ERRCODE='SB073'; END IF;
    ELSE RAISE EXCEPTION 'invalid Sheet Instance binding kind' USING ERRCODE='SB073'; END IF;
    id:=internal.sheet_definition_uuid(item->>'bindingId','bindings.bindingId')::text;
    IF id=ANY(binding_ids) THEN RAISE EXCEPTION 'duplicate Sheet Instance binding ID' USING ERRCODE='SB073'; END IF;
    binding_ids:=array_append(binding_ids,id);
    id:=internal.sheet_definition_uuid(item->>'parameterId','bindings.parameterId')::text;
    IF id=ANY(parameter_ids) THEN RAISE EXCEPTION 'duplicate Sheet Instance parameter ID' USING ERRCODE='SB073'; END IF;
    parameter_ids:=array_append(parameter_ids,id);
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_state->'localFields') LOOP
    PERFORM internal.validate_sheet_field_definition(item,'localFields');
    id:=item->>'fieldId'; IF id=ANY(field_ids) THEN RAISE EXCEPTION 'duplicate local field ID' USING ERRCODE='SB073'; END IF;
    field_ids:=array_append(field_ids,id);
  END LOOP;
  FOR object_key,object_value IN SELECT * FROM jsonb_each(p_state->'localValues') LOOP
    PERFORM internal.sheet_definition_uuid(object_key,'localValues row ID');
    IF jsonb_typeof(object_value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(object_value))>256 THEN RAISE EXCEPTION 'invalid local row value container' USING ERRCODE='SB073'; END IF;
    FOR id,nested IN SELECT * FROM jsonb_each(object_value) LOOP
      PERFORM internal.sheet_definition_uuid(id,'localValues field ID');
      IF id<>ALL(field_ids) OR jsonb_typeof(nested) NOT IN ('string','number','boolean','null') OR (jsonb_typeof(nested)='string' AND length(nested#>>'{}')>100000) THEN RAISE EXCEPTION 'invalid or unresolved local value' USING ERRCODE='SB073'; END IF;
    END LOOP;
  END LOOP;
  FOR object_key,object_value IN SELECT * FROM jsonb_each(p_state->'calculationOverrides') LOOP
    PERFORM internal.sheet_definition_uuid(object_key,'calculationOverrides ID');
    PERFORM internal.assert_sheet_definition_object(object_value,ARRAY['enabled','expression'],ARRAY['enabled','expression'],'calculationOverrides');
    PERFORM internal.assert_sheet_definition_object(object_value->'expression',ARRAY['language','source'],ARRAY['language','source'],'calculationOverrides.expression');
    IF jsonb_typeof(object_value->'enabled')<>'boolean' OR object_value->'expression'->>'language'<>'sheetbase-formula-v1' OR length(btrim(object_value->'expression'->>'source')) NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'invalid calculation override' USING ERRCODE='SB073'; END IF;
  END LOOP;
  PERFORM internal.assert_sheet_definition_object(p_state->'presentation',ARRAY['columnOrder','hiddenColumnIds','columnWidths','frozenColumnCount','density'],ARRAY['columnOrder','hiddenColumnIds','columnWidths','frozenColumnCount','density'],'presentation');
  IF jsonb_typeof(p_state->'presentation'->'columnOrder')<>'array' OR jsonb_array_length(p_state->'presentation'->'columnOrder')>512 OR jsonb_typeof(p_state->'presentation'->'hiddenColumnIds')<>'array' OR jsonb_array_length(p_state->'presentation'->'hiddenColumnIds')>512 OR jsonb_typeof(p_state->'presentation'->'columnWidths')<>'object' OR jsonb_typeof(p_state->'presentation'->'frozenColumnCount')<>'number' OR (p_state->'presentation'->>'frozenColumnCount')::numeric<>trunc((p_state->'presentation'->>'frozenColumnCount')::numeric) OR (p_state->'presentation'->>'frozenColumnCount')::numeric NOT BETWEEN 0 AND 512 OR p_state->'presentation'->>'density' NOT IN ('compact','standard','comfortable') THEN RAISE EXCEPTION 'invalid presentation state' USING ERRCODE='SB073'; END IF;
  FOR nested IN SELECT value FROM jsonb_array_elements((p_state->'presentation'->'columnOrder')||(p_state->'presentation'->'hiddenColumnIds')) LOOP PERFORM internal.sheet_definition_uuid(nested#>>'{}','presentation column ID'); END LOOP;
  FOR object_key,object_value IN SELECT * FROM jsonb_each(p_state->'presentation'->'columnWidths') LOOP PERFORM internal.sheet_definition_uuid(object_key,'columnWidths ID'); IF jsonb_typeof(object_value)<>'number' OR (object_value#>>'{}')::numeric<>trunc((object_value#>>'{}')::numeric) OR (object_value#>>'{}')::numeric NOT BETWEEN 40 AND 2000 THEN RAISE EXCEPTION 'invalid column width' USING ERRCODE='SB073'; END IF; END LOOP;
  IF p_state->'provenance'->>'createdFrom'='duplicate' THEN PERFORM internal.assert_sheet_definition_object(p_state->'provenance',ARRAY['createdFrom','duplicatedFromInstanceId'],ARRAY['createdFrom','duplicatedFromInstanceId'],'provenance'); PERFORM internal.sheet_definition_uuid(p_state->'provenance'->>'duplicatedFromInstanceId','provenance.duplicatedFromInstanceId');
  ELSIF p_state->'provenance'->>'createdFrom' IN ('ad_hoc','definition_version') THEN PERFORM internal.assert_sheet_definition_object(p_state->'provenance',ARRAY['createdFrom'],ARRAY['createdFrom'],'provenance');
  ELSE RAISE EXCEPTION 'invalid Sheet Instance provenance' USING ERRCODE='SB073'; END IF;
EXCEPTION WHEN SQLSTATE 'SB071' THEN RAISE EXCEPTION 'invalid Sheet Instance state: %',SQLERRM USING ERRCODE='SB073';
END $$;

CREATE OR REPLACE FUNCTION internal.guard_sheet_instance() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE item jsonb; config jsonb;
BEGIN
  IF current_setting('sheetbase.sheet_instance_write',true) IS DISTINCT FROM 'rpc-v1' THEN RAISE EXCEPTION 'Sheet Instances require controlled RPCs' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sheet Instances cannot be deleted' USING ERRCODE='42501'; END IF;
  PERFORM internal.validate_sheet_instance_state(NEW.state);
  IF TG_OP='UPDATE' AND (NEW.id,NEW.workspace_id,NEW.project_id,NEW.notebook_record_id,NEW.source_definition_version_id,NEW.duplicated_from_instance_id,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.project_id,OLD.notebook_record_id,OLD.source_definition_version_id,OLD.duplicated_from_instance_id,OLD.created_at,OLD.created_by_user_id) THEN RAISE EXCEPTION 'Sheet Instance identity and provenance are immutable' USING ERRCODE='SB073'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=NEW.project_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'project belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.notebook_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.records WHERE id=NEW.notebook_record_id AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Notebook Record belongs to another workspace' USING ERRCODE='SB073'; END IF;
  IF NEW.source_definition_version_id IS NOT NULL THEN SELECT v.configuration INTO config FROM api.sheet_definition_versions v JOIN api.sheet_definitions d ON d.id=v.definition_id WHERE v.id=NEW.source_definition_version_id AND d.workspace_id=NEW.workspace_id AND v.lifecycle='published'; IF config IS NULL THEN RAISE EXCEPTION 'source version must be published in this workspace' USING ERRCODE='SB073'; END IF; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.state->'bindings') LOOP
    IF item->>'kind'='dataset' THEN
      IF NOT EXISTS(SELECT 1 FROM api.datasets WHERE id=(item->>'datasetId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Dataset belongs to another workspace or does not exist' USING ERRCODE='SB073'; END IF;
      IF item->'policy'->>'mode'='version' AND NOT EXISTS(SELECT 1 FROM api.dataset_versions WHERE id=(item->'policy'->>'datasetVersionId')::uuid AND dataset_id=(item->>'datasetId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Dataset Version does not belong to named Dataset' USING ERRCODE='SB073'; END IF;
    ELSE IF NOT EXISTS(SELECT 1 FROM api.records WHERE id=(item->>'recordId')::uuid AND workspace_id=NEW.workspace_id) THEN RAISE EXCEPTION 'Record belongs to another workspace or does not exist' USING ERRCODE='SB073'; END IF; END IF;
    IF config IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(config->'bindings') b WHERE b->>'id'=item->>'bindingId' AND b->>'parameterId'=item->>'parameterId') THEN RAISE EXCEPTION 'resolved binding is absent from pinned Definition Version' USING ERRCODE='SB073'; END IF;
  END LOOP;
  IF NEW.source_definition_version_id IS NULL AND NEW.state->'provenance'->>'createdFrom'<>'ad_hoc' AND NEW.state->'provenance'->>'createdFrom'<>'duplicate' THEN RAISE EXCEPTION 'ad hoc source/provenance mismatch' USING ERRCODE='SB073'; END IF;
  IF NEW.source_definition_version_id IS NOT NULL AND NEW.state->'provenance'->>'createdFrom'='ad_hoc' THEN RAISE EXCEPTION 'Definition source/provenance mismatch' USING ERRCODE='SB073'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sheet_instance BEFORE INSERT OR UPDATE OR DELETE ON api.sheet_instances FOR EACH ROW EXECUTE FUNCTION internal.guard_sheet_instance();

ALTER TABLE api.sheet_instances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.sheet_instances TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON api.sheet_instances FROM PUBLIC,authenticated,api_client;
GRANT INSERT,UPDATE,DELETE ON api.sheet_instances TO migrator;
CREATE POLICY sheet_instances_read ON api.sheet_instances FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));

CREATE OR REPLACE FUNCTION api.create_sheet_instance(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); provenance jsonb;
BEGIN
 IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
 provenance:=jsonb_build_object('createdFrom',CASE WHEN p_source_definition_version_id IS NULL THEN 'ad_hoc' ELSE 'definition_version' END); p_state:=jsonb_set(p_state,'{provenance}',provenance,true);
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 INSERT INTO api.sheet_instances(workspace_id,name,description,source_definition_version_id,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_source_definition_version_id,p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF; IF result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 p_state:=jsonb_set(p_state,'{provenance}',result.state->'provenance',true); PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;
CREATE OR REPLACE FUNCTION api.archive_sheet_instance(p_instance_id uuid,p_expected_revision bigint)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance_row api.sheet_instances; actor text:=api.current_user_id();
BEGIN SELECT * INTO instance_row FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF instance_row.id IS NULL OR NOT api.is_workspace_member(instance_row.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF; IF instance_row.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is already archived' USING ERRCODE='SB073'; END IF; IF instance_row.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF; PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true); UPDATE api.sheet_instances SET lifecycle='archived',revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance_row.id RETURNING * INTO instance_row; RETURN instance_row; END $$;
CREATE OR REPLACE FUNCTION api.duplicate_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_name text)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE source api.sheet_instances; result api.sheet_instances; actor text:=api.current_user_id(); copied_state jsonb;
BEGIN SELECT * INTO source FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF source.id IS NULL OR NOT api.is_workspace_member(source.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF; IF source.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF; IF source.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF; IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid Sheet Instance name' USING ERRCODE='SB073'; END IF; copied_state:=jsonb_set(source.state,'{provenance}',jsonb_build_object('createdFrom','duplicate','duplicatedFromInstanceId',source.id),true); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true); INSERT INTO api.sheet_instances(workspace_id,project_id,notebook_record_id,source_definition_version_id,name,description,state,duplicated_from_instance_id,created_by_user_id,updated_by_user_id) VALUES(source.workspace_id,source.project_id,source.notebook_record_id,source.source_definition_version_id,btrim(p_name),source.description,copied_state,source.id,actor,actor) RETURNING * INTO result; RETURN result; END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_instance_state(jsonb),internal.guard_sheet_instance() FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.update_sheet_instance(uuid,bigint,jsonb),api.archive_sheet_instance(uuid,bigint),api.duplicate_sheet_instance(uuid,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance(uuid,text,text,uuid,uuid,uuid,jsonb),api.update_sheet_instance(uuid,bigint,jsonb),api.archive_sheet_instance(uuid,bigint),api.duplicate_sheet_instance(uuid,bigint,text) TO authenticated;
