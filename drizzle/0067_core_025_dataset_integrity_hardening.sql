-- CORE-02 hardening: enforce tenancy and immutable schema contracts at the
-- database boundary. These controls deliberately supplement RLS.
CREATE OR REPLACE FUNCTION internal.assert_dataset_workspace_consistency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE schema_workspace uuid; project_workspace uuid;
BEGIN
  SELECT s.workspace_id INTO schema_workspace
  FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions s ON s.id=v.schema_id
  WHERE v.id=NEW.schema_version_id;
  IF schema_workspace IS NULL OR schema_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Dataset workspace must match its Schema Definition workspace' USING ERRCODE='23514';
  END IF;
  IF NEW.primary_project_id IS NOT NULL THEN
    SELECT workspace_id INTO project_workspace FROM api.projects WHERE id=NEW.primary_project_id;
    IF project_workspace IS NULL OR project_workspace <> NEW.workspace_id THEN
      RAISE EXCEPTION 'Dataset primary project must belong to its workspace' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assert_dataset_workspace_consistency BEFORE INSERT OR UPDATE OF workspace_id,schema_version_id,primary_project_id ON api.datasets FOR EACH ROW EXECUTE FUNCTION internal.assert_dataset_workspace_consistency();

CREATE OR REPLACE FUNCTION internal.assert_dataset_row_workspace_consistency()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset_workspace uuid;
BEGIN
  SELECT workspace_id INTO dataset_workspace FROM api.datasets WHERE id=NEW.dataset_id;
  IF dataset_workspace IS NULL OR dataset_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Dataset row workspace must match its Dataset workspace' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assert_dataset_row_workspace_consistency BEFORE INSERT OR UPDATE OF dataset_id,workspace_id ON api.dataset_rows FOR EACH ROW EXECUTE FUNCTION internal.assert_dataset_row_workspace_consistency();

CREATE OR REPLACE FUNCTION internal.prevent_published_dataset_schema_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_TABLE_NAME='dataset_schema_versions' THEN
    IF OLD.lifecycle IN ('active','retired') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'published Dataset Schema Versions are immutable' USING ERRCODE='SB072';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM api.dataset_schema_versions WHERE id=COALESCE(NEW.schema_version_id,OLD.schema_version_id) AND lifecycle IN ('active','retired')) THEN
    RAISE EXCEPTION 'published Dataset Schema Version fields are immutable' USING ERRCODE='SB072';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER prevent_published_dataset_schema_version_mutation BEFORE UPDATE OR DELETE ON api.dataset_schema_versions FOR EACH ROW EXECUTE FUNCTION internal.prevent_published_dataset_schema_mutation();
CREATE TRIGGER prevent_published_dataset_schema_field_mutation BEFORE INSERT OR UPDATE OR DELETE ON api.dataset_schema_version_fields FOR EACH ROW EXECUTE FUNCTION internal.prevent_published_dataset_schema_mutation();

ALTER TABLE api.dataset_row_values ADD COLUMN ordinal integer NOT NULL DEFAULT 0;
ALTER TABLE api.dataset_row_values DROP CONSTRAINT dataset_row_values_row_id_field_id_pk;
ALTER TABLE api.dataset_row_values ADD CONSTRAINT dataset_row_values_row_id_field_id_ordinal_pk PRIMARY KEY(row_id,field_id,ordinal);
ALTER TABLE api.dataset_row_values ADD CONSTRAINT chk_dataset_row_values_ordinal CHECK(ordinal >= 0);

