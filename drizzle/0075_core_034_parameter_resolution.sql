-- CORE-03.4 shared Parameter validation and server-authoritative binding resolution.
-- Compatibility is intentionally conservative: quantities and relationships
-- require exact semantic JSON equality and embedded category option identities
-- may only be preserved/supersetted. No unit conversion or vocabulary aliasing
-- is inferred here.

ALTER FUNCTION internal.validate_sheet_definition_configuration(jsonb)
  RENAME TO validate_sheet_definition_configuration_core032;

CREATE FUNCTION internal.scalar_parameter_satisfies(p_type text,p_value jsonb,p_constraints jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE text_value text;
BEGIN
  IF NOT internal.sheet_definition_scalar_matches(p_type,p_value) THEN RETURN false; END IF;
  text_value:=p_value#>>'{}';
  IF p_constraints?'allowedValues' AND NOT p_constraints->'allowedValues' @> jsonb_build_array(p_value) THEN RETURN false; END IF;
  IF p_constraints?'min' AND p_type IN ('integer','decimal') AND text_value::numeric<(p_constraints->>'min')::numeric THEN RETURN false; END IF;
  IF p_constraints?'max' AND p_type IN ('integer','decimal') AND text_value::numeric>(p_constraints->>'max')::numeric THEN RETURN false; END IF;
  IF p_constraints?'minLength' AND p_type='text' AND length(text_value)<(p_constraints->>'minLength')::integer THEN RETURN false; END IF;
  IF p_constraints?'maxLength' AND p_type='text' AND length(text_value)>(p_constraints->>'maxLength')::integer THEN RETURN false; END IF;
  IF p_constraints?'pattern' AND p_type='text' AND text_value !~ (p_constraints->>'pattern') THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE FUNCTION internal.validate_parameter(p_parameter jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE type_spec jsonb; contract jsonb; constraints jsonb; value_type text; item jsonb;
BEGIN
  PERFORM internal.assert_sheet_definition_object(
    p_parameter,ARRAY['id','key','label','required','type','constraints'],
    ARRAY['id','key','label','required','type','defaultValue','constraints'],'parameter');
  PERFORM internal.sheet_definition_uuid(p_parameter->>'id','parameter.id');
  IF p_parameter->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
     OR length(btrim(p_parameter->>'label')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_parameter->'required') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_parameter->'constraints') IS DISTINCT FROM 'object'
  THEN RAISE EXCEPTION 'invalid Parameter identity or metadata' USING ERRCODE='SB071'; END IF;
  type_spec:=p_parameter->'type'; constraints:=p_parameter->'constraints';
  IF jsonb_typeof(type_spec) IS DISTINCT FROM 'object' OR type_spec->>'kind' NOT IN ('scalar','record','dataset','dataset-version')
  THEN RAISE EXCEPTION 'invalid Parameter type' USING ERRCODE='SB071'; END IF;
  IF type_spec->>'kind'='scalar' THEN
    PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','valueType'],ARRAY['kind','valueType'],'parameter.type');
    value_type:=type_spec->>'valueType';
    IF value_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference')
    THEN RAISE EXCEPTION 'invalid scalar Parameter type' USING ERRCODE='SB071'; END IF;
    PERFORM internal.assert_sheet_definition_object(constraints,'{}',ARRAY['min','max','minLength','maxLength','pattern','allowedValues'],'parameter.constraints');
    IF (constraints?'min' AND NOT internal.sheet_definition_scalar_matches('decimal',constraints->'min')) OR (constraints?'max' AND NOT internal.sheet_definition_scalar_matches('decimal',constraints->'max'))
       OR (constraints?'minLength' AND (jsonb_typeof(constraints->'minLength')<>'number' OR (constraints->>'minLength')::numeric<>trunc((constraints->>'minLength')::numeric) OR (constraints->>'minLength')::numeric NOT BETWEEN 0 AND 100000))
       OR (constraints?'maxLength' AND (jsonb_typeof(constraints->'maxLength')<>'number' OR (constraints->>'maxLength')::numeric<>trunc((constraints->>'maxLength')::numeric) OR (constraints->>'maxLength')::numeric NOT BETWEEN 0 AND 100000))
       OR (constraints?'pattern' AND (jsonb_typeof(constraints->'pattern')<>'string' OR length(constraints->>'pattern')>1000))
       OR (constraints?'allowedValues' AND (jsonb_typeof(constraints->'allowedValues')<>'array' OR jsonb_array_length(constraints->'allowedValues')>256))
    THEN RAISE EXCEPTION 'invalid scalar Parameter constraints' USING ERRCODE='SB071'; END IF;
    IF value_type NOT IN ('integer','decimal') AND (constraints?'min' OR constraints?'max')
       OR value_type<>'text' AND (constraints?'minLength' OR constraints?'maxLength' OR constraints?'pattern')
    THEN RAISE EXCEPTION 'scalar Parameter constraint does not apply to its type' USING ERRCODE='SB071'; END IF;
    IF constraints?'min' AND constraints?'max' AND (constraints->>'min')::numeric>(constraints->>'max')::numeric
       OR constraints?'minLength' AND constraints?'maxLength' AND (constraints->>'minLength')::integer>(constraints->>'maxLength')::integer
    THEN RAISE EXCEPTION 'invalid scalar Parameter constraint bounds' USING ERRCODE='SB071'; END IF;
    IF constraints?'pattern' THEN
      BEGIN
        PERFORM '' ~ (constraints->>'pattern');
      EXCEPTION WHEN invalid_regular_expression THEN
        RAISE EXCEPTION 'invalid scalar Parameter regular expression' USING ERRCODE='SB071';
      END;
    END IF;
    IF p_parameter?'defaultValue' AND NOT internal.sheet_definition_scalar_matches(value_type,p_parameter->'defaultValue')
    THEN RAISE EXCEPTION 'scalar Parameter default does not match its type' USING ERRCODE='SB071'; END IF;
    IF constraints?'allowedValues' THEN
      FOR item IN SELECT value FROM jsonb_array_elements(constraints->'allowedValues') LOOP
        IF NOT internal.sheet_definition_scalar_matches(value_type,item) THEN RAISE EXCEPTION 'allowed scalar value does not match its type' USING ERRCODE='SB071'; END IF;
      END LOOP;
    END IF;
    IF p_parameter?'defaultValue' AND NOT internal.scalar_parameter_satisfies(value_type,p_parameter->'defaultValue',constraints)
    THEN RAISE EXCEPTION 'scalar Parameter default violates its constraints' USING ERRCODE='SB071'; END IF;
  ELSIF type_spec->>'kind'='record' THEN
    PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','modelKey'],ARRAY['kind','modelKey'],'parameter.type');
    IF type_spec->>'modelKey' !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'invalid Record Model contract' USING ERRCODE='SB071'; END IF;
    IF p_parameter?'defaultValue' OR constraints<>'{}'::jsonb THEN RAISE EXCEPTION 'object Parameters cannot have defaults or scalar constraints' USING ERRCODE='SB071'; END IF;
  ELSE
    PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','contract'],ARRAY['kind','contract'],'parameter.type');
    contract:=type_spec->'contract';
    IF contract->>'mode'='exact' THEN
      PERFORM internal.assert_sheet_definition_object(contract,ARRAY['mode','schemaVersionId'],ARRAY['mode','schemaVersionId'],'parameter.type.contract');
      PERFORM internal.sheet_definition_uuid(contract->>'schemaVersionId','parameter.type.contract.schemaVersionId');
    ELSIF contract->>'mode'='lineage' THEN
      PERFORM internal.assert_sheet_definition_object(contract,ARRAY['mode','baselineSchemaVersionId'],ARRAY['mode','baselineSchemaVersionId'],'parameter.type.contract');
      PERFORM internal.sheet_definition_uuid(contract->>'baselineSchemaVersionId','parameter.type.contract.baselineSchemaVersionId');
    ELSIF contract->>'mode'='semantic' THEN
      PERFORM internal.assert_sheet_definition_object(contract,ARRAY['mode','requiredFieldIds'],ARRAY['mode','baselineSchemaVersionId','requiredFieldIds'],'parameter.type.contract');
      IF contract?'baselineSchemaVersionId' THEN PERFORM internal.sheet_definition_uuid(contract->>'baselineSchemaVersionId','parameter.type.contract.baselineSchemaVersionId'); END IF;
      IF jsonb_typeof(contract->'requiredFieldIds')<>'array' OR jsonb_array_length(contract->'requiredFieldIds') NOT BETWEEN 1 AND 64
         OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(contract->'requiredFieldIds') x GROUP BY x HAVING count(*)>1)
      THEN RAISE EXCEPTION 'invalid semantic Dataset contract' USING ERRCODE='SB071'; END IF;
      FOR item IN SELECT value FROM jsonb_array_elements(contract->'requiredFieldIds') LOOP PERFORM internal.sheet_definition_uuid(item#>>'{}','parameter.type.contract.requiredFieldIds'); END LOOP;
    ELSE RAISE EXCEPTION 'invalid Dataset Parameter contract' USING ERRCODE='SB071'; END IF;
    IF p_parameter?'defaultValue' OR constraints<>'{}'::jsonb THEN RAISE EXCEPTION 'object Parameters cannot have defaults or scalar constraints' USING ERRCODE='SB071'; END IF;
  END IF;
END $$;

CREATE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE parameter_item jsonb; transformed jsonb; transformed_parameters jsonb; binding_id text; field_id text;
BEGIN
  IF jsonb_typeof(p_config->'parameters') IS DISTINCT FROM 'array' THEN
    PERFORM internal.validate_sheet_definition_configuration_core032(p_config);
    RETURN;
  END IF;
  FOR parameter_item IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
    PERFORM internal.validate_parameter(parameter_item);
  END LOOP;
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN element.value->'type'->'contract'->>'mode'='lineage' THEN
        jsonb_set(element.value,'{type,contract}',jsonb_build_object('mode','exact','schemaVersionId',element.value->'type'->'contract'->>'baselineSchemaVersionId'))
      WHEN element.value->'type'->'contract'->>'mode'='semantic' THEN
        jsonb_set(element.value,'{type,contract}',(element.value->'type'->'contract')-'baselineSchemaVersionId')
      ELSE element.value
    END), '[]'::jsonb) INTO transformed_parameters
  FROM jsonb_array_elements(p_config->'parameters') element;
  transformed:=jsonb_set(p_config,'{parameters}',transformed_parameters);
  PERFORM internal.validate_sheet_definition_configuration_core032(transformed);
  FOR parameter_item IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
    IF parameter_item->'type'->'contract'->>'mode'='semantic' AND NOT (parameter_item->'type'->'contract'?'baselineSchemaVersionId') THEN
      IF (SELECT count(*) FROM jsonb_array_elements(p_config->'bindings') binding WHERE binding->>'parameterId'=parameter_item->>'id')<>1
      THEN RAISE EXCEPTION 'baseline-free semantic contract requires exactly one binding' USING ERRCODE='SB071'; END IF;
      SELECT binding->>'id' INTO binding_id FROM jsonb_array_elements(p_config->'bindings') binding WHERE binding->>'parameterId'=parameter_item->>'id';
      FOR field_id IN SELECT value FROM jsonb_array_elements_text(parameter_item->'type'->'contract'->'requiredFieldIds') LOOP
        IF NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements(p_config->'columns') column_item
          WHERE column_item->'source'->>'kind'='bound'
            AND column_item->'source'->>'bindingId'=binding_id
            AND column_item->'source'->>'sourceFieldId'=field_id)
        THEN RAISE EXCEPTION 'baseline-free semantic field requires a bound column' USING ERRCODE='SB071'; END IF;
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION internal.category_semantics_compatible(p_baseline jsonb,p_candidate jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_baseline IS NULL OR p_candidate IS NULL THEN p_baseline IS NOT DISTINCT FROM p_candidate
    WHEN p_baseline->>'kind'<>p_candidate->>'kind' THEN false
    WHEN p_baseline->>'kind'='vocabulary' THEN p_baseline->>'vocabularyId'=p_candidate->>'vocabularyId'
    WHEN p_baseline->>'kind'='embedded' THEN NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(coalesce(p_baseline->'options','[]'::jsonb)) option
      WHERE option->>'lifecycle'='active'
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_candidate->'options','[]'::jsonb)) candidate
          WHERE candidate->>'id'=option->>'id' AND candidate->>'key'=option->>'key' AND candidate->>'lifecycle'='active'))
    ELSE false
  END
