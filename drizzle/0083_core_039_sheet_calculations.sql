-- CORE-03.9: revision-bound calculations over governed composition and
-- Instance-local values. HyperFormula execution remains in the trusted Node
-- worker; this migration owns durable definitions, CAS finalisation and read.

ALTER TABLE api.sheet_instance_calculation_mutations ENABLE ROW LEVEL SECURITY;
CREATE POLICY sheet_instance_calculation_mutations_read ON api.sheet_instance_calculation_mutations
  FOR SELECT TO authenticated USING (
    workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)
  );
REVOKE ALL ON api.sheet_instance_calculation_mutations FROM PUBLIC,authenticated,api_client;
GRANT SELECT ON api.sheet_instance_calculation_mutations TO authenticated;
REVOKE ALL ON internal.sheet_instance_calculation_results FROM PUBLIC,authenticated,api_client,formula_writer;

CREATE FUNCTION internal.validate_sheet_instance_calculation(p_calculation jsonb,p_path text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
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
     OR p_calculation->'outputField'->>'logicalType' NOT IN ('integer','decimal')
     OR p_calculation->'outputField'->>'cardinality'<>'one'
  THEN RAISE EXCEPTION 'calculation output must preserve scalar numeric FieldDefinition semantics' USING ERRCODE='SB083'; END IF;
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
END $$;

ALTER FUNCTION internal.validate_sheet_instance_state(jsonb) RENAME TO validate_sheet_instance_state_core038;
CREATE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE calculation jsonb; ids text[]:='{}'; keys text[]:='{}'; dependency jsonb;
BEGIN
  PERFORM internal.validate_sheet_instance_state_core038(p_state-'instanceCalculations');
  IF p_state ? 'instanceCalculations' THEN
    IF jsonb_typeof(p_state->'instanceCalculations')<>'array' OR jsonb_array_length(p_state->'instanceCalculations')>128 THEN RAISE EXCEPTION 'invalid Instance calculations' USING ERRCODE='SB083'; END IF;
    FOR calculation IN SELECT value FROM jsonb_array_elements(p_state->'instanceCalculations') LOOP
      PERFORM internal.validate_sheet_instance_calculation(calculation,'instanceCalculations');
      IF calculation->>'id'=ANY(ids) OR calculation->>'key'=ANY(keys) THEN RAISE EXCEPTION 'duplicate Instance calculation identity' USING ERRCODE='SB083'; END IF;
      ids:=array_append(ids,calculation->>'id'); keys:=array_append(keys,calculation->>'key');
      FOR dependency IN SELECT value FROM jsonb_array_elements(calculation->'dependencies') LOOP
        IF dependency->>'kind'='local-field' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'localFields') field WHERE field->>'fieldId'=dependency->>'id') THEN RAISE EXCEPTION 'unknown local-field calculation dependency' USING ERRCODE='SB083'; END IF;
      END LOOP;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION internal.validate_sheet_instance_calculation_dependencies(p_source_definition_version_id uuid,p_state jsonb)
