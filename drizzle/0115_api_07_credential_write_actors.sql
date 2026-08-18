-- API-07: service-credential write actors for mapped Core data-plane RPCs.
-- api_client JWTs carry credential_id, not sub. Do not impersonate a user
-- and do not overload current_user_id() (user FKs). Session behaviour with
-- authenticated + sub is unchanged. submit_record_revision remains a human
-- evidence act (session_id + sub) and is out of this cut-over.

CREATE OR REPLACE FUNCTION api.current_credential_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') = 'api_client'
      THEN nullif(btrim(api.claim_probe()->>'credential_id'), '')::uuid
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION api.current_credential_id() IS
  'JWT credential_id when the role is api_client; otherwise null.';

CREATE OR REPLACE FUNCTION api.has_write_actor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (
    (api.current_user_id() IS NOT NULL)::int
    + (api.current_credential_id() IS NOT NULL)::int
  ) = 1
$$;

COMMENT ON FUNCTION api.has_write_actor() IS
  'True when the request has exactly one write actor: a session user or an api_client credential.';

REVOKE ALL ON FUNCTION api.current_credential_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION api.has_write_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.current_credential_id() TO authenticated, api_client;
GRANT EXECUTE ON FUNCTION api.has_write_actor() TO authenticated, api_client;
--> statement-breakpoint

ALTER TABLE api.dataset_bulk_commits
  ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE api.dataset_bulk_commits
  ADD COLUMN actor_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE RESTRICT;
ALTER TABLE api.dataset_bulk_commits
  DROP CONSTRAINT uq_dataset_bulk_commits_actor_idempotency;
ALTER TABLE api.dataset_bulk_commits
  ADD CONSTRAINT chk_dataset_bulk_commits_actor_xor CHECK (
    ((actor_user_id IS NOT NULL)::int + (actor_credential_id IS NOT NULL)::int) = 1
  );
CREATE UNIQUE INDEX uq_dataset_bulk_commits_user_idempotency
  ON api.dataset_bulk_commits (workspace_id, actor_user_id, idempotency_key)
  WHERE actor_user_id IS NOT NULL;
CREATE UNIQUE INDEX uq_dataset_bulk_commits_credential_idempotency
  ON api.dataset_bulk_commits (workspace_id, actor_credential_id, idempotency_key)
  WHERE actor_credential_id IS NOT NULL;
--> statement-breakpoint

ALTER TABLE api.sheet_instance_local_mutations
  ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE api.sheet_instance_local_mutations
  ADD COLUMN actor_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE RESTRICT;
ALTER TABLE api.sheet_instance_local_mutations
  ADD CONSTRAINT chk_sheet_instance_local_mutations_actor_xor CHECK (
    ((actor_user_id IS NOT NULL)::int + (actor_credential_id IS NOT NULL)::int) = 1
  );
--> statement-breakpoint

ALTER TABLE api.datasets
  ADD COLUMN created_by_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL;
ALTER TABLE api.datasets
  ADD CONSTRAINT chk_datasets_created_by_actor CHECK (
    NOT (created_by_user_id IS NOT NULL AND created_by_credential_id IS NOT NULL)
  );
ALTER TABLE api.dataset_versions
  ADD COLUMN created_by_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL;
ALTER TABLE api.dataset_versions
  ADD CONSTRAINT chk_dataset_versions_created_by_actor CHECK (
    NOT (created_by_user_id IS NOT NULL AND created_by_credential_id IS NOT NULL)
  );
--> statement-breakpoint

ALTER TABLE api.sheet_instances
  ADD COLUMN created_by_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL;
ALTER TABLE api.sheet_instances
  ADD COLUMN updated_by_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL;
ALTER TABLE api.sheet_instances
  ADD CONSTRAINT chk_sheet_instances_created_by_actor CHECK (
    NOT (created_by_user_id IS NOT NULL AND created_by_credential_id IS NOT NULL)
  );
ALTER TABLE api.sheet_instances
  ADD CONSTRAINT chk_sheet_instances_updated_by_actor CHECK (
    NOT (updated_by_user_id IS NOT NULL AND updated_by_credential_id IS NOT NULL)
  );
--> statement-breakpoint

ALTER TABLE api.records
  ADD COLUMN updated_by_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL;