$$;

CREATE FUNCTION internal.dataset_field_semantics_compatible(p_baseline_version uuid,p_candidate_version uuid,p_field_id uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM api.dataset_schema_version_fields baseline
    JOIN api.dataset_schema_version_fields candidate ON candidate.schema_version_id=p_candidate_version AND candidate.field_id=baseline.field_id AND candidate.lifecycle='active'
    WHERE baseline.schema_version_id=p_baseline_version AND baseline.field_id=p_field_id AND baseline.lifecycle='active'
      AND candidate.logical_type=baseline.logical_type
      AND candidate.cardinality=baseline.cardinality
      AND candidate.quantity IS NOT DISTINCT FROM baseline.quantity
      AND internal.category_semantics_compatible(baseline.category,candidate.category)
      AND candidate.relationship IS NOT DISTINCT FROM baseline.relationship)
$$;

CREATE FUNCTION internal.dataset_field_matches_definition(p_candidate_version uuid,p_field_id uuid,p_expected jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM api.dataset_schema_version_fields candidate
    WHERE candidate.schema_version_id=p_candidate_version AND candidate.field_id=p_field_id AND candidate.lifecycle='active'
      AND candidate.logical_type=p_expected->>'logicalType'
      AND candidate.cardinality=p_expected->>'cardinality'
      AND candidate.quantity IS NOT DISTINCT FROM p_expected->'quantity'
      AND internal.category_semantics_compatible(p_expected->'category',candidate.category)
      AND candidate.relationship IS NOT DISTINCT FROM p_expected->'relationship')