RETURNS void LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE config jsonb; calculation jsonb; dependency jsonb; active_instance_ids text[]:='{}'; definition_ids text[]:='{}';
BEGIN
  IF p_source_definition_version_id IS NOT NULL THEN
    SELECT configuration INTO config FROM api.sheet_definition_versions WHERE id=p_source_definition_version_id;
    SELECT coalesce(array_agg(value->>'id'),'{}') INTO definition_ids FROM jsonb_array_elements(config->'calculations');
  END IF;
  SELECT coalesce(array_agg(value->>'id'),'{}') INTO active_instance_ids
    FROM jsonb_array_elements(coalesce(p_state->'instanceCalculations','[]'::jsonb))
    WHERE value->>'lifecycle'='active';
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(coalesce(p_state->'instanceCalculations','[]'::jsonb)) item
    WHERE item->>'id'=ANY(definition_ids)
  ) THEN RAISE EXCEPTION 'Instance calculation identity collides with its pinned Definition' USING ERRCODE='SB083'; END IF;
  FOR calculation IN SELECT value FROM jsonb_array_elements(coalesce(p_state->'instanceCalculations','[]'::jsonb)) WHERE value->>'lifecycle'='active' LOOP
    FOR dependency IN SELECT value FROM jsonb_array_elements(calculation->'dependencies') LOOP
      IF dependency->>'kind'='local-field' THEN
        IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_state->'localFields') field WHERE field->>'fieldId'=dependency->>'id') THEN RAISE EXCEPTION 'unknown local-field calculation dependency' USING ERRCODE='SB083'; END IF;
      ELSIF dependency->>'kind'='column' THEN
        IF config IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(config->'columns') column_item WHERE column_item->>'id'=dependency->>'id') THEN RAISE EXCEPTION 'unknown or ad-hoc Definition column dependency' USING ERRCODE='SB083'; END IF;
      ELSIF dependency->>'kind'='calculation' AND dependency->>'id'<>ALL(active_instance_ids) AND dependency->>'id'<>ALL(definition_ids) THEN
        RAISE EXCEPTION 'unknown Instance or Definition calculation dependency' USING ERRCODE='SB083';
      END IF;
    END LOOP;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_instance_from_definition(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb,p_parameter_inputs jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); resolved jsonb; identity_kind text;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
  IF jsonb_array_length(coalesce(p_state->'instanceCalculations','[]'::jsonb))<>0 THEN RAISE EXCEPTION 'initial calculation definitions require the controlled calculation mutation RPC' USING ERRCODE='SB083'; END IF;
  resolved:=internal.resolve_sheet_parameters(p_workspace_id,p_source_definition_version_id,p_parameter_inputs);
  SELECT configuration->'rowIdentity'->>'kind' INTO identity_kind FROM api.sheet_definition_versions WHERE id=p_source_definition_version_id;
  p_state:=(p_state-'bindings'-'parameterValues'-'provenance'-'resolutionProvenance'-'resolvedRowIdentity'-'instanceCalculations')||resolved||jsonb_build_object('provenance',jsonb_build_object('createdFrom','definition_version'));
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
 INSERT INTO api.sheet_instances(workspace_id,name,description,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result; RETURN result;
END $$;

-- Generic state updates may still change presentation and bounded Definition
-- overrides, but calculation definitions use the controlled audited path.
CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' OR result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
 IF p_state->'localFields' IS DISTINCT FROM result.state->'localFields' OR p_state->'localValues' IS DISTINCT FROM result.state->'localValues' THEN RAISE EXCEPTION 'local fields and values require the controlled local mutation RPC' USING ERRCODE='SB073'; END IF;
 IF coalesce(p_state->'instanceCalculations','[]'::jsonb) IS DISTINCT FROM coalesce(result.state->'instanceCalculations','[]'::jsonb) THEN RAISE EXCEPTION 'calculation definitions require the controlled calculation mutation RPC' USING ERRCODE='SB083'; END IF;
 p_state:=jsonb_set(jsonb_set(jsonb_set(p_state,'{provenance}',result.state->'provenance',true),'{localFields}',result.state->'localFields',true),'{localValues}',result.state->'localValues',true);
 IF result.state ? 'instanceCalculations' THEN p_state:=jsonb_set(p_state,'{instanceCalculations}',result.state->'instanceCalculations',true); ELSE p_state:=p_state-'instanceCalculations'; END IF;
 IF result.source_definition_version_id IS NOT NULL THEN p_state:=(p_state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',result.state->'bindings','parameterValues',coalesce(result.state->'parameterValues','[]'::jsonb),'resolutionProvenance',result.state->'resolutionProvenance','resolvedRowIdentity',result.state->'resolvedRowIdentity'); ELSE SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb)); p_state:=(p_state-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity')||jsonb_build_object('bindings',stripped_bindings); END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;

CREATE FUNCTION api.mutate_sheet_instance_calculations(p_instance_id uuid,p_expected_revision bigint,p_retry_token uuid,p_changes jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; prior api.sheet_instance_calculation_mutations; actor text:=api.current_user_id(); digest text;
  change jsonb; calculation jsonb; old_calculation jsonb; calculations jsonb; calculation_id text; seen text[]:='{}';
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR actor IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  digest:=encode(sha256(convert_to(jsonb_build_object('instanceId',p_instance_id,'expectedRevision',p_expected_revision,'changes',p_changes)::text,'UTF8')),'hex');
  SELECT * INTO prior FROM api.sheet_instance_calculation_mutations WHERE instance_id=p_instance_id AND retry_token=p_retry_token;
  IF prior.id IS NOT NULL THEN IF prior.request_digest<>digest OR prior.actor_user_id<>actor THEN RAISE EXCEPTION 'retry token was used for a different calculation mutation' USING ERRCODE='23505'; END IF; RETURN jsonb_populate_record(NULL::api.sheet_instances,prior.result); END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF p_retry_token IS NULL OR jsonb_typeof(p_changes)<>'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 32 THEN RAISE EXCEPTION 'calculation mutation requires a retry token and bounded non-empty changes' USING ERRCODE='22023'; END IF;
  calculations:=coalesce(instance.state->'instanceCalculations','[]'::jsonb);
  FOR change IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    IF change->>'operation' NOT IN ('add','edit','retire') OR change-(CASE WHEN change->>'operation'='retire' THEN ARRAY['operation','calculationId'] ELSE ARRAY['operation','calculation'] END)<>'{}'::jsonb THEN RAISE EXCEPTION 'invalid calculation change' USING ERRCODE='22023'; END IF;
    calculation:=change->'calculation'; calculation_id:=coalesce(calculation->>'id',change->>'calculationId'); PERFORM internal.sheet_definition_uuid(calculation_id,'calculation change');
    IF calculation_id=ANY(seen) THEN RAISE EXCEPTION 'duplicate calculation change' USING ERRCODE='22023'; END IF; seen:=array_append(seen,calculation_id);
    SELECT value INTO old_calculation FROM jsonb_array_elements(calculations) WHERE value->>'id'=calculation_id;
    IF change->>'operation'='add' THEN
      PERFORM internal.validate_sheet_instance_calculation(calculation,'calculation add');
      IF old_calculation IS NOT NULL OR calculation->>'lifecycle'<>'active' THEN RAISE EXCEPTION 'calculation add requires a new active identity' USING ERRCODE='SB083'; END IF;
      calculations:=calculations||jsonb_build_array(calculation);
    ELSIF old_calculation IS NULL OR old_calculation->>'lifecycle'<>'active' THEN RAISE EXCEPTION 'unknown or retired calculation' USING ERRCODE='SB083';
    ELSIF change->>'operation'='retire' THEN
      calculations:=(SELECT jsonb_agg(CASE WHEN value->>'id'=calculation_id THEN jsonb_set(value,'{lifecycle}','"retired"') ELSE value END ORDER BY ordinality) FROM jsonb_array_elements(calculations) WITH ORDINALITY);
    ELSE
      PERFORM internal.validate_sheet_instance_calculation(calculation,'calculation edit');
      IF calculation->>'id'<>calculation_id OR calculation->>'lifecycle'<>'active' OR calculation->'outputField'->'quantity' IS DISTINCT FROM old_calculation->'outputField'->'quantity' OR calculation->'outputField'->>'logicalType' IS DISTINCT FROM old_calculation->'outputField'->>'logicalType' THEN RAISE EXCEPTION 'calculation edit must preserve output semantic identity' USING ERRCODE='SB083'; END IF;
      calculations:=(SELECT jsonb_agg(CASE WHEN value->>'id'=calculation_id THEN calculation ELSE value END ORDER BY ordinality) FROM jsonb_array_elements(calculations) WITH ORDINALITY);
    END IF;
  END LOOP;
  instance.state:=jsonb_set(instance.state,'{instanceCalculations}',calculations,true); PERFORM internal.validate_sheet_instance_state(instance.state); PERFORM internal.validate_sheet_instance_calculation_dependencies(instance.source_definition_version_id,instance.state);
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances SET state=instance.state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance.id RETURNING * INTO instance;
  INSERT INTO api.sheet_instance_calculation_mutations(workspace_id,instance_id,retry_token,request_digest,operation,result_revision,result,actor_user_id) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,'definition_mutation',instance.revision,to_jsonb(instance),actor);
  RETURN instance;
END $$;

-- Called only by the pinned server worker through FORMULA_DATABASE_URL.
CREATE FUNCTION internal.apply_trusted_sheet_calculation(p_actor text,p_instance_id uuid,p_expected_revision bigint,p_retry_token uuid,p_results jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE instance api.sheet_instances; prior api.sheet_instance_calculation_mutations; digest text; item jsonb; config jsonb; authority jsonb; expected_expression jsonb; expected_dependencies jsonb; expected_output jsonb; expected_scope text; row_count integer; active_count integer;
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
    IF authority IS NOT NULL THEN expected_scope:='definition'; expected_dependencies:=(SELECT jsonb_agg(jsonb_build_object('kind','column','id',value)) FROM jsonb_array_elements(authority->'inputColumnIds')); expected_output:=(SELECT value->'field' FROM jsonb_array_elements(config->'columns') WHERE value->>'id'=authority->>'outputColumnId'); expected_expression:=coalesce(instance.state->'calculationOverrides'->(authority->>'id')->'expression',authority->'expression');
    ELSE SELECT value INTO authority FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) WHERE value->>'id'=item->>'calculationId' AND value->>'lifecycle'='active'; expected_scope:='instance'; expected_dependencies:=authority->'dependencies'; expected_output:=authority->'outputField'; expected_expression:=authority->'expression'; END IF;
    IF authority IS NULL OR item->>'scope'<>expected_scope OR item->'expression' IS DISTINCT FROM expected_expression OR item->'dependencies' IS DISTINCT FROM coalesce(expected_dependencies,'[]'::jsonb) OR item->'outputField' IS DISTINCT FROM expected_output OR jsonb_typeof(item->'sourceRevisions')<>'array' OR jsonb_typeof(item->'dependencyProvenance')<>'array' THEN RAISE EXCEPTION 'calculation result does not match authoritative definition' USING ERRCODE='SB083'; END IF;
    INSERT INTO internal.sheet_instance_calculation_results(instance_id,calculation_id,row_key,workspace_id,scope,definition_version_id,instance_revision,expression,dependencies,output_field,source_revisions,dependency_provenance,result_kind,value,error_code,diagnostic,engine_version,function_profile,calculated_at)
    VALUES(instance.id,(item->>'calculationId')::uuid,item->>'rowKey',instance.workspace_id,item->>'scope',CASE WHEN item->>'scope'='definition' THEN instance.source_definition_version_id ELSE NULL END,instance.revision,item->'expression',item->'dependencies',item->'outputField',item->'sourceRevisions',item->'dependencyProvenance',item->>'resultKind',item->'value',item->>'errorCode',item->>'diagnostic','3.3.0','scientific-core-v2',now())
    ON CONFLICT(instance_id,calculation_id,row_key) DO UPDATE SET workspace_id=excluded.workspace_id,scope=excluded.scope,definition_version_id=excluded.definition_version_id,instance_revision=excluded.instance_revision,expression=excluded.expression,dependencies=excluded.dependencies,output_field=excluded.output_field,source_revisions=excluded.source_revisions,dependency_provenance=excluded.dependency_provenance,result_kind=excluded.result_kind,value=excluded.value,error_code=excluded.error_code,diagnostic=excluded.diagnostic,calculated_at=excluded.calculated_at;
  END LOOP;
  authority:=jsonb_build_object('instanceId',instance.id,'revision',instance.revision,'rowCount',row_count,'calculationCount',active_count,'status','completed');
  INSERT INTO api.sheet_instance_calculation_mutations(workspace_id,instance_id,retry_token,request_digest,operation,result_revision,result,actor_user_id) VALUES(instance.workspace_id,instance.id,p_retry_token,digest,'recalculate',instance.revision,authority,p_actor);
  RETURN authority;
END $$;

CREATE FUNCTION internal.sheet_calculation_result_current(p_instance_revision bigint,p_result_revision bigint,p_source_revisions jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p_instance_revision=p_result_revision AND NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_source_revisions) source
    WHERE source->>'kind'='dataset-row' AND (source->>'matched')::boolean
      AND NOT EXISTS(
        SELECT 1 FROM api.dataset_rows dataset_row
        WHERE dataset_row.id=(source->>'rowId')::uuid
          AND dataset_row.dataset_id=(source->>'datasetId')::uuid
          AND dataset_row.revision=(source->>'revision')::bigint
      )
  )