ALTER TABLE api.records
  ADD CONSTRAINT chk_records_updated_by_actor CHECK (
    NOT (updated_by_user_id IS NOT NULL AND updated_by_credential_id IS NOT NULL)
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.guard_sheet_instance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE item jsonb; config jsonb;
BEGIN
  IF current_setting('sheetbase.sheet_instance_write',true) IS DISTINCT FROM 'rpc-v1' THEN RAISE EXCEPTION 'Sheet Instances require controlled RPCs' USING ERRCODE='42501'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sheet Instances cannot be deleted' USING ERRCODE='42501'; END IF;
  PERFORM internal.validate_sheet_instance_state(NEW.state);
  IF TG_OP='UPDATE' AND (NEW.id,NEW.workspace_id,NEW.project_id,NEW.notebook_record_id,NEW.duplicated_from_instance_id,NEW.created_at,NEW.created_by_user_id,NEW.created_by_credential_id) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.project_id,OLD.notebook_record_id,OLD.duplicated_from_instance_id,OLD.created_at,OLD.created_by_user_id,OLD.created_by_credential_id) THEN RAISE EXCEPTION 'Sheet Instance identity and provenance are immutable' USING ERRCODE='SB073'; END IF;
  IF TG_OP='UPDATE' AND NEW.source_definition_version_id IS DISTINCT FROM OLD.source_definition_version_id AND current_setting('sheetbase.sheet_instance_upgrade',true) IS DISTINCT FROM 'rpc-v1' THEN RAISE EXCEPTION 'Sheet Instance source requires controlled upgrade' USING ERRCODE='SB073'; END IF;
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor_user text; actor_credential uuid; item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_field_id uuid; field api.dataset_schema_version_fields; result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer; effective jsonb;
BEGIN
 actor_user:=api.current_user_id(); actor_credential:=api.current_credential_id();
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_writer(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE='22023'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('datasetId',p_dataset_id,'expectedDatasetRevision',p_expected_dataset_revision,'rows',p_rows)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM api.dataset_bulk_commits
  WHERE workspace_id=dataset.workspace_id AND idempotency_key=p_idempotency_key
    AND (
      (actor_user IS NOT NULL AND actor_user_id = actor_user)
      OR (actor_credential IS NOT NULL AND actor_credential_id = actor_credential)
    );
 IF existing.id IS NOT NULL THEN IF existing.dataset_id<>p_dataset_id OR existing.request_digest<>digest THEN RAISE EXCEPTION 'idempotency key was used for a different Dataset batch' USING ERRCODE='23505'; END IF; RETURN existing.result||jsonb_build_object('idempotent',true); END IF;
 validation:=api.validate_dataset_row_batch(p_dataset_id,p_expected_dataset_revision,p_rows); IF (validation->>'ok')::boolean IS NOT TRUE THEN RETURN validation||jsonb_build_object('idempotent',false); END IF;
 PERFORM 1 FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND r.id IN (SELECT (value->>'rowId')::uuid FROM jsonb_array_elements(p_rows)) ORDER BY r.id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  v_row_id:=(item->>'rowId')::uuid;
  IF item->>'operation'='create' THEN INSERT INTO api.dataset_rows(id,dataset_id,workspace_id) VALUES(v_row_id,dataset.id,dataset.workspace_id); result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',1,'operation','create')); ELSE UPDATE api.dataset_rows SET revision=revision+1,updated_at=now() WHERE id=v_row_id; result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT revision FROM api.dataset_rows WHERE id=v_row_id),'operation','update')); END IF;
  FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' LOOP
   effective:=item->'values'->field.field_id::text;
   IF effective IS NULL AND item->>'operation'='update' THEN CONTINUE; END IF;
   IF effective IS NULL AND item->>'operation'='create' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN effective:=field.default_value; END IF;
   IF effective='null'::jsonb AND NOT field.nullable THEN effective:=field.default_value; END IF;
   IF effective IS NULL THEN CONTINUE; END IF;
   DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=field.field_id;
   IF effective<>'null'::jsonb THEN
    IF field.cardinality='many' THEN value_ordinal:=0; FOR value_item IN SELECT value FROM jsonb_array_elements(effective) LOOP INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,value_ordinal,CASE WHEN field.logical_type='text' THEN value_item#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (value_item#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (value_item#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (value_item#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (value_item#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (value_item#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (value_item#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (value_item#>>'{}')::uuid END); value_ordinal:=value_ordinal+1; END LOOP;
    ELSE INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id) VALUES(v_row_id,field.field_id,0,CASE WHEN field.logical_type='text' THEN effective#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (effective#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (effective#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (effective#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (effective#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (effective#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (effective#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (effective#>>'{}')::uuid END); END IF;
   END IF;
  END LOOP;
 END LOOP;
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,actor_credential_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor_user,actor_credential,p_idempotency_key,digest,result); RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.snapshot_dataset(p_dataset_id uuid, p_expected_dataset_revision bigint, p_label text)
RETURNS api.dataset_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE dataset api.datasets; version api.dataset_versions;
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_writer(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE='SB001'; END IF;
 IF dataset.lifecycle<>'active' THEN RAISE EXCEPTION 'cannot snapshot archived Dataset' USING ERRCODE='22023'; END IF;
 INSERT INTO api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id,created_by_credential_id)
 VALUES(dataset.id,dataset.workspace_id,dataset.schema_version_id,dataset.revision,p_label,api.current_user_id(),api.current_credential_id()) RETURNING * INTO version;
 INSERT INTO api.dataset_version_rows(dataset_version_id,row_id,revision)
 SELECT version.id,id,revision FROM api.dataset_rows WHERE dataset_id=dataset.id;
 INSERT INTO api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
 SELECT version.id,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
 FROM api.dataset_row_values v JOIN api.dataset_rows r ON r.id=v.row_id WHERE r.dataset_id=dataset.id;
 RETURN version;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_sheet_instance_core0311(p_workspace_id uuid, p_name text, p_description text, p_source_definition_version_id uuid, p_project_id uuid, p_notebook_record_id uuid, p_state jsonb)