$$;

CREATE FUNCTION internal.assert_dataset_parameter_compatible(
  p_contract jsonb,p_candidate_version uuid,p_configuration jsonb,p_binding_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE mode text:=p_contract->>'mode'; baseline uuid; baseline_schema uuid; candidate_schema uuid; candidate_workspace uuid; baseline_version integer; candidate_version integer; required_ids jsonb:='[]'::jsonb; field_id_text text; expected jsonb;
BEGIN
  SELECT v.schema_id,d.workspace_id,v.version INTO candidate_schema,candidate_workspace,candidate_version
  FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions d ON d.id=v.schema_id
  WHERE v.id=p_candidate_version AND v.lifecycle IN ('active','retired');
  IF candidate_schema IS NULL THEN RAISE EXCEPTION 'candidate Dataset Schema Version does not exist' USING ERRCODE='SB074'; END IF;
  IF mode='exact' THEN
    baseline:=(p_contract->>'schemaVersionId')::uuid;
    IF p_candidate_version<>baseline THEN RAISE EXCEPTION 'Dataset requires the exact Schema Version' USING ERRCODE='SB074'; END IF;
  ELSIF mode='lineage' THEN
    baseline:=(p_contract->>'baselineSchemaVersionId')::uuid;
    SELECT v.schema_id,v.version INTO baseline_schema,baseline_version FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions d ON d.id=v.schema_id WHERE v.id=baseline AND v.lifecycle IN ('active','retired') AND d.workspace_id=candidate_workspace;
    IF baseline_schema IS NULL OR candidate_schema<>baseline_schema OR candidate_version<baseline_version THEN RAISE EXCEPTION 'Dataset is outside the compatible Schema lineage' USING ERRCODE='SB074'; END IF;
    SELECT coalesce(jsonb_agg(field_id ORDER BY display_order),'[]'::jsonb) INTO required_ids FROM api.dataset_schema_version_fields WHERE schema_version_id=baseline AND lifecycle='active';
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(required_ids) id WHERE NOT internal.dataset_field_semantics_compatible(baseline,p_candidate_version,id::uuid))
    THEN RAISE EXCEPTION 'Dataset lineage broke required field semantics' USING ERRCODE='SB074'; END IF;
  ELSE
    required_ids:=p_contract->'requiredFieldIds';
    IF p_contract?'baselineSchemaVersionId' THEN
      baseline:=(p_contract->>'baselineSchemaVersionId')::uuid;
      IF NOT EXISTS(SELECT 1 FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions d ON d.id=v.schema_id WHERE v.id=baseline AND v.lifecycle IN ('active','retired') AND d.workspace_id=candidate_workspace) THEN RAISE EXCEPTION 'semantic baseline must be an immutable Schema Version in this workspace' USING ERRCODE='SB074'; END IF;
    END IF;
    FOR field_id_text IN SELECT value FROM jsonb_array_elements_text(required_ids) LOOP
      IF baseline IS NOT NULL THEN
        IF NOT internal.dataset_field_semantics_compatible(baseline,p_candidate_version,field_id_text::uuid) THEN RAISE EXCEPTION 'Dataset does not satisfy required semantic field contract' USING ERRCODE='SB074'; END IF;
      ELSE
        SELECT column_item->'field' INTO expected FROM jsonb_array_elements(p_configuration->'columns') column_item
        WHERE column_item->'source'->>'kind'='bound' AND column_item->'source'->>'bindingId'=p_binding_id::text AND column_item->'source'->>'sourceFieldId'=field_id_text LIMIT 1;
        IF expected IS NULL OR NOT internal.dataset_field_matches_definition(p_candidate_version,field_id_text::uuid,expected)
        THEN RAISE EXCEPTION 'Dataset does not satisfy required semantic field contract' USING ERRCODE='SB074'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('compatibilityMode',mode,'candidateSchemaVersionId',p_candidate_version,'baselineSchemaVersionId',baseline,'requiredFieldIds',required_ids);