CREATE OR REPLACE FUNCTION internal.validate_dataset_row_value() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field api.dataset_schema_version_fields; slots integer; target_model text;
BEGIN
 SELECT f.* INTO field FROM api.dataset_rows r JOIN api.datasets d ON d.id=r.dataset_id JOIN api.dataset_schema_version_fields f ON f.schema_version_id=d.schema_version_id AND f.field_id=NEW.field_id WHERE r.id=NEW.row_id;
 IF field.id IS NULL OR field.lifecycle <> 'active' THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
 IF field.cardinality='one' AND NEW.ordinal<>0 THEN RAISE EXCEPTION 'scalar Dataset fields require ordinal zero' USING ERRCODE='22023'; END IF;
 slots := (NEW.text_value IS NOT NULL)::int+(NEW.integer_value IS NOT NULL)::int+(NEW.numeric_value IS NOT NULL)::int+(NEW.boolean_value IS NOT NULL)::int+(NEW.date_value IS NOT NULL)::int+(NEW.timestamp_value IS NOT NULL)::int+(NEW.category_option_id IS NOT NULL)::int+(NEW.reference_id IS NOT NULL)::int;
 IF slots <> 1 THEN RAISE EXCEPTION 'exactly one typed Dataset value is required' USING ERRCODE='22023'; END IF;
 IF (field.logical_type='text' AND NEW.text_value IS NULL) OR (field.logical_type='integer' AND NEW.integer_value IS NULL) OR (field.logical_type='decimal' AND NEW.numeric_value IS NULL) OR (field.logical_type='boolean' AND NEW.boolean_value IS NULL) OR (field.logical_type='date' AND NEW.date_value IS NULL) OR (field.logical_type='timestamp' AND NEW.timestamp_value IS NULL) OR (field.logical_type='category' AND NEW.category_option_id IS NULL) OR (field.logical_type='reference' AND NEW.reference_id IS NULL) THEN RAISE EXCEPTION 'Dataset value does not match field logical type' USING ERRCODE='22023'; END IF;
 IF field.logical_type='text' AND ((field.validation ? 'minLength' AND length(NEW.text_value)<(field.validation->>'minLength')::integer) OR (field.validation ? 'maxLength' AND length(NEW.text_value)>(field.validation->>'maxLength')::integer) OR (field.validation ? 'pattern' AND NEW.text_value !~ (field.validation->>'pattern'))) THEN RAISE EXCEPTION 'text validation failed' USING ERRCODE='SB071'; END IF;
 IF field.logical_type IN ('integer','decimal') AND ((field.validation ? 'min' AND coalesce(NEW.numeric_value,NEW.integer_value::numeric)<(field.validation->>'min')::numeric) OR (field.validation ? 'max' AND coalesce(NEW.numeric_value,NEW.integer_value::numeric)>(field.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'numeric validation failed' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(field.category->'options','[]'::jsonb)) o WHERE o->>'id'=NEW.category_option_id::text AND o->>'lifecycle'='active') THEN RAISE EXCEPTION 'category option is not active for this field' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='reference' THEN
   target_model := coalesce(field.relationship->'target'->>'modelKey',field.validation->>'targetModelKey');
   IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.dataset_rows r JOIN api.records record ON record.id=NEW.reference_id AND record.workspace_id=r.workspace_id JOIN api.model_kinds m ON m.record_kind=record.kind WHERE r.id=NEW.row_id AND m.key=target_model AND record.deleted_at IS NULL) THEN RAISE EXCEPTION 'reference does not target an active compatible Record' USING ERRCODE='SB071'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Direct PostgREST writes could otherwise bypass absent-value required checks.
REVOKE INSERT, UPDATE, DELETE ON api.dataset_rows, api.dataset_row_values FROM authenticated;