$$;

CREATE FUNCTION api.read_sheet_instance_calculation_results(p_instance_id uuid,p_row_keys jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path='' AS $$
DECLARE instance api.sheet_instances;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_row_keys)<>'array' OR jsonb_array_length(p_row_keys)>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_row_keys) GROUP BY value HAVING count(*)>1) THEN RAISE EXCEPTION 'result read requires at most 200 unique semantic rows' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('instanceId',instance.id,'revision',instance.revision,'results',coalesce((SELECT jsonb_agg(jsonb_build_object('calculationId',r.calculation_id,'rowKey',r.row_key,'scope',r.scope,'definitionVersionId',r.definition_version_id,'calculationStatus',CASE WHEN internal.sheet_calculation_result_current(instance.revision,r.instance_revision,r.source_revisions) THEN 'current' ELSE 'stale' END,'calculatedValue',CASE WHEN internal.sheet_calculation_result_current(instance.revision,r.instance_revision,r.source_revisions) AND r.result_kind='value' THEN r.value ELSE NULL END,'resultKind',r.result_kind,'errorCode',r.error_code,'diagnostic',r.diagnostic,'expression',r.expression,'dependencies',r.dependencies,'outputField',r.output_field,'sourceRevisions',r.source_revisions,'dependencyProvenance',r.dependency_provenance,'calculatedAt',r.calculated_at,'permission',jsonb_build_object('editability','read-only')) ORDER BY r.row_key,r.calculation_id) FROM internal.sheet_instance_calculation_results r WHERE r.instance_id=instance.id AND r.row_key IN (SELECT value FROM jsonb_array_elements_text(p_row_keys))),'[]'::jsonb));
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_sheet_instance_calculation(jsonb,text),internal.validate_sheet_instance_state_core038(jsonb),internal.validate_sheet_instance_state(jsonb),internal.validate_sheet_instance_calculation_dependencies(uuid,jsonb),internal.apply_trusted_sheet_calculation(text,uuid,bigint,uuid,jsonb),internal.sheet_calculation_result_current(bigint,bigint,jsonb) FROM PUBLIC,authenticated,api_client,formula_writer;
GRANT EXECUTE ON FUNCTION internal.apply_trusted_sheet_calculation(text,uuid,bigint,uuid,jsonb) TO formula_writer;
REVOKE EXECUTE ON FUNCTION api.mutate_sheet_instance_calculations(uuid,bigint,uuid,jsonb),api.read_sheet_instance_calculation_results(uuid,jsonb) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.mutate_sheet_instance_calculations(uuid,bigint,uuid,jsonb),api.read_sheet_instance_calculation_results(uuid,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