END $$;

ALTER FUNCTION internal.validate_sheet_instance_state(jsonb)
  RENAME TO validate_sheet_instance_state_core033;

CREATE FUNCTION internal.validate_sheet_instance_state(p_state jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE legacy jsonb; stripped_bindings jsonb; item jsonb; nested jsonb; ids text[]:='{}'; provenance jsonb; field_id text; uuid_key text;
BEGIN
  SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb));
  legacy:=(p_state-'parameterValues'-'resolutionProvenance')||jsonb_build_object('bindings',stripped_bindings);
  PERFORM internal.validate_sheet_instance_state_core033(legacy);
  IF p_state?'parameterValues' THEN
    IF jsonb_typeof(p_state->'parameterValues')<>'array' OR jsonb_array_length(p_state->'parameterValues')>64 THEN RAISE EXCEPTION 'invalid resolved scalar values' USING ERRCODE='SB073'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_state->'parameterValues') LOOP
      PERFORM internal.assert_sheet_definition_object(item,ARRAY['parameterId','kind','valueType','value','source'],ARRAY['parameterId','kind','valueType','value','source'],'parameterValues');
      IF item->>'kind'<>'scalar' OR item->>'source' NOT IN ('supplied','default') OR NOT internal.sheet_definition_scalar_matches(item->>'valueType',item->'value') THEN RAISE EXCEPTION 'invalid resolved scalar value' USING ERRCODE='SB073'; END IF;
      IF item->>'parameterId'=ANY(ids) THEN RAISE EXCEPTION 'duplicate resolved scalar parameter' USING ERRCODE='SB073'; END IF; ids:=array_append(ids,item->>'parameterId');
    END LOOP;
  END IF;
  IF p_state?'resolutionProvenance' THEN
    BEGIN
    provenance:=p_state->'resolutionProvenance';
    PERFORM internal.assert_sheet_definition_object(provenance,ARRAY['sourceDefinitionVersionId','resolvedAt','resolvedByUserId','parameters'],ARRAY['sourceDefinitionVersionId','resolvedAt','resolvedByUserId','parameters'],'resolutionProvenance');
    IF jsonb_typeof(provenance->'sourceDefinitionVersionId')<>'string' OR jsonb_typeof(provenance->'resolvedAt')<>'string' OR jsonb_typeof(provenance->'resolvedByUserId')<>'string'
    THEN RAISE EXCEPTION 'invalid resolution provenance metadata types' USING ERRCODE='SB073'; END IF;
    PERFORM internal.sheet_definition_uuid(provenance->>'sourceDefinitionVersionId','resolutionProvenance.sourceDefinitionVersionId');
    IF NOT internal.sheet_definition_timestamp_matches(provenance->>'resolvedAt') OR length(provenance->>'resolvedByUserId') NOT BETWEEN 1 AND 1000 OR jsonb_typeof(provenance->'parameters')<>'array' OR jsonb_array_length(provenance->'parameters')>64
    THEN RAISE EXCEPTION 'invalid resolution provenance' USING ERRCODE='SB073'; END IF;
    FOR nested IN SELECT value FROM jsonb_array_elements(provenance->'parameters') LOOP
      PERFORM internal.assert_sheet_definition_object(
        nested,
        ARRAY['parameterId','bindingId','kind','compatibilityMode','datasetId','datasetVersionId','candidateSchemaVersionId','baselineSchemaVersionId','requiredFieldIds'],
        ARRAY['parameterId','bindingId','kind','compatibilityMode','datasetId','datasetVersionId','candidateSchemaVersionId','baselineSchemaVersionId','requiredFieldIds'],
        'resolutionProvenance.parameters');
      IF jsonb_typeof(nested->'parameterId')<>'string' OR jsonb_typeof(nested->'kind')<>'string' OR nested->>'kind' NOT IN ('scalar','record','dataset','dataset-version')
         OR jsonb_typeof(nested->'bindingId') NOT IN ('string','null')
         OR jsonb_typeof(nested->'compatibilityMode') NOT IN ('string','null')
         OR (jsonb_typeof(nested->'compatibilityMode')='string' AND nested->>'compatibilityMode' NOT IN ('exact','lineage','semantic'))
         OR jsonb_typeof(nested->'datasetId') NOT IN ('string','null')
         OR jsonb_typeof(nested->'datasetVersionId') NOT IN ('string','null')
         OR jsonb_typeof(nested->'candidateSchemaVersionId') NOT IN ('string','null')
         OR jsonb_typeof(nested->'baselineSchemaVersionId') NOT IN ('string','null')
         OR jsonb_typeof(nested->'requiredFieldIds')<>'array'
         OR jsonb_array_length(nested->'requiredFieldIds')>64
      THEN RAISE EXCEPTION 'invalid resolution provenance parameter shape' USING ERRCODE='SB073'; END IF;
      PERFORM internal.sheet_definition_uuid(nested->>'parameterId','resolutionProvenance.parameters.parameterId');
      FOREACH uuid_key IN ARRAY ARRAY['bindingId','datasetId','datasetVersionId','candidateSchemaVersionId','baselineSchemaVersionId'] LOOP
        IF jsonb_typeof(nested->uuid_key)='string' THEN
          PERFORM internal.sheet_definition_uuid(nested->>uuid_key,'resolutionProvenance.parameters.'||uuid_key);
        END IF;
      END LOOP;
      FOR field_id IN SELECT value FROM jsonb_array_elements_text(nested->'requiredFieldIds') LOOP
        PERFORM internal.sheet_definition_uuid(field_id,'resolutionProvenance.parameters.requiredFieldIds');
      END LOOP;
    END LOOP;
    EXCEPTION WHEN SQLSTATE 'SB071' THEN
      RAISE EXCEPTION 'invalid nested resolution provenance' USING ERRCODE='SB073';
    END;
  END IF;