-- Replace the initial scalar-only upsert with ordinal-aware persistence. A
-- cardinality-many cell is represented by an ordered JSON array; scalar cells
-- retain the original JSON scalar contract.
CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(
  p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor text;
  item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_field_id uuid; field api.dataset_schema_version_fields;
  result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer;
BEGIN
 actor:=api.claim_probe()->>'sub';
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE='22023'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('datasetId',p_dataset_id,'expectedDatasetRevision',p_expected_dataset_revision,'rows',p_rows)::text,'UTF8')),'hex');
 SELECT * INTO existing FROM api.dataset_bulk_commits WHERE workspace_id=dataset.workspace_id AND actor_user_id=actor AND idempotency_key=p_idempotency_key;
 IF existing.id IS NOT NULL THEN IF existing.dataset_id<>p_dataset_id OR existing.request_digest<>digest THEN RAISE EXCEPTION 'idempotency key was used for a different Dataset batch' USING ERRCODE='23505'; END IF; RETURN existing.result||jsonb_build_object('idempotent',true); END IF;
 validation:=api.validate_dataset_row_batch(p_dataset_id,p_expected_dataset_revision,p_rows);
 IF (validation->>'ok')::boolean IS NOT TRUE THEN RETURN validation||jsonb_build_object('idempotent',false); END IF;
 PERFORM 1 FROM api.dataset_rows r WHERE r.dataset_id=dataset.id AND r.id IN (SELECT (value->>'rowId')::uuid FROM jsonb_array_elements(p_rows)) ORDER BY r.id FOR UPDATE;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   v_row_id:=(item->>'rowId')::uuid;
   IF item->>'operation'='create' THEN INSERT INTO api.dataset_rows(id,dataset_id,workspace_id) VALUES(v_row_id,dataset.id,dataset.workspace_id); result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',1,'operation','create'));
   ELSE UPDATE api.dataset_rows SET revision=revision+1,updated_at=now() WHERE id=v_row_id; result_rows:=result_rows||jsonb_build_array(jsonb_build_object('rowId',v_row_id,'revision',(SELECT revision FROM api.dataset_rows WHERE id=v_row_id),'operation','update')); END IF;
   FOR entry IN SELECT jsonb_build_object('key',key,'value',value) FROM jsonb_each(item->'values') LOOP
     v_field_id:=(entry->>'key')::uuid; cell:=entry->'value'; SELECT * INTO field FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND field_id=v_field_id;
     DELETE FROM api.dataset_row_values WHERE row_id=v_row_id AND field_id=v_field_id;
     IF cell<>'null'::jsonb THEN
       IF field.cardinality='many' THEN
         value_ordinal:=0; FOR value_item IN SELECT value FROM jsonb_array_elements(cell) LOOP
           INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
           VALUES(v_row_id,v_field_id,value_ordinal,CASE WHEN field.logical_type='text' THEN value_item#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (value_item#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (value_item#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (value_item#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (value_item#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (value_item#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (value_item#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (value_item#>>'{}')::uuid END); value_ordinal:=value_ordinal+1; END LOOP;
       ELSE
         INSERT INTO api.dataset_row_values(row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
         VALUES(v_row_id,v_field_id,0,CASE WHEN field.logical_type='text' THEN cell#>>'{}' END,CASE WHEN field.logical_type='integer' THEN (cell#>>'{}')::bigint END,CASE WHEN field.logical_type='decimal' THEN (cell#>>'{}')::numeric END,CASE WHEN field.logical_type='boolean' THEN (cell#>>'{}')::boolean END,CASE WHEN field.logical_type='date' THEN (cell#>>'{}')::date END,CASE WHEN field.logical_type='timestamp' THEN (cell#>>'{}')::timestamptz END,CASE WHEN field.logical_type='category' THEN (cell#>>'{}')::uuid END,CASE WHEN field.logical_type='reference' THEN (cell#>>'{}')::uuid END);
       END IF;
     END IF;
   END LOOP;
 END LOOP;
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision;
 result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false);
 INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor,p_idempotency_key,digest,result); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION internal.dataset_batch_cell_error(
  p_workspace_id uuid, p_field api.dataset_schema_version_fields, p_value jsonb
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; scalar jsonb; target_model text;
BEGIN
  IF p_value='null'::jsonb THEN RETURN CASE WHEN p_field.nullable THEN NULL ELSE 'required_value' END; END IF;
  IF p_field.cardinality='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)=0 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN SELECT CASE WHEN p_field.cardinality='many' THEN value ELSE p_value END FROM jsonb_array_elements(CASE WHEN p_field.cardinality='many' THEN p_value ELSE '[]'::jsonb END) UNION ALL SELECT p_value WHERE p_field.cardinality='one' LOOP
    scalar:=item;
    IF (p_field.logical_type='text' AND jsonb_typeof(scalar)<>'string') OR (p_field.logical_type IN ('integer','decimal') AND jsonb_typeof(scalar)<>'number') OR (p_field.logical_type='boolean' AND jsonb_typeof(scalar)<>'boolean') OR (p_field.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(scalar)<>'string') THEN RETURN 'invalid_value_type'; END IF;
    BEGIN
      IF p_field.logical_type='integer' THEN PERFORM (scalar#>>'{}')::bigint; ELSIF p_field.logical_type='decimal' THEN PERFORM (scalar#>>'{}')::numeric; ELSIF p_field.logical_type='date' THEN PERFORM (scalar#>>'{}')::date; ELSIF p_field.logical_type='timestamp' THEN PERFORM (scalar#>>'{}')::timestamptz; ELSIF p_field.logical_type IN ('category','reference') THEN PERFORM (scalar#>>'{}')::uuid; END IF;
    EXCEPTION WHEN others THEN RETURN 'invalid_value'; END;
    IF p_field.logical_type='text' AND ((p_field.validation ? 'minLength' AND length(scalar#>>'{}')<(p_field.validation->>'minLength')::integer) OR (p_field.validation ? 'maxLength' AND length(scalar#>>'{}')>(p_field.validation->>'maxLength')::integer) OR (p_field.validation ? 'pattern' AND scalar#>>'{}' !~ (p_field.validation->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    IF p_field.logical_type IN ('integer','decimal') AND ((p_field.validation ? 'min' AND (scalar#>>'{}')::numeric<(p_field.validation->>'min')::numeric) OR (p_field.validation ? 'max' AND (scalar#>>'{}')::numeric>(p_field.validation->>'max')::numeric)) THEN RETURN 'numeric_validation'; END IF;
    IF p_field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_field.category->'options','[]'::jsonb)) option WHERE option->>'id'=scalar#>>'{}' AND option->>'lifecycle'='active') THEN RETURN 'invalid_category_option'; END IF;
    IF p_field.logical_type='reference' THEN
      target_model:=coalesce(p_field.relationship->'target'->>'modelKey',p_field.validation->>'targetModelKey');
      IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind WHERE r.id=(scalar#>>'{}')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=target_model) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION api.validate_dataset_row_batch(
  p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets; item jsonb; cell jsonb; field api.dataset_schema_version_fields; v_field_id uuid; key text; row_id uuid; existing_row api.dataset_rows; row_index integer:=0; errors jsonb:='[]'::jsonb; error_code text; effective jsonb;
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_expected_dataset_revision IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'expected Dataset revision and 1 to 1000 batch rows are required' USING ERRCODE='22023'; END IF;
 IF dataset.lifecycle<>'active' THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','dataset_archived'))); END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','stale_dataset_revision','expectedRevision',p_expected_dataset_revision,'actualRevision',dataset.revision))); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  row_index:=row_index+1;
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['operation','rowId','expectedRevision','values']<>'{}'::jsonb OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId')<>'string' OR jsonb_typeof(item->'values')<>'object' THEN RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023'; END IF;
  BEGIN row_id:=(item->>'rowId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset row id' USING ERRCODE='22023'; END;
  SELECT * INTO existing_row FROM api.dataset_rows WHERE id=row_id AND dataset_id=dataset.id;
  IF item->>'operation'='create' AND existing_row.id IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','row_id_exists'));
  ELSIF item->>'operation'='update' AND (existing_row.id IS NULL OR jsonb_typeof(item->'expectedRevision')<>'number' OR existing_row.revision<>(item->>'expectedRevision')::bigint) THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code',CASE WHEN existing_row.id IS NULL THEN 'row_missing' ELSE 'stale_row_revision' END)); END IF;
  FOR key,cell IN SELECT entry.key,entry.value FROM jsonb_each(item->'values') entry LOOP
   BEGIN v_field_id:=key::uuid; EXCEPTION WHEN invalid_text_representation THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'fieldId',key,'code','invalid_field_id')); CONTINUE; END;
   SELECT * INTO field FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND field_id=v_field_id AND lifecycle='active';
   IF field.id IS NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','unknown_field')); CONTINUE; END IF;
   error_code:=internal.dataset_batch_cell_error(dataset.workspace_id,field,cell);
   IF error_code IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code',error_code)); END IF;
  END LOOP;
  FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' AND NOT nullable LOOP
   effective:=item->'values'->field.field_id::text;
   IF effective IS NULL AND item->>'operation'='update' THEN SELECT CASE WHEN count(*)=0 THEN NULL WHEN field.cardinality='many' THEN jsonb_agg(to_jsonb(coalesce(text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)) ORDER BY ordinal) ELSE max(to_jsonb(coalesce(text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id))) END INTO effective FROM api.dataset_row_values WHERE row_id=row_id AND field_id=field.field_id; END IF;
   IF effective IS NULL THEN effective:=field.default_value; END IF;
   IF effective IS NULL OR effective='null'::jsonb THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code','required_value')); END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',jsonb_array_length(errors)=0,'errors',errors);
END $$;
NOTIFY pgrst, 'reload schema';