RETURNS api.sheet_instances
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE result api.sheet_instances; actor_user text:=api.current_user_id(); actor_credential uuid:=api.current_credential_id(); stripped_bindings jsonb;
BEGIN
 IF p_source_definition_version_id IS NOT NULL THEN RAISE EXCEPTION 'Definition-derived Instances require authoritative parameter resolution' USING ERRCODE='SB074'; END IF;
 IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
 IF jsonb_array_length(coalesce(p_state->'instanceCalculations','[]'::jsonb))<>0 THEN RAISE EXCEPTION 'initial calculation definitions require the controlled calculation mutation RPC' USING ERRCODE='SB083'; END IF;
 SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb));
 p_state:=jsonb_set((p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity'-'instanceCalculations')||jsonb_build_object('bindings',stripped_bindings),'{provenance}',jsonb_build_object('createdFrom','ad_hoc'),true);
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_state->'localValues') key WHERE key ~ '^sb-row-v1:') THEN RAISE EXCEPTION 'ad hoc initial local values require persisted local UUID identities' USING ERRCODE='SB073'; END IF;
 IF EXISTS(
   SELECT 1 FROM jsonb_each(p_state->'localValues') row_entry
   CROSS JOIN LATERAL jsonb_each(row_entry.value) cell
   JOIN LATERAL jsonb_array_elements(p_state->'localFields') field ON field->>'fieldId'=cell.key
   WHERE internal.sheet_local_cell_error(p_workspace_id,field,cell.value) IS NOT NULL
 ) THEN RAISE EXCEPTION 'invalid initial local value' USING ERRCODE='SB073'; END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 INSERT INTO api.sheet_instances(workspace_id,name,description,project_id,notebook_record_id,state,created_by_user_id,created_by_credential_id,updated_by_user_id,updated_by_credential_id)
 VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_project_id,p_notebook_record_id,p_state,actor_user,actor_credential,actor_user,actor_credential) RETURNING * INTO result; RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_record_custom_fields(p_record_id uuid, p_expected_metadata_version integer, p_values jsonb)
