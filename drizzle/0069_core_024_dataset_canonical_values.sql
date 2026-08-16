-- CORE-02.4/02.5: make the controlled Dataset boundary apply the complete
-- persisted FieldDefinition contract, including defaults and cardinality.
CREATE OR REPLACE FUNCTION internal.dataset_batch_cell_error(
  p_workspace_id uuid, p_field api.dataset_schema_version_fields, p_value jsonb
) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; target_model text;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN
    RETURN CASE WHEN p_field.nullable THEN NULL ELSE 'required_value' END;
  END IF;
  -- The canonical kernel deliberately has no many-valued defaults. Treat a
  -- malformed stored default as invalid rather than letting it satisfy required.
  IF p_field.cardinality='many' AND p_value IS NOT NULL AND p_value <> 'null'::jsonb
     AND p_value = p_field.default_value THEN RETURN 'invalid_default'; END IF;
  IF p_field.cardinality='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)=0 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(CASE WHEN p_field.cardinality='many' THEN p_value ELSE '[]'::jsonb END)
    UNION ALL SELECT p_value WHERE p_field.cardinality='one'
  LOOP
    IF (p_field.logical_type='text' AND jsonb_typeof(item)<>'string') OR
       (p_field.logical_type IN ('integer','decimal') AND jsonb_typeof(item)<>'number') OR
       (p_field.logical_type='boolean' AND jsonb_typeof(item)<>'boolean') OR
       (p_field.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(item)<>'string') THEN RETURN 'invalid_value_type'; END IF;
    BEGIN
      IF p_field.logical_type='integer' THEN PERFORM (item#>>'{}')::bigint;
      ELSIF p_field.logical_type='decimal' THEN PERFORM (item#>>'{}')::numeric;
      ELSIF p_field.logical_type='date' THEN PERFORM (item#>>'{}')::date;
      ELSIF p_field.logical_type='timestamp' THEN PERFORM (item#>>'{}')::timestamptz;
      ELSIF p_field.logical_type IN ('category','reference') THEN PERFORM (item#>>'{}')::uuid;
      END IF;
    EXCEPTION WHEN others THEN RETURN 'invalid_value'; END;
    IF p_field.logical_type='text' AND ((p_field.validation ? 'minLength' AND length(item#>>'{}')<(p_field.validation->>'minLength')::integer) OR (p_field.validation ? 'maxLength' AND length(item#>>'{}')>(p_field.validation->>'maxLength')::integer) OR (p_field.validation ? 'pattern' AND item#>>'{}' !~ (p_field.validation->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    IF p_field.logical_type IN ('integer','decimal') AND ((p_field.validation ? 'min' AND (item#>>'{}')::numeric<(p_field.validation->>'min')::numeric) OR (p_field.validation ? 'max' AND (item#>>'{}')::numeric>(p_field.validation->>'max')::numeric)) THEN RETURN 'numeric_validation'; END IF;
    IF p_field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_field.category->'options','[]'::jsonb)) option WHERE option->>'id'=item#>>'{}' AND option->>'lifecycle'='active') THEN RETURN 'invalid_category_option'; END IF;
    IF p_field.logical_type='reference' THEN
      target_model:=coalesce(p_field.relationship->'target'->>'modelKey',p_field.validation->>'targetModelKey');
      IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind WHERE r.id=(item#>>'{}')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=target_model) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Draft Schema Versions remain editable. Publication is the authoritative
-- boundary that turns their persisted JSON metadata into a usable contract.
CREATE OR REPLACE FUNCTION internal.assert_publishable_dataset_schema_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field api.dataset_schema_version_fields; workspace_id uuid; error_code text;
BEGIN
  IF OLD.lifecycle='draft' AND NEW.lifecycle='active' THEN
    SELECT s.workspace_id INTO workspace_id FROM api.dataset_schema_definitions s WHERE s.id=NEW.schema_id;
    FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=NEW.id LOOP
      IF btrim(field.key)='' OR btrim(field.label)='' THEN RAISE EXCEPTION 'Dataset Schema field key and label must be nonblank' USING ERRCODE='SB071'; END IF;
      IF field.cardinality NOT IN ('one','many') OR field.logical_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference') THEN RAISE EXCEPTION 'invalid Dataset Schema field type metadata' USING ERRCODE='SB071'; END IF;
      IF field.cardinality='many' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN RAISE EXCEPTION 'many Dataset fields cannot have defaults' USING ERRCODE='SB071'; END IF;
      IF jsonb_typeof(field.validation) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END IF;
      BEGIN
        IF (field.validation ? 'min' AND jsonb_typeof(field.validation->'min')<>'number') OR (field.validation ? 'max' AND jsonb_typeof(field.validation->'max')<>'number') OR (field.validation ? 'min' AND field.validation ? 'max' AND (field.validation->>'min')::numeric>(field.validation->>'max')::numeric) THEN RAISE EXCEPTION 'invalid Dataset numeric validation metadata' USING ERRCODE='SB071'; END IF;
        IF (field.validation ? 'minLength' AND (jsonb_typeof(field.validation->'minLength')<>'number' OR (field.validation->>'minLength') !~ '^[0-9]+$')) OR (field.validation ? 'maxLength' AND (jsonb_typeof(field.validation->'maxLength')<>'number' OR (field.validation->>'maxLength') !~ '^[0-9]+$')) OR (field.validation ? 'minLength' AND field.validation ? 'maxLength' AND (field.validation->>'minLength')::integer>(field.validation->>'maxLength')::integer) THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF;
        IF field.validation ? 'pattern' THEN IF jsonb_typeof(field.validation->'pattern')<>'string' THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF; PERFORM '' ~ (field.validation->>'pattern'); END IF;
      EXCEPTION WHEN invalid_regular_expression OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END;
      IF field.quantity IS NOT NULL AND (field.logical_type NOT IN ('integer','decimal') OR jsonb_typeof(field.quantity)<>'object' OR coalesce(btrim(field.quantity->>'kind'),'')='' OR coalesce(btrim(field.quantity->>'dimension'),'')='' OR coalesce(btrim(field.quantity->>'storageUnit'),'')='') THEN RAISE EXCEPTION 'invalid Dataset quantity metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='category' THEN
        IF jsonb_typeof(field.category)<>'object' OR field.category->>'kind'<>'embedded' OR jsonb_typeof(field.category->'options')<>'array' THEN RAISE EXCEPTION 'unsupported Dataset category metadata' USING ERRCODE='SB071'; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o WHERE jsonb_typeof(o)<>'object' OR coalesce(btrim(o->>'id'),'')='' OR coalesce(btrim(o->>'key'),'')='' OR coalesce(btrim(o->>'label'),'')='' OR o->>'lifecycle' NOT IN ('active','retired') OR coalesce(o->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'id' HAVING count(*)>1) OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'invalid Dataset category options' USING ERRCODE='SB071'; END IF;
      ELSIF field.category IS NOT NULL THEN RAISE EXCEPTION 'only category fields may have category metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='reference' THEN
        IF jsonb_typeof(field.relationship)<>'object' OR field.relationship->'target'->>'kind'<>'model' OR coalesce(btrim(field.relationship->'target'->>'modelKey'),'')='' OR field.relationship->>'cardinality'<>field.cardinality THEN RAISE EXCEPTION 'invalid Dataset relationship metadata' USING ERRCODE='SB071'; END IF;
      ELSIF field.relationship IS NOT NULL THEN RAISE EXCEPTION 'only reference fields may have relationship metadata' USING ERRCODE='SB071'; END IF;
      IF field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN
        error_code:=internal.dataset_batch_cell_error(workspace_id,field,field.default_value);
        IF error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid Dataset field default: %',error_code USING ERRCODE='SB071'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assert_publishable_dataset_schema_version BEFORE UPDATE OF lifecycle ON api.dataset_schema_versions FOR EACH ROW EXECUTE FUNCTION internal.assert_publishable_dataset_schema_version();

CREATE OR REPLACE FUNCTION api.validate_dataset_row_batch(p_dataset_id uuid,p_expected_dataset_revision bigint,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE dataset api.datasets; item jsonb; cell jsonb; field api.dataset_schema_version_fields; v_field_id uuid; key text; row_id uuid; existing_row api.dataset_rows; row_index integer:=0; errors jsonb:='[]'::jsonb; error_code text; effective jsonb; seen uuid[] := '{}';
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_expected_dataset_revision IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'expected Dataset revision and 1 to 1000 batch rows are required' USING ERRCODE='22023'; END IF;
 IF dataset.lifecycle<>'active' THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','dataset_archived'))); END IF;
 IF dataset.revision<>p_expected_dataset_revision THEN RETURN jsonb_build_object('ok',false,'errors',jsonb_build_array(jsonb_build_object('code','stale_dataset_revision','expectedRevision',p_expected_dataset_revision,'actualRevision',dataset.revision))); END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  row_index:=row_index+1;
  IF jsonb_typeof(item)<>'object' OR item-ARRAY['operation','rowId','expectedRevision','values']<>'{}'::jsonb OR item->>'operation' NOT IN ('create','update') OR jsonb_typeof(item->'rowId')<>'string' OR jsonb_typeof(item->'values')<>'object' THEN RAISE EXCEPTION 'invalid Dataset batch row shape' USING ERRCODE='22023'; END IF;
  BEGIN row_id:=(item->>'rowId')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid Dataset row id' USING ERRCODE='22023'; END;
  IF row_id=ANY(seen) THEN RAISE EXCEPTION 'duplicate Dataset row id in batch' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,row_id);
  IF item->>'operation'='create' AND item ? 'expectedRevision' THEN RAISE EXCEPTION 'Dataset creates cannot include an expected row revision' USING ERRCODE='22023'; END IF;
  IF item->>'operation'='update' AND (jsonb_typeof(item->'expectedRevision')<>'number' OR coalesce((item->>'expectedRevision') ~ '^[1-9][0-9]*$',false) IS NOT TRUE) THEN RAISE EXCEPTION 'Dataset updates require a positive expected row revision' USING ERRCODE='22023'; END IF;
  SELECT * INTO existing_row FROM api.dataset_rows WHERE id=row_id AND dataset_id=dataset.id;
  IF item->>'operation'='create' AND EXISTS (SELECT 1 FROM api.dataset_rows WHERE id=row_id) THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code','row_id_exists'));
  ELSIF item->>'operation'='update' AND (existing_row.id IS NULL OR jsonb_typeof(item->'expectedRevision')<>'number' OR existing_row.revision<>(item->>'expectedRevision')::bigint) THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'code',CASE WHEN existing_row.id IS NULL THEN 'row_missing' ELSE 'stale_row_revision' END)); END IF;
  FOR key,cell IN SELECT entry.key,entry.value FROM jsonb_each(item->'values') entry LOOP
   BEGIN v_field_id:=key::uuid; EXCEPTION WHEN invalid_text_representation THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','invalid_field_id')); CONTINUE; END;
   SELECT * INTO field FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND field_id=v_field_id AND lifecycle='active';
   IF field.id IS NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',key,'code','unknown_field')); CONTINUE; END IF;
   IF cell<>'null'::jsonb THEN
     error_code:=internal.dataset_batch_cell_error(dataset.workspace_id,field,cell);
     IF error_code IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',v_field_id,'code',error_code)); END IF;
   END IF;
  END LOOP;
  FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=dataset.schema_version_id AND lifecycle='active' AND NOT nullable LOOP
   effective:=item->'values'->field.field_id::text;
   IF item->'values' ? field.field_id::text AND effective<>'null'::jsonb THEN CONTINUE; END IF;
   IF (effective IS NULL OR effective='null'::jsonb) AND item->>'operation'='update' AND effective IS NULL THEN
     SELECT CASE WHEN count(*)=0 THEN NULL WHEN field.cardinality='many' THEN jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal) ELSE (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 END INTO effective FROM api.dataset_row_values v WHERE v.row_id=row_id AND v.field_id=field.field_id;
   END IF;
   IF effective IS NULL OR effective='null'::jsonb THEN effective:=field.default_value; END IF;
   IF effective IS NULL OR effective='null'::jsonb THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code','required_value'));
   ELSE
     error_code:=internal.dataset_batch_cell_error(dataset.workspace_id,field,effective);
     IF error_code IS NOT NULL THEN errors:=errors||jsonb_build_array(jsonb_build_object('rowIndex',row_index,'rowId',row_id,'fieldId',field.field_id,'code',CASE WHEN effective=field.default_value THEN 'invalid_default' ELSE error_code END)); END IF;
   END IF;
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',jsonb_array_length(errors)=0,'errors',errors);
END $$;

-- Apply scalar defaults at the same boundary that accepted them. Updates only
-- synthesize one where a required value is absent or explicitly removed.
CREATE OR REPLACE FUNCTION api.commit_dataset_row_batch(p_dataset_id uuid,p_expected_dataset_revision bigint,p_rows jsonb,p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets; existing api.dataset_bulk_commits; validation jsonb; digest text; actor text; item jsonb; cell jsonb; entry jsonb; v_row_id uuid; v_field_id uuid; field api.dataset_schema_version_fields; result_rows jsonb:='[]'::jsonb; result jsonb; value_item jsonb; value_ordinal integer; effective jsonb;
BEGIN
 actor:=api.claim_probe()->>'sub'; SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id) FOR UPDATE;
 IF dataset.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE='22023'; END IF;
 digest:=encode(sha256(convert_to(jsonb_build_object('datasetId',p_dataset_id,'expectedDatasetRevision',p_expected_dataset_revision,'rows',p_rows)::text,'UTF8')),'hex'); SELECT * INTO existing FROM api.dataset_bulk_commits WHERE workspace_id=dataset.workspace_id AND actor_user_id=actor AND idempotency_key=p_idempotency_key;
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
 UPDATE api.datasets SET revision=revision+1,updated_at=now() WHERE id=dataset.id RETURNING revision INTO dataset.revision; result:=jsonb_build_object('ok',true,'datasetId',dataset.id,'datasetRevision',dataset.revision,'rows',result_rows,'idempotent',false); INSERT INTO api.dataset_bulk_commits(workspace_id,dataset_id,actor_user_id,idempotency_key,request_digest,result) VALUES(dataset.workspace_id,dataset.id,actor,p_idempotency_key,digest,result); RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.query_dataset_rows(p_dataset_id uuid,p_query jsonb DEFAULT '{}'::jsonb,p_limit integer DEFAULT 200,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets; filter_item jsonb; sort_item jsonb; field api.dataset_schema_version_fields; filter_sql text := ''; base_sql text; sort_sql text := 'r.id'; sort_direction text := 'ASC'; value_column text; total_count bigint; rows jsonb; v_field_id uuid; operator text; value_text text;
BEGIN
 SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id); IF dataset.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR p_query-ARRAY['filters','sort']<>'{}'::jsonb OR (p_query ? 'filters' AND jsonb_typeof(p_query->'filters') IS DISTINCT FROM 'array') OR (p_query ? 'sort' AND jsonb_typeof(p_query->'sort') IS DISTINCT FROM 'object') THEN RAISE EXCEPTION 'invalid Dataset query shape' USING ERRCODE='22023'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Dataset query limit must be 1 to 1000 and offset non-negative' USING ERRCODE='22023'; END IF;
 IF coalesce(jsonb_array_length(p_query->'filters'),0)>8 THEN RAISE EXCEPTION 'Dataset query supports at most eight filters' USING ERRCODE='22023'; END IF;
 FOR filter_item IN SELECT value FROM jsonb_array_elements(coalesce(p_query->'filters','[]'::jsonb)) LOOP
  IF jsonb_typeof(filter_item)<>'object' OR filter_item-ARRAY['fieldId','operator','value']<>'{}'::jsonb OR jsonb_typeof(filter_item->'fieldId')<>'string' OR jsonb_typeof(filter_item->'operator')<>'string' OR NOT filter_item?'value' THEN RAISE EXCEPTION 'invalid Dataset filter shape' USING ERRCODE='22023'; END IF;
  BEGIN v_field_id:=(filter_item->>'fieldId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END; SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active'; IF field.id IS NULL THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF; operator:=filter_item->>'operator'; IF operator NOT IN ('eq','gt','gte','lt','lte') OR (operator<>'eq' AND field.logical_type NOT IN ('integer','decimal','date','timestamp')) THEN RAISE EXCEPTION 'unsupported Dataset filter operator' USING ERRCODE='22023'; END IF; value_text:=filter_item->'value'#>>'{}'; BEGIN IF field.logical_type='integer' THEN PERFORM value_text::bigint; ELSIF field.logical_type='decimal' THEN PERFORM value_text::numeric; ELSIF field.logical_type='boolean' THEN PERFORM value_text::boolean; ELSIF field.logical_type='date' THEN PERFORM value_text::date; ELSIF field.logical_type='timestamp' THEN PERFORM value_text::timestamptz; ELSIF field.logical_type IN ('category','reference') THEN PERFORM value_text::uuid; END IF; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Dataset filter value does not match field type' USING ERRCODE='22023'; END; value_column:=CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value' WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value' WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END; filter_sql:=filter_sql||format(' AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid AND v.%I %s %L::%s)',v_field_id,value_column,CASE operator WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END,value_text,CASE field.logical_type WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date' WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE 'text' END);
 END LOOP;
 IF p_query ? 'sort' THEN sort_item:=p_query->'sort'; IF sort_item-ARRAY['fieldId','direction']<>'{}'::jsonb OR jsonb_typeof(sort_item->'fieldId') IS DISTINCT FROM 'string' OR jsonb_typeof(sort_item->'direction') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'invalid Dataset sort shape' USING ERRCODE='22023'; END IF; BEGIN v_field_id:=(sort_item->>'fieldId')::uuid; EXCEPTION WHEN others THEN RAISE EXCEPTION 'invalid Dataset field id' USING ERRCODE='22023'; END; SELECT * INTO field FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=dataset.schema_version_id AND f.field_id=v_field_id AND f.lifecycle='active'; IF field.id IS NULL OR sort_item->>'direction' NOT IN ('asc','desc') THEN RAISE EXCEPTION 'invalid Dataset sort shape' USING ERRCODE='22023'; END IF; value_column:=CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value' WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value' WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END; sort_sql:=format('(SELECT v.%I FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=%L::uuid ORDER BY v.ordinal LIMIT 1)',value_column,v_field_id); sort_direction:=upper(sort_item->>'direction'); END IF;
 base_sql:=format(' FROM api.dataset_rows r WHERE r.dataset_id=%L::uuid',dataset.id)||filter_sql; EXECUTE 'SELECT count(*)'||base_sql INTO total_count;
 EXECUTE 'SELECT coalesce(jsonb_agg(jsonb_build_object(''rowId'',p.id,''revision'',p.revision,''values'',p.values) ORDER BY p.sort_value '||sort_direction||' NULLS LAST,p.id),''[]''::jsonb) FROM (SELECT r.id,r.revision,'||sort_sql||' AS sort_value,(SELECT coalesce(jsonb_object_agg(f.field_id::text,CASE WHEN f.cardinality=''many'' THEN coalesce((SELECT jsonb_agg(coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) ORDER BY v.ordinal) FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=f.field_id),''[]''::jsonb) ELSE (SELECT coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id)) FROM api.dataset_row_values v WHERE v.row_id=r.id AND v.field_id=f.field_id ORDER BY v.ordinal LIMIT 1) END),''{}''::jsonb) FROM api.dataset_schema_version_fields f WHERE f.schema_version_id='||quote_literal(dataset.schema_version_id)||'::uuid) values'||base_sql||' ORDER BY '||sort_sql||' '||sort_direction||format(' NULLS LAST,r.id ASC LIMIT %s OFFSET %s) p',p_limit,p_offset) INTO rows;
 RETURN jsonb_build_object('datasetId',dataset.id,'datasetRevision',dataset.revision,'offset',p_offset,'limit',p_limit,'totalCount',total_count,'hasMore',p_offset+p_limit<total_count,'rows',rows);
END $$;

-- Snapshot reconstruction follows the pinned schema cardinality, not the
-- incidental number of stored values (a one-item many remains an array).
CREATE OR REPLACE FUNCTION api.query_dataset_version_rows(p_dataset_version_id uuid,p_limit integer DEFAULT 200,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.dataset_versions;
BEGIN
 SELECT * INTO version FROM api.dataset_versions WHERE id=p_dataset_version_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id);
 IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE='42501'; END IF;
 IF p_limit NOT BETWEEN 1 AND 1000 OR p_offset<0 THEN RAISE EXCEPTION 'invalid Dataset Version window' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('datasetVersionId',version.id,'datasetId',version.dataset_id,'schemaVersionId',version.schema_version_id,'sourceDatasetRevision',version.source_dataset_revision,'offset',p_offset,'limit',p_limit,'totalCount',(SELECT count(*) FROM api.dataset_version_rows WHERE dataset_version_id=version.id),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('rowId',r.row_id,'revision',r.revision,'values',coalesce((SELECT jsonb_object_agg(field_id,values) FROM (SELECT field_id,CASE WHEN (SELECT f.cardinality FROM api.dataset_schema_version_fields f WHERE f.schema_version_id=version.schema_version_id AND f.field_id=v.field_id)='one' THEN (jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal))->0 ELSE jsonb_agg(coalesce(to_jsonb(text_value),to_jsonb(integer_value),to_jsonb(numeric_value),to_jsonb(boolean_value),to_jsonb(date_value),to_jsonb(timestamp_value),to_jsonb(category_option_id),to_jsonb(reference_id)) ORDER BY ordinal) END values FROM api.dataset_version_values v WHERE dataset_version_id=version.id AND row_id=r.row_id GROUP BY field_id) fields),'{}'::jsonb))) FROM (SELECT * FROM api.dataset_version_rows WHERE dataset_version_id=version.id ORDER BY row_id LIMIT p_limit OFFSET p_offset) r),'[]'::jsonb));
END $$;

NOTIFY pgrst, 'reload schema';
