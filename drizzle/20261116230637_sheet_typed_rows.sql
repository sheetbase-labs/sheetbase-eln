-- Sheets whose rows are typed in (a local row identity) show, edit and calculate
-- over their own rows, using the columns of the Definition they are pinned to.

CREATE OR REPLACE FUNCTION api.mutate_sheet_instance_local_state(p_instance_id uuid, p_expected_revision bigint, p_retry_token uuid, p_field_changes jsonb, p_rows jsonb, p_cells jsonb) RETURNS api.sheet_instances
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; existing_mutation api.sheet_instance_local_mutations;
  actor_user text:=api.current_user_id(); actor_credential uuid:=api.current_credential_id(); digest text; change jsonb; row_item jsonb; cell jsonb;
  state jsonb; fields jsonb; old_field jsonb; new_field jsonb; field_id text; row_key text;
  value jsonb; effective jsonb; error_code text; seen_fields text[]:='{}'; seen_rows text[]:='{}';
  seen_cells text[]:='{}'; composition jsonb; result_row jsonb; affected jsonb;
  identity_kind text;
BEGIN
 IF p_instance_id IS NOT NULL THEN PERFORM internal.assert_object_access('instance',p_instance_id,'edit'); END IF;
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
    SELECT item INTO new_field FROM jsonb_array_elements(fields) item WHERE item->>'fieldId'=field_id AND item->>'lifecycle'='active';
    IF new_field IS NULL AND instance.source_definition_version_id IS NOT NULL THEN
      -- A declared column of the pinned Definition holds typed-in cells too.
      SELECT c.value->'field' INTO new_field
        FROM api.sheet_definition_versions v
        CROSS JOIN LATERAL jsonb_array_elements(v.configuration->'columns') c(value)
       WHERE v.id=instance.source_definition_version_id
         AND (c.value->>'id'=field_id OR c.value->'field'->>'fieldId'=field_id)
         AND c.value->'source'->>'kind'='declared'
         AND c.value->'field'->>'lifecycle'='active'
         AND c.value->'field'->'computation'->>'mode'='stored';
    END IF;
    IF new_field IS NULL THEN RAISE EXCEPTION 'unknown or retired local field' USING ERRCODE='SB073'; END IF;
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
END $_$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_state_core038(p_state jsonb) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $_$
DECLARE row_key text; row_value jsonb; field_id text; field jsonb; value jsonb;
BEGIN
  PERFORM internal.validate_sheet_instance_state_core037(jsonb_set(p_state,'{localValues}','{}'::jsonb));
  FOR row_key,row_value IN SELECT * FROM jsonb_each(p_state->'localValues') LOOP
    IF row_key !~ '^sb-row-v1:[0-9a-f]{64}$' AND row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'invalid local row key' USING ERRCODE='SB073'; END IF;
    IF jsonb_typeof(row_value)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(row_value))>256 THEN RAISE EXCEPTION 'invalid local value row' USING ERRCODE='SB073'; END IF;
    FOR field_id,value IN SELECT * FROM jsonb_each(row_value) LOOP
      SELECT item INTO field FROM jsonb_array_elements(p_state->'localFields') item WHERE item->>'fieldId'=field_id;
      IF field IS NULL THEN
        -- Not a local field: a declared column of the pinned Definition. The
        -- write path checks it against the Definition; here only its shape.
        PERFORM internal.sheet_definition_uuid(field_id,'localValues field ID');
        IF jsonb_typeof(value) NOT IN ('string','number','boolean','null') OR (jsonb_typeof(value)='string' AND length(value#>>'{}')>100000) THEN RAISE EXCEPTION 'invalid or unknown local value' USING ERRCODE='SB073'; END IF;
      ELSIF internal.sheet_local_cell_error(NULL,field,value) IS NOT NULL AND field->>'logicalType'<>'reference' THEN RAISE EXCEPTION 'invalid or unknown local value' USING ERRCODE='SB073'; END IF;
    END LOOP;
  END LOOP;
END $_$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.query_sheet_instance_rows(p_instance_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; typed_instance api.sheet_instances;
BEGIN
 IF p_instance_id IS NOT NULL THEN PERFORM internal.assert_object_access('instance',p_instance_id,'view'); END IF;
  SELECT * INTO typed_instance FROM api.sheet_instances WHERE id=p_instance_id;
  IF typed_instance.id IS NOT NULL AND typed_instance.lifecycle='active' AND typed_instance.state->'resolvedRowIdentity'->>'kind'='local' THEN
    -- Typed-in rows: no source to compose. The rows are the Instance's own
    -- local rows, which the caller reads from its state.
    IF NOT api.is_workspace_member(typed_instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
    RETURN jsonb_build_object(
      'instanceId',typed_instance.id,'revision',typed_instance.revision,'offset',p_offset,'limit',p_limit,'hasMore',false,
      'identity',jsonb_build_object('kind','local','columnIds',typed_instance.state->'resolvedRowIdentity'->'columnIds','logicalTypes',typed_instance.state->'resolvedRowIdentity'->'logicalTypes'),
      'definitionVersionId',typed_instance.source_definition_version_id,
      'definitionConfiguration',(SELECT configuration FROM api.sheet_definition_versions WHERE id=typed_instance.source_definition_version_id AND lifecycle='published'),
      'localFieldIds',(SELECT coalesce(jsonb_agg(field_item->>'fieldId'),'[]'::jsonb) FROM jsonb_array_elements(typed_instance.state->'localFields') field_item WHERE field_item->>'lifecycle'='active'),
      'rows','[]'::jsonb);
  END IF;
  result:=api.query_sheet_instance_rows_core037(p_instance_id,p_limit,p_offset);
  RETURN result||jsonb_build_object(
    'localFieldIds',(
      SELECT coalesce(jsonb_agg(field_item->>'fieldId'),'[]'::jsonb)
      FROM api.sheet_instances instance_row
      CROSS JOIN LATERAL jsonb_array_elements(instance_row.state->'localFields') field_item
      WHERE instance_row.id=(result->>'instanceId')::uuid
        AND field_item->>'lifecycle'='active'
    ),
    'rows',(
    SELECT coalesce(jsonb_agg(row_item||jsonb_build_object('sources',(
      SELECT coalesce(jsonb_agg(source_item||CASE
        WHEN source_item->>'sourceKind'='dataset'
          THEN jsonb_build_object('datasetRevision',d.revision)
        WHEN source_item->>'sourceKind'='record'
          THEN jsonb_build_object(
            'metadataVersion',r.metadata_version,
            'fieldNames',(
              SELECT coalesce(jsonb_object_agg(
                column_item->'source'->>'sourceFieldId',field_definition.field_name
              ),'{}'::jsonb)
              FROM jsonb_array_elements(result->'definitionConfiguration'->'columns') column_item
              JOIN api.record_field_definitions field_definition
                ON field_definition.id=(column_item->'source'->>'sourceFieldId')::uuid
               AND field_definition.workspace_id=r.workspace_id
               AND field_definition.kind=r.kind
               AND field_definition.lifecycle='active'
              WHERE column_item->'source'->>'kind'='bound'
                AND column_item->'source'->>'bindingId'=source_item->>'bindingId'
            )
          )
        ELSE '{}'::jsonb END),'[]'::jsonb)
      FROM jsonb_array_elements(row_item->'sources') source_item
      LEFT JOIN api.datasets d ON d.id=(source_item->>'datasetId')::uuid
      LEFT JOIN api.records r ON r.id=(source_item->>'recordId')::uuid
    ))),'[]'::jsonb) FROM jsonb_array_elements(result->'rows') row_item));
END $function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.instantiate_notebook_template_version(p_version_id uuid, p_target_project_id uuid, p_title text, p_parameter_inputs jsonb, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  normalised jsonb;
  workspace uuid := api.current_workspace_id();
  actor text := api.current_user_id();
  version api.notebook_template_versions;
  template api.notebook_templates;
  project api.projects;
  existing api.notebook_template_instantiations;
  rec api.records;
  placement jsonb;
  instance api.sheet_instances;
  inserted jsonb;
  narrated jsonb;
  mapped jsonb;
  title text;
  result jsonb;
  composition jsonb := '[]'::jsonb;
  missing_keys text[];
  duplicate_input text;
  unknown_input text;
  entry jsonb;
BEGIN IF api.has_capability(api.current_workspace_id(), 'work.experiments') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.experiments' USING ERRCODE = '42501'; END IF; -- capability-guard
 IF p_target_project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project',p_target_project_id,'edit'); END IF;
  IF workspace IS NULL OR actor IS NULL OR NOT api.is_workspace_writer(workspace) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existing FROM api.notebook_template_instantiations
    WHERE workspace_id = workspace AND actor_user_id = actor AND idempotency_key = p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.template_version_id IS DISTINCT FROM p_version_id THEN
      RAISE EXCEPTION 'idempotency key was used for a different Template Version' USING ERRCODE = '23505';
    END IF;
    RETURN existing.result || jsonb_build_object('idempotent', true);
  END IF;

  SELECT v.* INTO version
    FROM api.notebook_template_versions v
    JOIN api.notebook_templates t ON t.id = v.template_id
    WHERE v.id = p_version_id AND t.workspace_id = workspace;
  IF version.id IS NULL OR version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'only a published Notebook Template Version can be instantiated' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = version.template_id;
  IF template.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'retired Notebook Template cannot be instantiated' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO project FROM api.projects WHERE id = p_target_project_id AND workspace_id = workspace;
  IF project.id IS NULL THEN
    RAISE EXCEPTION 'target project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  title := nullif(btrim(coalesce(p_title,'')), '');
  IF title IS NULL THEN title := template.name; END IF;
  IF p_parameter_inputs IS NOT NULL AND jsonb_typeof(p_parameter_inputs) <> 'array' THEN
    RAISE EXCEPTION 'Template parameter inputs must be an array' USING ERRCODE = 'SB091';
  END IF;
  -- Shape gate runs before duplicate/unknown/required checks: input->>'parameterId'
  -- yields SQL NULL for a missing key, an explicit JSON null, or a non-object
  -- entry, so without this gate NULL parameterIds evade both GROUP BY duplicate
  -- detection (INTO a NULL variable the IS NOT NULL guard misses) and the
  -- unknown-input NOT EXISTS check. Every entry must mirror the SheetParameterInput
  -- wire shape: an object with a string parameterId, a known kind, and the
  -- kind-appropriate payload (scalar values stay JSON scalars; reference kinds
  -- carry their UUID as text — deeper resolution stays downstream).
  FOR entry IN SELECT value FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object'
       OR jsonb_typeof(entry->'parameterId') IS DISTINCT FROM 'string'
       OR coalesce(entry->>'kind','') NOT IN ('scalar','record','dataset','dataset-version')
       OR (entry->>'kind' = 'scalar'
           AND (NOT (entry ? 'value')
                OR coalesce(jsonb_typeof(entry->'value'),'') NOT IN ('string','number','boolean','null')))
       OR (entry->>'kind' = 'record'
           AND jsonb_typeof(entry->'recordId') IS DISTINCT FROM 'string')
       OR (entry->>'kind' = 'dataset'
           AND jsonb_typeof(entry->'datasetId') IS DISTINCT FROM 'string')
       OR (entry->>'kind' = 'dataset-version'
           AND jsonb_typeof(entry->'datasetVersionId') IS DISTINCT FROM 'string')
    THEN
      RAISE EXCEPTION 'malformed Template parameter input' USING ERRCODE = 'SB091';
    END IF;
  END LOOP;
  SELECT input->>'parameterId' INTO duplicate_input
    FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
    GROUP BY input->>'parameterId'
    HAVING count(*) > 1
    LIMIT 1;
  IF duplicate_input IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate Template parameter input: %', duplicate_input USING ERRCODE = 'SB091';
  END IF;
  SELECT input->>'parameterId' INTO unknown_input
  -- NOTE: the outer input alias must not be named `value` here. An outer
  -- `value` alias correlated into the NOT EXISTS subquery silently matches
  -- nothing (every input reads as unknown), while the same shape with
  -- `input`/`parameter` behaves. Keep these aliases.
    FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
    WHERE NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) parameter
      WHERE parameter->>'id' = input->>'parameterId'
    )
    LIMIT 1;
  IF unknown_input IS NOT NULL THEN
    RAISE EXCEPTION 'unknown Template parameter input: %', unknown_input USING ERRCODE = 'SB091';
  END IF;
  SELECT coalesce(array_agg(parameter->>'key' ORDER BY parameter->>'key'), '{}') INTO missing_keys
    FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) parameter
    WHERE coalesce((parameter->>'required')::boolean, false)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
        WHERE input->>'parameterId' = parameter->>'id'
      );
  IF array_length(missing_keys, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'required Template parameter(s) not supplied: %', array_to_string(missing_keys, ', ')
      USING ERRCODE = 'SB091';
  END IF;

  rec := api.create_record(p_target_project_id, 'experiment', title, 'draft', '{}'::text[], '{}'::jsonb);
  UPDATE api.records
    SET source_notebook_template_version_id = version.id
    WHERE id = rec.id;

  FOR placement IN
    SELECT value FROM jsonb_array_elements(coalesce(version.configuration->'placements','[]'::jsonb)) value
    ORDER BY (value->>'order')::int, value->>'id'
  LOOP
    IF placement->>'kind' = 'narrative' THEN
      normalised := internal.template_block(placement->>'blockType', placement->'payload');
      narrated := api.insert_block(
        rec.id,
        normalised->>'type',
        normalised->'payload',
        1,
        NULL,
        NULL
      );
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', 'narrative',
        'blockType', normalised->>'type',
        'blockId', narrated->'block'->>'id'
      ));
    ELSIF placement->>'kind' = 'sheet' THEN
      mapped := internal.template_parameter_inputs_for_placement(placement, coalesce(p_parameter_inputs,'[]'::jsonb));
      instance := api.create_sheet_instance_from_definition(
        workspace,
        coalesce(nullif(btrim(placement->>'title'),''), 'Notebook sheet'),
        NULL,
        (placement->>'definitionVersionId')::uuid,
        rec.project_id,
        rec.id,
        internal.definition_derived_instance_state(),
        mapped
      );
      IF EXISTS (
        SELECT 1 FROM api.sheet_definition_versions v
         WHERE v.id = instance.source_definition_version_id
           AND v.configuration->'rowIdentity'->>'kind' = 'local'
      ) THEN
        -- Typed-in rows have no source to wait for: fix the row identity now.
        instance := api.resolve_sheet_instance_row_identity(instance.id, instance.revision);
      END IF;
      inserted := api.insert_sheet_instance_block(rec.id, NULL, NULL, instance.id);
      PERFORM internal.assign_sheet_block_template_placement(
        (inserted->'block'->>'id')::uuid,
        (placement->>'id')::uuid
      );
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', 'sheet',
        'definitionVersionId', placement->>'definitionVersionId',
        'instanceId', instance.id,
        'blockId', inserted->'block'->>'id'
      ));
    ELSE
      composition := composition || jsonb_build_array(jsonb_build_object(
        'placementId', placement->>'id',
        'kind', coalesce(placement->>'kind', 'section_placeholder')
      ));
    END IF;
  END LOOP;

  SELECT * INTO rec FROM api.records WHERE id = rec.id;
  result := jsonb_build_object(
    'record', to_jsonb(rec),
    'templateVersionId', version.id,
    'composition', composition,
    'idempotent', false
  );
  INSERT INTO api.notebook_template_instantiations(
    workspace_id, actor_user_id, idempotency_key, template_version_id, record_id, result
  ) VALUES (workspace, actor, p_idempotency_key, version.id, rec.id, result);
  RETURN result;
END
$function$;