RETURNS api.records
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE result api.records;
BEGIN
 IF NOT api.has_write_actor() THEN RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE='42501'; END IF;
 SELECT * INTO result FROM api.records WHERE id=p_record_id FOR UPDATE;
 IF result.id IS NULL THEN RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE='42501'; END IF;
 IF result.archived_at IS NOT NULL OR result.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'record is not editable' USING ERRCODE='SB004'; END IF;
 IF result.locked_at IS NOT NULL THEN RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011'; END IF;
 IF result.metadata_version<>p_expected_metadata_version THEN RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE='SB001'; END IF;
 UPDATE api.records SET custom_fields=result.custom_fields||coalesce(p_values,'{}'),
   metadata_version=result.metadata_version+1,updated_at=now(),
   updated_by_user_id=api.current_user_id(),
   updated_by_credential_id=api.current_credential_id()
 WHERE id=p_record_id RETURNING * INTO result;
 RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.mutate_sheet_instance_local_state(p_instance_id uuid, p_expected_revision bigint, p_retry_token uuid, p_field_changes jsonb, p_rows jsonb, p_cells jsonb)
 RETURNS api.sheet_instances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; existing_mutation api.sheet_instance_local_mutations;
  actor_user text:=api.current_user_id(); actor_credential uuid:=api.current_credential_id(); digest text; change jsonb; row_item jsonb; cell jsonb;
  state jsonb; fields jsonb; old_field jsonb; new_field jsonb; field_id text; row_key text;
  value jsonb; effective jsonb; error_code text; seen_fields text[]:='{}'; seen_rows text[]:='{}';
  seen_cells text[]:='{}'; composition jsonb; result_row jsonb; affected jsonb;
  identity_kind text;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR NOT api.has_write_actor() OR NOT api.is_workspace_writer(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF p_retry_token IS NULL THEN RAISE EXCEPTION 'retry token is required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_revision,'fieldChanges',p_field_changes,'rows',p_rows,'cells',p_cells)::text,'UTF8')),'hex');
  SELECT * INTO existing_mutation FROM api.sheet_instance_local_mutations WHERE instance_id=p_instance_id AND retry_token=p_retry_token;
  IF existing_mutation.id IS NOT NULL THEN
    IF existing_mutation.request_digest<>digest OR existing_mutation.actor_user_id IS DISTINCT FROM actor_user OR existing_mutation.actor_credential_id IS DISTINCT FROM actor_credential THEN RAISE EXCEPTION 'retry token was used for a different local mutation' USING ERRCODE='23505'; END IF;
    RETURN jsonb_populate_record(NULL::api.sheet_instances,existing_mutation.result);
  END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF jsonb_typeof(p_field_changes)<>'array' OR jsonb_array_length(p_field_changes)>32 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>200 OR jsonb_typeof(p_cells)<>'array' OR jsonb_array_length(p_cells)>1000 OR jsonb_array_length(p_field_changes)+jsonb_array_length(p_cells)=0 THEN RAISE EXCEPTION 'local mutation requires a non-empty bounded batch' USING ERRCODE='22023'; END IF;
  state:=instance.state; fields:=state->'localFields';
  identity_kind:=instance.state->'resolvedRowIdentity'->>'kind';
  FOR change IN SELECT item FROM jsonb_array_elements(p_field_changes) item LOOP
    IF jsonb_typeof(change)<>'object' OR change->>'operation' NOT IN ('add','edit','retire') OR change-(CASE WHEN change->>'operation'='retire' THEN ARRAY['operation','fieldId'] ELSE ARRAY['operation','field'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid local field change' USING ERRCODE='22023'; END IF;
    new_field:=change->'field'; field_id:=coalesce(new_field->>'fieldId',change->>'fieldId'); PERFORM internal.sheet_definition_uuid(field_id,'local field change');
    IF field_id=ANY(seen_fields) THEN RAISE EXCEPTION 'duplicate local field change' USING ERRCODE='22023'; END IF; seen_fields:=array_append(seen_fields,field_id);
    SELECT item INTO old_field FROM jsonb_array_elements(fields) item WHERE item->>'fieldId'=field_id;
    IF change->>'operation'='add' THEN
      PERFORM internal.validate_sheet_field_definition(new_field,'local field add');
      IF new_field->'defaultValue'<>'null'::jsonb AND internal.sheet_local_cell_error(instance.workspace_id,new_field,new_field->'defaultValue') IS NOT NULL THEN RAISE EXCEPTION 'invalid local field default' USING ERRCODE='SB073'; END IF;
      IF old_field IS NOT NULL OR new_field->>'lifecycle'<>'active' OR new_field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'local field add requires a new active stored field' USING ERRCODE='SB073'; END IF;
      fields:=fields||jsonb_build_array(new_field);
    ELSIF old_field IS NULL OR old_field->>'lifecycle'<>'active' THEN RAISE EXCEPTION 'unknown or retired local field' USING ERRCODE='SB073';
    ELSIF change->>'operation'='retire' THEN
      fields:=(SELECT jsonb_agg(CASE WHEN item->>'fieldId'=field_id THEN jsonb_set(item,'{lifecycle}','"retired"') ELSE item END ORDER BY ordinality) FROM jsonb_array_elements(fields) WITH ORDINALITY AS entries(item,ordinality));
    ELSE
      PERFORM internal.validate_sheet_field_definition(new_field,'local field edit');
      IF new_field->'defaultValue'<>'null'::jsonb AND internal.sheet_local_cell_error(instance.workspace_id,new_field,new_field->'defaultValue') IS NOT NULL THEN RAISE EXCEPTION 'invalid local field default' USING ERRCODE='SB073'; END IF;
      IF new_field->>'fieldId'<>field_id OR new_field->>'lifecycle'<>'active' OR new_field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'local field edit must preserve active stored identity' USING ERRCODE='SB073'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_each(state->'localValues') r WHERE r.value ? field_id) AND
         (old_field->'key' IS DISTINCT FROM new_field->'key' OR old_field->'logicalType' IS DISTINCT FROM new_field->'logicalType' OR old_field->'cardinality' IS DISTINCT FROM new_field->'cardinality' OR old_field->'quantity' IS DISTINCT FROM new_field->'quantity' OR old_field->'category' IS DISTINCT FROM new_field->'category' OR old_field->'relationship' IS DISTINCT FROM new_field->'relationship' OR old_field->'computation' IS DISTINCT FROM new_field->'computation') THEN RAISE EXCEPTION 'populated local field semantic identity is immutable' USING ERRCODE='SB073'; END IF;
      FOR value IN SELECT r.value->field_id FROM jsonb_each(state->'localValues') r WHERE r.value ? field_id LOOP IF internal.sheet_local_cell_error(instance.workspace_id,new_field,value) IS NOT NULL THEN RAISE EXCEPTION 'field edit is incompatible with existing local values' USING ERRCODE='SB073'; END IF; END LOOP;
      fields:=(SELECT jsonb_agg(CASE WHEN item->>'fieldId'=field_id THEN new_field ELSE item END ORDER BY ordinality) FROM jsonb_array_elements(fields) WITH ORDINALITY AS entries(item,ordinality));
    END IF;
  END LOOP;
  state:=jsonb_set(state,'{localFields}',fields);
  FOR row_item IN SELECT item FROM jsonb_array_elements(p_rows) item LOOP
    IF jsonb_typeof(row_item)<>'object' OR row_item->>'kind' NOT IN ('composed','local') THEN RAISE EXCEPTION 'invalid local row address' USING ERRCODE='22023'; END IF;
    row_key:=row_item->>'rowKey'; IF row_key=ANY(seen_rows) THEN RAISE EXCEPTION 'duplicate local row address' USING ERRCODE='22023'; END IF; seen_rows:=array_append(seen_rows,row_key);
    IF row_item->>'kind'='local' THEN
      IF row_item-ARRAY['kind','rowKey']<>'{}'::jsonb
         OR (identity_kind IS NOT NULL AND identity_kind<>'local')
         OR row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN RAISE EXCEPTION 'unknown local UUID row identity' USING ERRCODE='SB073'; END IF;
    ELSE
      IF row_item-ARRAY['kind','rowKey','identityValues','compositionOffset']<>'{}'::jsonb OR instance.state->'resolvedRowIdentity'->>'kind' NOT IN ('source','composite') OR jsonb_typeof(row_item->'identityValues')<>'array' OR jsonb_array_length(row_item->'identityValues')<>jsonb_array_length(instance.state->'resolvedRowIdentity'->'columnIds') OR jsonb_typeof(row_item->'compositionOffset')<>'number' OR (row_item->>'compositionOffset')::numeric<>trunc((row_item->>'compositionOffset')::numeric) OR (row_item->>'compositionOffset')::integer NOT BETWEEN 0 AND 10000 OR row_key<>internal.sheet_row_identity_key(instance.state->'resolvedRowIdentity',row_item->'identityValues') THEN RAISE EXCEPTION 'composed row identity mismatch' USING ERRCODE='SB073'; END IF;
      composition:=api.query_sheet_instance_rows_core036(instance.id,200,(row_item->>'compositionOffset')::integer);
      SELECT item INTO result_row FROM jsonb_array_elements(composition->'rows') item WHERE item->'identityValues'=row_item->'identityValues' LIMIT 1;
      IF (composition->>'revision')::bigint<>instance.revision OR result_row IS NULL THEN RAISE EXCEPTION 'composed row is absent from current controlled composition page' USING ERRCODE='SB073'; END IF;
    END IF;
  END LOOP;
  FOR cell IN SELECT item FROM jsonb_array_elements(p_cells) item LOOP
    IF jsonb_typeof(cell)<>'object' OR cell-ARRAY['rowKey','fieldId','value']<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid local cell mutation' USING ERRCODE='22023'; END IF;
    row_key:=cell->>'rowKey'; field_id:=cell->>'fieldId';
    IF NOT row_key=ANY(seen_rows) THEN RAISE EXCEPTION 'cell references an unverified row' USING ERRCODE='SB073'; END IF;
    IF row_key||':'||field_id=ANY(seen_cells) THEN RAISE EXCEPTION 'duplicate local cell address' USING ERRCODE='22023'; END IF; seen_cells:=array_append(seen_cells,row_key||':'||field_id);
    SELECT item INTO new_field FROM jsonb_array_elements(fields) item WHERE item->>'fieldId'=field_id AND item->>'lifecycle'='active'; IF new_field IS NULL THEN RAISE EXCEPTION 'unknown or retired local field' USING ERRCODE='SB073'; END IF;
    value:=cell->'value'; error_code:=internal.sheet_local_cell_error(instance.workspace_id,new_field,value); IF error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid local cell: %',error_code USING ERRCODE='22023'; END IF;
    effective:=CASE WHEN value='null'::jsonb AND NOT (new_field->>'nullable')::boolean THEN new_field->'defaultValue' ELSE value END;
    IF NOT state->'localValues' ? row_key THEN state:=jsonb_set(state,ARRAY['localValues',row_key],'{}'::jsonb,true); END IF;
    state:=jsonb_set(state,ARRAY['localValues',row_key,field_id],effective,true);
  END LOOP;
  IF state=instance.state THEN RAISE EXCEPTION 'local mutation must change Instance state' USING ERRCODE='22023'; END IF;
  PERFORM internal.validate_sheet_instance_state(state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=state,revision=revision+1,updated_at=now(),updated_by_user_id=actor_user,updated_by_credential_id=actor_credential WHERE id=instance.id RETURNING * INTO instance;
  affected:=jsonb_build_object(
    'rowKeys',(SELECT coalesce(jsonb_agg(row_key ORDER BY row_key),'[]'::jsonb) FROM (SELECT DISTINCT item->>'rowKey' row_key FROM jsonb_array_elements(p_cells) item) affected_rows),
    'fieldIds',(SELECT coalesce(jsonb_agg(field_id ORDER BY field_id),'[]'::jsonb) FROM (SELECT DISTINCT unnest(seen_fields||ARRAY(SELECT item->>'fieldId' FROM jsonb_array_elements(p_cells) item)) field_id) affected_fields),
    'cells',to_jsonb(seen_cells)
  );
  INSERT INTO api.sheet_instance_local_mutations(workspace_id,instance_id,retry_token,request_digest,result_revision,result,actor_user_id,actor_credential_id,operation,affected) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,instance.revision,to_jsonb(instance),actor_user,actor_credential,'local_mutation',affected);
  RETURN instance;
END $$;

--> statement-breakpoint

GRANT SELECT ON api.dataset_bulk_commits TO api_client;
GRANT SELECT ON api.sheet_instance_local_mutations TO api_client;
CREATE POLICY dataset_bulk_commits_select_api_client ON api.dataset_bulk_commits
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY sheet_instance_local_mutations_select_api_client ON api.sheet_instance_local_mutations
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.commit_dataset_row_batch(uuid, bigint, jsonb, text) TO api_client;
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO api_client;
GRANT EXECUTE ON FUNCTION api.mutate_sheet_instance_local_state(uuid, bigint, uuid, jsonb, jsonb, jsonb) TO api_client;
GRANT EXECUTE ON FUNCTION api.update_record_custom_fields(uuid, integer, jsonb) TO api_client;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
