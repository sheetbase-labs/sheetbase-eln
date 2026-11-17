-- Sheet formulas can compare and decide. A calculation may read a scalar
-- parameter of its Definition (a pass threshold), produce text or a boolean
-- (Pass / Fail), and a template setting's default reaches the sheets it feeds.

CREATE OR REPLACE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE ids text[]; stripped jsonb; calculation jsonb; parameter_id jsonb; scalar_parameter_ids text[]; seen text[];
BEGIN
  stripped:=internal.sheet_document_without_presentation_queries(p_config);
  -- The calculation checks below know the columns a formula reads; the
  -- parameters it reads are checked here, so they are set aside first.
  IF jsonb_typeof(stripped->'calculations')='array' THEN
    stripped:=jsonb_set(stripped,'{calculations}',coalesce((
      SELECT jsonb_agg(CASE WHEN jsonb_typeof(item.value)='object' THEN item.value-'inputParameterIds' ELSE item.value END ORDER BY item.ordinality)
        FROM jsonb_array_elements(stripped->'calculations') WITH ORDINALITY item(value,ordinality)),'[]'::jsonb));
  END IF;
  PERFORM internal.validate_sheet_definition_configuration_core0311(stripped);
  SELECT coalesce(array_agg(value->>'id'),'{}') INTO scalar_parameter_ids
    FROM jsonb_array_elements(p_config->'parameters') WHERE value->'type'->>'kind'='scalar';
  FOR calculation IN SELECT value FROM jsonb_array_elements(p_config->'calculations') LOOP
    IF calculation ? 'inputParameterIds' THEN
      IF jsonb_typeof(calculation->'inputParameterIds')<>'array' OR jsonb_array_length(calculation->'inputParameterIds')>64
      THEN RAISE EXCEPTION 'invalid calculation parameter inputs' USING ERRCODE='SB071'; END IF;
      seen:='{}';
      FOR parameter_id IN SELECT value FROM jsonb_array_elements(calculation->'inputParameterIds') LOOP
        IF internal.sheet_definition_uuid(parameter_id#>>'{}','calculations.inputParameterIds')::text<>ALL(scalar_parameter_ids)
           OR (parameter_id#>>'{}')=ANY(seen)
        THEN RAISE EXCEPTION 'calculation reads an unknown, repeated or non-scalar parameter' USING ERRCODE='SB071'; END IF;
        seen:=array_append(seen,parameter_id#>>'{}');
      END LOOP;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_config->'columns')='array'
     AND jsonb_typeof(p_config->'presentation')='object' THEN
    SELECT array_agg(value->>'id') INTO ids FROM jsonb_array_elements(p_config->'columns') value;
    PERFORM internal.validate_sheet_presentation_queries(p_config->'presentation',ids,'SB071');
  END IF;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.apply_trusted_sheet_calculation(p_actor text, p_instance_id uuid, p_expected_revision bigint, p_retry_token uuid, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; prior api.sheet_instance_calculation_mutations; digest text; item jsonb; config jsonb; authority jsonb; expected_expression jsonb; expected_dependencies jsonb; expected_output jsonb; expected_scope text; row_count integer; active_count integer; audit_old jsonb; audit_new jsonb; audit_sources jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR p_actor IS NULL OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=instance.workspace_id AND user_id=p_actor) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_revision,'results',p_results)::text,'UTF8')),'hex');
  SELECT * INTO prior FROM api.sheet_instance_calculation_mutations WHERE instance_id=p_instance_id AND retry_token=p_retry_token;
  IF prior.id IS NOT NULL THEN IF prior.request_digest<>digest OR prior.actor_user_id<>p_actor THEN RAISE EXCEPTION 'retry token was used for a different recalculation' USING ERRCODE='23505'; END IF; RETURN prior.result; END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF p_retry_token IS NULL OR jsonb_typeof(p_results)<>'array' OR jsonb_array_length(p_results)>25600 THEN RAISE EXCEPTION 'invalid bounded calculation result batch' USING ERRCODE='22023'; END IF;
  SELECT configuration INTO config FROM api.sheet_definition_versions WHERE id=instance.source_definition_version_id;
  active_count:=coalesce((SELECT count(*) FROM jsonb_array_elements(coalesce(config->'calculations','[]'::jsonb)) calc WHERE coalesce(instance.state->'calculationOverrides'->(calc->>'id')->>'enabled','true')='true'),0)+coalesce((SELECT count(*) FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) calc WHERE calc->>'lifecycle'='active'),0);
  SELECT count(DISTINCT value->>'rowKey') INTO row_count FROM jsonb_array_elements(p_results);
  IF jsonb_array_length(p_results)<>row_count*active_count OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_results) GROUP BY value->>'rowKey',value->>'calculationId' HAVING count(*)>1) THEN RAISE EXCEPTION 'calculation batch must contain every active calculation exactly once per row' USING ERRCODE='SB083'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    IF jsonb_typeof(item)<>'object' OR item-ARRAY['calculationId','rowKey','scope','definitionVersionId','expression','dependencies','outputField','sourceRevisions','dependencyProvenance','resultKind','value','errorCode','diagnostic']<>'{}'::jsonb OR item->>'resultKind' NOT IN ('value','error') THEN RAISE EXCEPTION 'invalid trusted calculation result' USING ERRCODE='SB083'; END IF;
    SELECT value INTO authority FROM jsonb_array_elements(coalesce(config->'calculations','[]'::jsonb)) WHERE value->>'id'=item->>'calculationId';
    IF authority IS NOT NULL THEN expected_scope:='definition'; expected_dependencies:=coalesce((SELECT jsonb_agg(jsonb_build_object('kind','column','id',value)) FROM jsonb_array_elements(authority->'inputColumnIds')),'[]'::jsonb)||coalesce((SELECT jsonb_agg(jsonb_build_object('kind','parameter','id',value)) FROM jsonb_array_elements(coalesce(authority->'inputParameterIds','[]'::jsonb))),'[]'::jsonb); expected_output:=(SELECT value->'field' FROM jsonb_array_elements(config->'columns') WHERE value->>'id'=authority->>'outputColumnId'); expected_expression:=coalesce(instance.state->'calculationOverrides'->(authority->>'id')->'expression',authority->'expression');
    ELSE SELECT value INTO authority FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) WHERE value->>'id'=item->>'calculationId' AND value->>'lifecycle'='active'; expected_scope:='instance'; expected_dependencies:=authority->'dependencies'; expected_output:=authority->'outputField'; expected_expression:=authority->'expression'; END IF;
    IF authority IS NULL OR item->>'scope'<>expected_scope OR item->'expression' IS DISTINCT FROM expected_expression OR item->'dependencies' IS DISTINCT FROM coalesce(expected_dependencies,'[]'::jsonb) OR item->'outputField' IS DISTINCT FROM expected_output OR jsonb_typeof(item->'sourceRevisions')<>'array' OR jsonb_typeof(item->'dependencyProvenance')<>'array' THEN RAISE EXCEPTION 'calculation result does not match authoritative definition' USING ERRCODE='SB083'; END IF;
    
    IF NOT internal.sheet_calculation_result_current(instance.revision,instance.revision,item->'sourceRevisions') THEN
      RAISE EXCEPTION 'Sheet calculation source row revision changed' USING ERRCODE='SB001';
    END IF;
    SELECT coalesce(value,to_jsonb(error_code)) INTO audit_old FROM internal.sheet_instance_calculation_results
      WHERE instance_id=instance.id AND calculation_id=(item->>'calculationId')::uuid AND row_key=item->>'rowKey';
    audit_new:=CASE WHEN item->>'resultKind'='value' THEN item->'value' ELSE to_jsonb(item->>'errorCode') END;
    SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(e.id)),'[]'::jsonb) INTO audit_sources
      FROM jsonb_array_elements(item->'sourceRevisions') source JOIN api.change_events e
        ON e.workspace_id=instance.workspace_id AND e.entity_type='dataset'
        AND e.payload->>'datasetId'=source->>'datasetId' AND e.payload->>'rowId'=source->>'rowId'
        AND e.payload->'rowRevision'=source->'revision'
        AND e.record_id IS NOT DISTINCT FROM instance.notebook_record_id
      WHERE source->>'kind'='dataset-row' AND source->'matched'='true'::jsonb;
    IF audit_old IS DISTINCT FROM audit_new THEN
      PERFORM internal.emit_change_event_as_actor(p_actor,instance.workspace_id,'calculation',instance.id,'update',
        instance.notebook_record_id,instance.project_id,jsonb_build_object(
          'instanceId',instance.id,'name',instance.name,'rowKey',item->>'rowKey','effect','recalculated_cell',
          'sourceRevisions',item->'sourceRevisions','sourceEventIds',audit_sources,
          'sourceEventId',CASE WHEN jsonb_array_length(audit_sources)=1 THEN audit_sources->0 ELSE 'null'::jsonb END,
          'changes',jsonb_build_object(item->>'calculationId',jsonb_build_object(
            'label',item->'outputField'->>'label','from',audit_old,'to',audit_new))));
    END IF;
    INSERT INTO internal.sheet_instance_calculation_results(instance_id,calculation_id,row_key,workspace_id,scope,definition_version_id,instance_revision,expression,dependencies,output_field,source_revisions,dependency_provenance,result_kind,value,error_code,diagnostic,engine_version,function_profile,calculated_at)
    VALUES(instance.id,(item->>'calculationId')::uuid,item->>'rowKey',instance.workspace_id,item->>'scope',CASE WHEN item->>'scope'='definition' THEN instance.source_definition_version_id ELSE NULL END,instance.revision,item->'expression',item->'dependencies',item->'outputField',item->'sourceRevisions',item->'dependencyProvenance',item->>'resultKind',item->'value',item->>'errorCode',item->>'diagnostic','3.3.0','scientific-core-v2',now())
    ON CONFLICT(instance_id,calculation_id,row_key) DO UPDATE SET workspace_id=excluded.workspace_id,scope=excluded.scope,definition_version_id=excluded.definition_version_id,instance_revision=excluded.instance_revision,expression=excluded.expression,dependencies=excluded.dependencies,output_field=excluded.output_field,source_revisions=excluded.source_revisions,dependency_provenance=excluded.dependency_provenance,result_kind=excluded.result_kind,value=excluded.value,error_code=excluded.error_code,diagnostic=excluded.diagnostic,calculated_at=excluded.calculated_at;
  END LOOP;
  authority:=jsonb_build_object('instanceId',instance.id,'revision',instance.revision,'rowCount',row_count,'calculationCount',active_count,'status','completed');
  INSERT INTO api.sheet_instance_calculation_mutations(workspace_id,instance_id,retry_token,request_digest,operation,result_revision,result,actor_user_id) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,'recalculate',instance.revision,authority,p_actor);
  RETURN authority;
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.validate_sheet_instance_calculation(p_calculation jsonb, p_path text) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE dependency jsonb; dependency_ids text[]:='{}'; dependency_id text;
BEGIN
  PERFORM internal.assert_sheet_definition_object(p_calculation,
    ARRAY['id','key','label','lifecycle','outputField','dependencies','expression'],
    ARRAY['id','key','label','lifecycle','outputField','dependencies','expression'],p_path);
  PERFORM internal.sheet_definition_uuid(p_calculation->>'id',p_path||'.id');
  IF p_calculation->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
     OR length(btrim(p_calculation->>'label')) NOT BETWEEN 1 AND 200
     OR p_calculation->>'lifecycle' NOT IN ('active','retired')
     OR jsonb_typeof(p_calculation->'dependencies')<>'array'
     OR jsonb_array_length(p_calculation->'dependencies')>64
  THEN RAISE EXCEPTION 'invalid Instance calculation at %',p_path USING ERRCODE='SB083'; END IF;
  PERFORM internal.validate_sheet_field_definition(p_calculation->'outputField',p_path||'.outputField');
  IF p_calculation->'outputField'->>'fieldId'<>p_calculation->>'id'
     OR p_calculation->'outputField'->'computation'->>'mode'<>'computed'
     OR p_calculation->'outputField'->'computation'->>'expressionId'<>p_calculation->>'id'
     OR p_calculation->'outputField'->>'logicalType' NOT IN ('integer','decimal','text','boolean')
     OR p_calculation->'outputField'->>'cardinality'<>'one'
  THEN RAISE EXCEPTION 'calculation output must preserve scalar number, text or boolean FieldDefinition semantics' USING ERRCODE='SB083'; END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(p_calculation->'dependencies') LOOP
    PERFORM internal.assert_sheet_definition_object(dependency,ARRAY['kind','id'],ARRAY['kind','id'],p_path||'.dependencies');
    IF dependency->>'kind' NOT IN ('column','local-field','calculation') THEN RAISE EXCEPTION 'invalid semantic calculation dependency' USING ERRCODE='SB083'; END IF;
    PERFORM internal.sheet_definition_uuid(dependency->>'id',p_path||'.dependencies.id');
    dependency_id:=(dependency->>'id');
    IF dependency_id=ANY(dependency_ids) OR dependency_id=(p_calculation->>'id') THEN RAISE EXCEPTION 'duplicate or self calculation dependency' USING ERRCODE='SB083'; END IF;
    dependency_ids:=array_append(dependency_ids,dependency_id);
  END LOOP;
  PERFORM internal.assert_sheet_definition_object(p_calculation->'expression',ARRAY['language','source'],ARRAY['language','source'],p_path||'.expression');
  IF p_calculation->'expression'->>'language'<>'sheetbase-formula-v1'
     OR length(btrim(p_calculation->'expression'->>'source')) NOT BETWEEN 1 AND 8192
     OR left(btrim(p_calculation->'expression'->>'source'),1)<>'='
  THEN RAISE EXCEPTION 'invalid calculation expression' USING ERRCODE='SB083'; END IF;
END $_$;

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
  template_parameter jsonb;
  effective_inputs jsonb;
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

  -- A setting the person left alone keeps the default the Template gives it,
  -- so a sheet reads the Template's value (a pass threshold, say) and not only
  -- the Definition's own.
  effective_inputs := coalesce(p_parameter_inputs,'[]'::jsonb);
  FOR template_parameter IN SELECT value FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) value LOOP
    IF template_parameter->'type'->>'kind' = 'scalar'
       AND template_parameter ? 'defaultValue'
       AND jsonb_typeof(template_parameter->'defaultValue') IN ('string','number','boolean')
       AND NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(effective_inputs) input
          WHERE input->>'parameterId' = template_parameter->>'id'
       )
    THEN
      effective_inputs := effective_inputs || jsonb_build_array(jsonb_build_object(
        'parameterId', template_parameter->>'id',
        'kind', 'scalar',
        'value', template_parameter->'defaultValue'
      ));
    END IF;
  END LOOP;

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
      mapped := internal.template_parameter_inputs_for_placement(placement, effective_inputs);
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