END $$;

CREATE FUNCTION internal.resolve_sheet_parameters(p_workspace_id uuid,p_definition_version_id uuid,p_inputs jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE config jsonb; parameter jsonb; supplied jsonb; type_spec jsonb; contract jsonb; binding_spec jsonb; candidate_dataset api.datasets; candidate_version api.dataset_versions; candidate_schema_version uuid; resolution jsonb; bindings jsonb:='[]'::jsonb; values_json jsonb:='[]'::jsonb; provenance_items jsonb:='[]'::jsonb; scalar_value jsonb; scalar_source text; actor text:=api.current_user_id();
BEGIN
  SELECT v.configuration INTO config FROM api.sheet_definition_versions v JOIN api.sheet_definitions d ON d.id=v.definition_id
  WHERE v.id=p_definition_version_id AND v.lifecycle='published' AND d.workspace_id=p_workspace_id;
  IF config IS NULL THEN RAISE EXCEPTION 'source Definition Version must be published and in this workspace' USING ERRCODE='SB074'; END IF;
  IF jsonb_typeof(p_inputs)<>'array' OR jsonb_array_length(p_inputs)>64 THEN RAISE EXCEPTION 'parameter inputs must be a bounded array' USING ERRCODE='SB074'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) input GROUP BY input->>'parameterId' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate parameter input' USING ERRCODE='SB074'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_inputs) input WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(config->'parameters') p WHERE p->>'id'=input->>'parameterId')) THEN RAISE EXCEPTION 'unknown parameter input' USING ERRCODE='SB074'; END IF;

  FOR parameter IN SELECT value FROM jsonb_array_elements(config->'parameters') LOOP
    type_spec:=parameter->'type'; SELECT value INTO supplied FROM jsonb_array_elements(p_inputs) WHERE value->>'parameterId'=parameter->>'id';
    IF supplied IS NULL THEN
      IF type_spec->>'kind'='scalar' AND parameter?'defaultValue' THEN scalar_value:=parameter->'defaultValue'; scalar_source:='default';
      ELSIF (parameter->>'required')::boolean THEN RAISE EXCEPTION 'missing required parameter %',parameter->>'key' USING ERRCODE='SB074';
      ELSE CONTINUE; END IF;
    END IF;
    IF type_spec->>'kind'='scalar' THEN
      IF supplied IS NOT NULL THEN
        IF supplied->>'kind'<>'scalar' THEN RAISE EXCEPTION 'parameter input kind mismatch' USING ERRCODE='SB074'; END IF;
        PERFORM internal.assert_sheet_definition_object(supplied,ARRAY['parameterId','kind','value'],ARRAY['parameterId','kind','value'],'parameter input');
        scalar_value:=supplied->'value'; scalar_source:='supplied';
      END IF;
      IF NOT internal.scalar_parameter_satisfies(type_spec->>'valueType',scalar_value,parameter->'constraints') THEN RAISE EXCEPTION 'scalar parameter violates type or constraints' USING ERRCODE='SB074'; END IF;
      values_json:=values_json||jsonb_build_array(jsonb_build_object('parameterId',parameter->>'id','kind','scalar','valueType',type_spec->>'valueType','value',scalar_value,'source',scalar_source));
      provenance_items:=provenance_items||jsonb_build_array(jsonb_build_object('parameterId',parameter->>'id','bindingId',NULL,'kind','scalar','compatibilityMode',NULL,'datasetId',NULL,'datasetVersionId',NULL,'candidateSchemaVersionId',NULL,'baselineSchemaVersionId',NULL,'requiredFieldIds','[]'::jsonb));
      supplied:=NULL; CONTINUE;
    END IF;
    IF supplied IS NULL THEN CONTINUE; END IF;
    SELECT value INTO binding_spec FROM jsonb_array_elements(config->'bindings') WHERE value->>'parameterId'=parameter->>'id';
    IF binding_spec IS NULL OR (SELECT count(*) FROM jsonb_array_elements(config->'bindings') WHERE value->>'parameterId'=parameter->>'id')<>1 THEN RAISE EXCEPTION 'object parameter must have exactly one Definition binding' USING ERRCODE='SB074'; END IF;
    IF type_spec->>'kind'='record' THEN
      IF supplied->>'kind'<>'record' THEN RAISE EXCEPTION 'parameter input kind mismatch' USING ERRCODE='SB074'; END IF;
      PERFORM internal.assert_sheet_definition_object(supplied,ARRAY['parameterId','kind','recordId'],ARRAY['parameterId','kind','recordId'],'parameter input');
      IF NOT EXISTS(SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind AND m.identity_table='api.records' WHERE r.id=(supplied->>'recordId')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=type_spec->>'modelKey') THEN RAISE EXCEPTION 'Record does not satisfy Model/workspace/lifecycle contract' USING ERRCODE='SB074'; END IF;
      bindings:=bindings||jsonb_build_array(jsonb_build_object('bindingId',binding_spec->>'id','parameterId',parameter->>'id','kind','record','recordId',supplied->>'recordId','modelKey',type_spec->>'modelKey','policy','live'));
      provenance_items:=provenance_items||jsonb_build_array(jsonb_build_object('parameterId',parameter->>'id','bindingId',binding_spec->>'id','kind','record','compatibilityMode',NULL,'datasetId',NULL,'datasetVersionId',NULL,'candidateSchemaVersionId',NULL,'baselineSchemaVersionId',NULL,'requiredFieldIds','[]'::jsonb));
    ELSE
      contract:=type_spec->'contract';
      IF type_spec->>'kind'='dataset' THEN
        IF supplied->>'kind'<>'dataset' THEN RAISE EXCEPTION 'parameter input kind mismatch' USING ERRCODE='SB074'; END IF;
        PERFORM internal.assert_sheet_definition_object(supplied,ARRAY['parameterId','kind','datasetId'],ARRAY['parameterId','kind','datasetId'],'parameter input');
        SELECT * INTO candidate_dataset FROM api.datasets WHERE id=(supplied->>'datasetId')::uuid AND workspace_id=p_workspace_id AND lifecycle='active';
        IF candidate_dataset.id IS NULL THEN RAISE EXCEPTION 'live Dataset denied or inactive' USING ERRCODE='SB074'; END IF;
        candidate_schema_version:=candidate_dataset.schema_version_id;
        resolution:=internal.assert_dataset_parameter_compatible(contract,candidate_schema_version,config,(binding_spec->>'id')::uuid);
        bindings:=bindings||jsonb_build_array(jsonb_build_object('bindingId',binding_spec->>'id','parameterId',parameter->>'id','kind','dataset','datasetId',candidate_dataset.id,'policy',jsonb_build_object('mode','live'),'resolution',resolution));
        provenance_items:=provenance_items||jsonb_build_array(jsonb_build_object('parameterId',parameter->>'id','bindingId',binding_spec->>'id','kind','dataset','compatibilityMode',resolution->>'compatibilityMode','datasetId',candidate_dataset.id,'datasetVersionId',NULL,'candidateSchemaVersionId',candidate_schema_version,'baselineSchemaVersionId',resolution->'baselineSchemaVersionId','requiredFieldIds',resolution->'requiredFieldIds'));
      ELSE
        IF supplied->>'kind'<>'dataset-version' THEN RAISE EXCEPTION 'parameter input kind mismatch' USING ERRCODE='SB074'; END IF;
        PERFORM internal.assert_sheet_definition_object(supplied,ARRAY['parameterId','kind','datasetVersionId'],ARRAY['parameterId','kind','datasetVersionId'],'parameter input');
        SELECT * INTO candidate_version FROM api.dataset_versions WHERE id=(supplied->>'datasetVersionId')::uuid AND workspace_id=p_workspace_id;
        IF candidate_version.id IS NULL THEN RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE='SB074'; END IF;
        candidate_schema_version:=candidate_version.schema_version_id;
        resolution:=internal.assert_dataset_parameter_compatible(contract,candidate_schema_version,config,(binding_spec->>'id')::uuid);
        bindings:=bindings||jsonb_build_array(jsonb_build_object('bindingId',binding_spec->>'id','parameterId',parameter->>'id','kind','dataset','datasetId',candidate_version.dataset_id,'policy',jsonb_build_object('mode','version','datasetVersionId',candidate_version.id),'resolution',resolution));
        provenance_items:=provenance_items||jsonb_build_array(jsonb_build_object('parameterId',parameter->>'id','bindingId',binding_spec->>'id','kind','dataset-version','compatibilityMode',resolution->>'compatibilityMode','datasetId',candidate_version.dataset_id,'datasetVersionId',candidate_version.id,'candidateSchemaVersionId',candidate_schema_version,'baselineSchemaVersionId',resolution->'baselineSchemaVersionId','requiredFieldIds',resolution->'requiredFieldIds'));
      END IF;
    END IF;
    supplied:=NULL;
  END LOOP;
  RETURN jsonb_build_object('bindings',bindings,'parameterValues',values_json,'resolutionProvenance',jsonb_build_object('sourceDefinitionVersionId',p_definition_version_id,'resolvedAt',now(),'resolvedByUserId',actor,'parameters',provenance_items));
