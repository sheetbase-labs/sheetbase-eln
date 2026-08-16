-- Ad-hoc Notebook Sheets have no resolved Dataset identity. Allow new local
-- UUID rows on those Instances, and seed a first text column so a new Sheet
-- is immediately editable.

DROP FUNCTION IF EXISTS internal.ad_hoc_sheet_instance_state();
CREATE FUNCTION internal.ad_hoc_sheet_instance_state()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  field_id uuid := gen_random_uuid();
BEGIN
  RETURN jsonb_build_object(
    'bindings', '[]'::jsonb,
    'localFields', jsonb_build_array(
      jsonb_build_object(
        'fieldId', field_id,
        'key', 'column_1',
        'label', 'Column 1',
        'description', NULL,
        'logicalType', 'text',
        'nullable', true,
        'defaultValue', NULL,
        'cardinality', 'one',
        'quantity', NULL,
        'validation', '{}'::jsonb,
        'category', NULL,
        'relationship', NULL,
        'computation', jsonb_build_object('mode', 'stored'),
        'lifecycle', 'active'
      )
    ),
    'localValues', '{}'::jsonb,
    'calculationOverrides', '{}'::jsonb,
    'presentation', jsonb_build_object(
      'columnOrder', jsonb_build_array(field_id),
      'hiddenColumnIds', '[]'::jsonb,
      'columnWidths', '{}'::jsonb,
      'frozenColumnCount', 0,
      'density', 'standard',
      'filters', '[]'::jsonb,
      'sorts', '[]'::jsonb
    ),
    'provenance', jsonb_build_object('createdFrom', 'ad_hoc')
  );
END
$$;

CREATE OR REPLACE FUNCTION api.mutate_sheet_instance_local_state(
  p_instance_id uuid,p_expected_revision bigint,p_retry_token uuid,
  p_field_changes jsonb,p_rows jsonb,p_cells jsonb
) RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; existing_mutation api.sheet_instance_local_mutations;
  actor text:=api.current_user_id(); digest text; change jsonb; row_item jsonb; cell jsonb;
  state jsonb; fields jsonb; old_field jsonb; new_field jsonb; field_id text; row_key text;
  value jsonb; effective jsonb; error_code text; seen_fields text[]:='{}'; seen_rows text[]:='{}';
  seen_cells text[]:='{}'; composition jsonb; result_row jsonb; affected jsonb;
  identity_kind text;
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
  UPDATE api.sheet_instances SET state=state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance.id RETURNING * INTO instance;
  affected:=jsonb_build_object(
    'rowKeys',(SELECT coalesce(jsonb_agg(row_key ORDER BY row_key),'[]'::jsonb) FROM (SELECT DISTINCT item->>'rowKey' row_key FROM jsonb_array_elements(p_cells) item) affected_rows),
    'fieldIds',(SELECT coalesce(jsonb_agg(field_id ORDER BY field_id),'[]'::jsonb) FROM (SELECT DISTINCT unnest(seen_fields||ARRAY(SELECT item->>'fieldId' FROM jsonb_array_elements(p_cells) item)) field_id) affected_fields),
    'cells',to_jsonb(seen_cells)
  );
  INSERT INTO api.sheet_instance_local_mutations(workspace_id,instance_id,retry_token,request_digest,result_revision,result,actor_user_id,operation,affected) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,instance.revision,to_jsonb(instance),actor,'local_mutation',affected);
  RETURN instance;
END $$;

REVOKE EXECUTE ON FUNCTION internal.ad_hoc_sheet_instance_state()
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION internal.ad_hoc_sheet_instance_state() TO authenticated;
REVOKE EXECUTE ON FUNCTION api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.mutate_sheet_instance_local_state(uuid,bigint,uuid,jsonb,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
