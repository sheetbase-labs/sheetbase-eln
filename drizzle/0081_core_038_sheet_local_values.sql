-- CORE-03.8: controlled, durable Instance-owned local fields and values after
-- the generated ledger-table migration.
ALTER TABLE api.sheet_instance_local_mutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheet_instance_local_mutations_read ON api.sheet_instance_local_mutations FOR SELECT TO authenticated
  USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
REVOKE ALL ON api.sheet_instance_local_mutations FROM PUBLIC,authenticated,api_client;
GRANT SELECT ON api.sheet_instance_local_mutations TO authenticated;

-- Produce the byte-for-byte compact JSON used by rowIdentityKey. Array
-- elements are scalars, so joining their individual jsonb rendering preserves
-- string content while removing only structural whitespace.
CREATE FUNCTION internal.sheet_row_identity_array_text(p_values jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT '['||coalesce(string_agg(value::text,',' ORDER BY ordinality),'')||']'
  FROM jsonb_array_elements(p_values) WITH ORDINALITY
$$;

CREATE FUNCTION internal.sheet_row_identity_key(p_identity jsonb,p_values jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT 'sb-row-v1:'||encode(sha256(convert_to(
    '{"v":1,"kind":'||to_jsonb(p_identity->>'kind')::text||
    ',"columns":'||internal.sheet_row_identity_array_text(p_identity->'columnIds')||
    ',"types":'||internal.sheet_row_identity_array_text(p_identity->'logicalTypes')||
    ',"values":'||internal.sheet_row_identity_array_text(p_values)||'}','UTF8')),'hex')
$$;

CREATE FUNCTION internal.sheet_local_cell_error(p_workspace_id uuid,p_field jsonb,p_value jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE item jsonb; target_model text;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN
    RETURN CASE WHEN (p_field->>'nullable')::boolean OR p_field->'defaultValue'<>'null'::jsonb THEN NULL ELSE 'required_value' END;
  END IF;
  IF p_field->>'cardinality'='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value) NOT BETWEEN 1 AND 1000 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(CASE WHEN p_field->>'cardinality'='many' THEN p_value ELSE '[]'::jsonb END)
    UNION ALL SELECT p_value WHERE p_field->>'cardinality'='one'
  LOOP
    IF NOT internal.sheet_definition_scalar_matches(p_field->>'logicalType',item) THEN RETURN 'invalid_value'; END IF;
    IF p_field->>'logicalType'='text' AND
       ((p_field->'validation' ? 'minLength' AND length(item#>>'{}')<(p_field->'validation'->>'minLength')::integer)
        OR (p_field->'validation' ? 'maxLength' AND length(item#>>'{}')>(p_field->'validation'->>'maxLength')::integer)
        OR (p_field->'validation' ? 'pattern' AND item#>>'{}' !~ (p_field->'validation'->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    IF p_field->>'logicalType' IN ('integer','decimal') AND
       ((p_field->'validation' ? 'min' AND (item#>>'{}')::numeric<(p_field->'validation'->>'min')::numeric)
        OR (p_field->'validation' ? 'max' AND (item#>>'{}')::numeric>(p_field->'validation'->>'max')::numeric)) THEN RETURN 'numeric_validation'; END IF;
    IF p_field->>'logicalType'='category' AND
       (p_field->'category'->>'kind'<>'embedded' OR NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(p_field->'category'->'options') option
         WHERE option->>'id'=item#>>'{}' AND option->>'lifecycle'='active')) THEN RETURN 'invalid_category_option'; END IF;
    IF p_field->>'logicalType'='reference' THEN
      target_model:=p_field->'relationship'->'target'->>'modelKey';
      IF p_field->'relationship'->'target'->>'kind'<>'model' OR target_model IS NULL OR NOT EXISTS(
        SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind
        WHERE r.id=(item#>>'{}')::uuid AND r.workspace_id=p_workspace_id
          AND r.deleted_at IS NULL AND m.key=target_model
      ) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

ALTER FUNCTION internal.validate_sheet_instance_state(jsonb) RENAME TO validate_sheet_instance_state_core037;
CREATE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE row_key text; row_value jsonb; field_id text; field jsonb; value jsonb;
BEGIN
  PERFORM internal.validate_sheet_instance_state_core037(jsonb_set(p_state,'{localValues}','{}'::jsonb));
  FOR row_key,row_value IN SELECT * FROM jsonb_each(p_state->'localValues') LOOP
    IF row_key !~ '^sb-row-v1:[0-9a-f]{64}$' AND row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid local row key' USING ERRCODE='SB073'; END IF;
    IF jsonb_typeof(row_value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(row_value))>256 THEN RAISE EXCEPTION 'invalid local value row' USING ERRCODE='SB073'; END IF;
    FOR field_id,value IN SELECT * FROM jsonb_each(row_value) LOOP
      SELECT item INTO field FROM jsonb_array_elements(p_state->'localFields') item WHERE item->>'fieldId'=field_id;
      IF field IS NULL OR internal.sheet_local_cell_error(NULL,field,value) IS NOT NULL AND field->>'logicalType'<>'reference' THEN RAISE EXCEPTION 'invalid or unknown local value' USING ERRCODE='SB073'; END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_instance_from_definition(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb,p_parameter_inputs jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); resolved jsonb; identity_kind text;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
  resolved:=internal.resolve_sheet_parameters(p_workspace_id,p_source_definition_version_id,p_parameter_inputs);
  SELECT configuration->'rowIdentity'->>'kind' INTO identity_kind FROM api.sheet_definition_versions WHERE id=p_source_definition_version_id;
  p_state:=(p_state-'bindings'-'parameterValues'-'provenance'-'resolutionProvenance'-'resolvedRowIdentity')||resolved||jsonb_build_object('provenance',jsonb_build_object('createdFrom','definition_version'));
  IF (identity_kind<>'local' AND p_state->'localValues'<>'{}'::jsonb) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_state->'localValues') key WHERE key ~ '^sb-row-v1:') THEN RAISE EXCEPTION 'initial local values do not match the unresolved Definition row identity' USING ERRCODE='SB073'; END IF;
  IF EXISTS(
    SELECT 1 FROM jsonb_each(p_state->'localValues') row_entry
    CROSS JOIN LATERAL jsonb_each(row_entry.value) cell
    JOIN LATERAL jsonb_array_elements(p_state->'localFields') field ON field->>'fieldId'=cell.key
    WHERE internal.sheet_local_cell_error(p_workspace_id,field,cell.value) IS NOT NULL
  ) THEN RAISE EXCEPTION 'invalid initial local value' USING ERRCODE='SB073'; END IF;
  PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  INSERT INTO api.sheet_instances(workspace_id,name,description,source_definition_version_id,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_source_definition_version_id,p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_instance(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 IF p_source_definition_version_id IS NOT NULL THEN RAISE EXCEPTION 'Definition-derived Instances require authoritative parameter resolution' USING ERRCODE='SB074'; END IF;
 IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
 SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb));
 p_state:=jsonb_set((p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',stripped_bindings),'{provenance}',jsonb_build_object('createdFrom','ad_hoc'),true);
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_state->'localValues') key WHERE key ~ '^sb-row-v1:') THEN RAISE EXCEPTION 'ad hoc initial local values require persisted local UUID identities' USING ERRCODE='SB073'; END IF;
 IF EXISTS(
   SELECT 1 FROM jsonb_each(p_state->'localValues') row_entry
   CROSS JOIN LATERAL jsonb_each(row_entry.value) cell
   JOIN LATERAL jsonb_array_elements(p_state->'localFields') field ON field->>'fieldId'=cell.key
   WHERE internal.sheet_local_cell_error(p_workspace_id,field,cell.value) IS NOT NULL
 ) THEN RAISE EXCEPTION 'invalid initial local value' USING ERRCODE='SB073'; END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 INSERT INTO api.sheet_instances(workspace_id,name,description,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result; RETURN result;
END $$;

-- Generic Instance updates continue to own presentation/overrides, but can no
-- longer bypass the controlled local mutation/audit boundary.
CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' OR result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
 IF p_state->'localFields' IS DISTINCT FROM result.state->'localFields' OR p_state->'localValues' IS DISTINCT FROM result.state->'localValues' THEN RAISE EXCEPTION 'local fields and values require the controlled local mutation RPC' USING ERRCODE='SB073'; END IF;
 p_state:=jsonb_set(jsonb_set(p_state,'{provenance}',result.state->'provenance',true),'{localFields}',result.state->'localFields',true); p_state:=jsonb_set(p_state,'{localValues}',result.state->'localValues',true);
 IF result.source_definition_version_id IS NOT NULL THEN p_state:=(p_state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',result.state->'bindings','parameterValues',coalesce(result.state->'parameterValues','[]'::jsonb),'resolutionProvenance',result.state->'resolutionProvenance','resolvedRowIdentity',result.state->'resolvedRowIdentity'); ELSE SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb)); p_state:=(p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',stripped_bindings); END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;

CREATE FUNCTION api.mutate_sheet_instance_local_state(
  p_instance_id uuid,p_expected_revision bigint,p_retry_token uuid,
  p_field_changes jsonb,p_rows jsonb,p_cells jsonb
) RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; existing_mutation api.sheet_instance_local_mutations;
  actor text:=api.current_user_id(); digest text; change jsonb; row_item jsonb; cell jsonb;
  state jsonb; fields jsonb; old_field jsonb; new_field jsonb; field_id text; row_key text;
  value jsonb; effective jsonb; error_code text; seen_fields text[]:='{}'; seen_rows text[]:='{}';
  seen_cells text[]:='{}'; composition jsonb; result_row jsonb; affected jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR actor IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF p_retry_token IS NULL THEN RAISE EXCEPTION 'retry token is required' USING ERRCODE='22023'; END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_revision,'fieldChanges',p_field_changes,'rows',p_rows,'cells',p_cells)::text,'UTF8')),'hex');
  SELECT * INTO existing_mutation FROM api.sheet_instance_local_mutations WHERE instance_id=p_instance_id AND retry_token=p_retry_token;
  IF existing_mutation.id IS NOT NULL THEN
    IF existing_mutation.request_digest<>digest OR existing_mutation.actor_user_id<>actor THEN RAISE EXCEPTION 'retry token was used for a different local mutation' USING ERRCODE='23505'; END IF;
    RETURN jsonb_populate_record(NULL::api.sheet_instances,existing_mutation.result);
  END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF jsonb_typeof(p_field_changes)<>'array' OR jsonb_array_length(p_field_changes)>32 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows)>200 OR jsonb_typeof(p_cells)<>'array' OR jsonb_array_length(p_cells)>1000 OR jsonb_array_length(p_field_changes)+jsonb_array_length(p_cells)=0 THEN RAISE EXCEPTION 'local mutation requires a non-empty bounded batch' USING ERRCODE='22023'; END IF;
  state:=instance.state; fields:=state->'localFields';
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
      IF row_item-ARRAY['kind','rowKey']<>'{}'::jsonb OR instance.state->'resolvedRowIdentity'->>'kind'<>'local' OR row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR NOT instance.state->'localValues' ? row_key THEN RAISE EXCEPTION 'unknown local UUID row identity' USING ERRCODE='SB073'; END IF;
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
  UPDATE api.sheet_instances SET state=state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance.id RETURNING * INTO instance;
  affected:=jsonb_build_object(
    'rowKeys',(SELECT coalesce(jsonb_agg(row_key ORDER BY row_key),'[]'::jsonb) FROM (SELECT DISTINCT item->>'rowKey' row_key FROM jsonb_array_elements(p_cells) item) affected_rows),
    'fieldIds',(SELECT coalesce(jsonb_agg(field_id ORDER BY field_id),'[]'::jsonb) FROM (SELECT DISTINCT unnest(seen_fields||ARRAY(SELECT item->>'fieldId' FROM jsonb_array_elements(p_cells) item)) field_id) affected_fields),
    'cells',to_jsonb(seen_cells)
  );
  INSERT INTO api.sheet_instance_local_mutations(workspace_id,instance_id,retry_token,request_digest,result_revision,result,actor_user_id,operation,affected) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,instance.revision,to_jsonb(instance),actor,'local_mutation',affected);
  RETURN instance;
END $$;

REVOKE EXECUTE ON FUNCTION internal.sheet_row_identity_array_text(jsonb),internal.sheet_row_identity_key(jsonb,jsonb),internal.sheet_local_cell_error(uuid,jsonb,jsonb),internal.validate_sheet_instance_state_core037(jsonb),internal.validate_sheet_instance_state(jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