END $$;

CREATE FUNCTION api.create_sheet_instance_from_definition(p_workspace_id uuid,p_name text,p_description text,p_source_definition_version_id uuid,p_project_id uuid,p_notebook_record_id uuid,p_state jsonb,p_parameter_inputs jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); resolved jsonb;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR (p_description IS NOT NULL AND length(p_description)>2000) THEN RAISE EXCEPTION 'invalid Sheet Instance name or description' USING ERRCODE='SB073'; END IF;
  resolved:=internal.resolve_sheet_parameters(p_workspace_id,p_source_definition_version_id,p_parameter_inputs);
  p_state:=(p_state-'bindings'-'parameterValues'-'provenance'-'resolutionProvenance')||resolved||jsonb_build_object('provenance',jsonb_build_object('createdFrom','definition_version'));
  PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  INSERT INTO api.sheet_instances(workspace_id,name,description,source_definition_version_id,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id)
  VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_source_definition_version_id,p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result;
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
 p_state:=jsonb_set((p_state-'parameterValues'-'resolutionProvenance')||jsonb_build_object('bindings',stripped_bindings),'{provenance}',jsonb_build_object('createdFrom','ad_hoc'),true);
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 INSERT INTO api.sheet_instances(workspace_id,name,description,project_id,notebook_record_id,state,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),nullif(btrim(p_description),''),p_project_id,p_notebook_record_id,p_state,actor,actor) RETURNING * INTO result; RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_instance(p_instance_id uuid,p_expected_revision bigint,p_state jsonb)
RETURNS api.sheet_instances LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.sheet_instances; actor text:=api.current_user_id(); stripped_bindings jsonb;
BEGIN
 SELECT * INTO result FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE; IF result.id IS NULL OR NOT api.is_workspace_member(result.workspace_id) THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
 IF result.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE='SB073'; END IF; IF result.revision<>p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE='SB073'; END IF;
 p_state:=jsonb_set(p_state,'{provenance}',result.state->'provenance',true);
 IF result.source_definition_version_id IS NOT NULL THEN
   p_state:=(p_state-'bindings'-'parameterValues'-'resolutionProvenance')||jsonb_build_object('bindings',result.state->'bindings','parameterValues',coalesce(result.state->'parameterValues','[]'::jsonb),'resolutionProvenance',result.state->'resolutionProvenance');
 ELSE
   SELECT coalesce(jsonb_agg(value-'resolution'-'modelKey'),'[]'::jsonb) INTO stripped_bindings FROM jsonb_array_elements(coalesce(p_state->'bindings','[]'::jsonb));
   p_state:=(p_state-'parameterValues'-'resolutionProvenance')||jsonb_build_object('bindings',stripped_bindings);
 END IF;
 PERFORM internal.validate_sheet_instance_state(p_state); PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
 UPDATE api.sheet_instances SET state=p_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=result.id RETURNING * INTO result; RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION internal.validate_parameter(jsonb),internal.validate_sheet_definition_configuration_core032(jsonb),internal.validate_sheet_definition_configuration(jsonb),internal.category_semantics_compatible(jsonb,jsonb),internal.dataset_field_semantics_compatible(uuid,uuid,uuid),internal.dataset_field_matches_definition(uuid,uuid,jsonb),internal.assert_dataset_parameter_compatible(jsonb,uuid,jsonb,uuid),internal.scalar_parameter_satisfies(text,jsonb,jsonb),internal.validate_sheet_instance_state_core033(jsonb),internal.validate_sheet_instance_state(jsonb),internal.resolve_sheet_parameters(uuid,uuid,jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_sheet_instance_from_definition(uuid,text,text,uuid,uuid,uuid,jsonb,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
