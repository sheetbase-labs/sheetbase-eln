-- CORE-03.2: controlled, versioned Sheet Definition configuration. Existing
-- scientific table/Notebook/Template/formula storage is intentionally untouched.

CREATE OR REPLACE FUNCTION internal.sheet_definition_uuid(p_value text, p_path text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p_value IS NULL OR p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'invalid Sheet Definition UUID at %',p_path USING ERRCODE='SB071';
  END IF;
  RETURN p_value::uuid;
END $$;

CREATE OR REPLACE FUNCTION internal.sheet_definition_scalar_matches(p_type text,p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE value_text text;
BEGIN
  IF p_value IS NULL THEN RETURN false; END IF;
  value_text:=p_value#>>'{}';
  IF p_type='text' THEN RETURN jsonb_typeof(p_value)='string';
  ELSIF p_type='integer' THEN
    RETURN jsonb_typeof(p_value)='number' AND value_text::numeric=trunc(value_text::numeric)
      AND value_text::numeric BETWEEN -9007199254740991 AND 9007199254740991;
  ELSIF p_type='decimal' THEN
    IF jsonb_typeof(p_value)<>'number' THEN RETURN false; END IF;
    PERFORM value_text::double precision; RETURN true;
  ELSIF p_type='boolean' THEN RETURN jsonb_typeof(p_value)='boolean';
  ELSIF p_type='date' THEN
    IF jsonb_typeof(p_value)<>'string' OR value_text !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN false; END IF;
    RETURN to_char(value_text::date,'YYYY-MM-DD')=value_text;
  ELSIF p_type='timestamp' THEN
    IF jsonb_typeof(p_value)<>'string' OR value_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' THEN RETURN false; END IF;
    PERFORM value_text::timestamptz; RETURN true;
  ELSIF p_type IN ('category','reference') THEN
    IF jsonb_typeof(p_value)<>'string' THEN RETURN false; END IF;
    PERFORM internal.sheet_definition_uuid(value_text,'scalar'); RETURN true;
  END IF;
  RETURN false;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION internal.assert_sheet_definition_object(
  p_value jsonb, p_required text[], p_allowed text[], p_path text
) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object'
     OR NOT p_value ?& p_required
     OR p_value - p_allowed <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid Sheet Definition object at %',p_path USING ERRCODE='SB071';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION internal.validate_sheet_field_definition(p_field jsonb, p_path text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE option jsonb; unit jsonb; ids text[]:='{}'; keys text[]:='{}'; units text[]:='{}'; target jsonb;
BEGIN
  PERFORM internal.assert_sheet_definition_object(p_field,
    ARRAY['fieldId','key','label','description','logicalType','nullable','defaultValue','cardinality','quantity','validation','category','relationship','computation','lifecycle'],
    ARRAY['fieldId','key','label','description','logicalType','nullable','defaultValue','cardinality','quantity','validation','category','relationship','computation','lifecycle'],p_path);
  PERFORM internal.sheet_definition_uuid(p_field->>'fieldId',p_path||'.fieldId');
  IF p_field->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR length(btrim(p_field->>'label')) NOT BETWEEN 1 AND 200
     OR p_field->>'logicalType' NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference')
     OR jsonb_typeof(p_field->'nullable')<>'boolean' OR p_field->>'cardinality' NOT IN ('one','many')
     OR p_field->>'lifecycle' NOT IN ('draft','backfilling','active','retired')
     OR (p_field->'description'<>'null'::jsonb AND (jsonb_typeof(p_field->'description')<>'string' OR length(p_field->>'description')>2000))
  THEN RAISE EXCEPTION 'invalid canonical FieldDefinition at %',p_path USING ERRCODE='SB071'; END IF;
  IF jsonb_typeof(p_field->'validation')<>'object' OR (p_field->'validation') - ARRAY['min','max','minLength','maxLength','pattern','extensions'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071';
  END IF;
  BEGIN
  IF (p_field->'validation' ? 'min' AND jsonb_typeof(p_field->'validation'->'min')<>'number')
     OR (p_field->'validation' ? 'max' AND jsonb_typeof(p_field->'validation'->'max')<>'number')
     OR (p_field->'validation' ? 'min' AND p_field->'validation' ? 'max' AND (p_field->'validation'->>'min')::numeric>(p_field->'validation'->>'max')::numeric)
     OR (p_field->'validation' ? 'minLength' AND (jsonb_typeof(p_field->'validation'->'minLength')<>'number' OR (p_field->'validation'->>'minLength')::numeric<>trunc((p_field->'validation'->>'minLength')::numeric) OR (p_field->'validation'->>'minLength')::numeric NOT BETWEEN 0 AND 100000))
     OR (p_field->'validation' ? 'maxLength' AND (jsonb_typeof(p_field->'validation'->'maxLength')<>'number' OR (p_field->'validation'->>'maxLength')::numeric<>trunc((p_field->'validation'->>'maxLength')::numeric) OR (p_field->'validation'->>'maxLength')::numeric NOT BETWEEN 0 AND 100000))
     OR (p_field->'validation' ? 'minLength' AND p_field->'validation' ? 'maxLength' AND (p_field->'validation'->>'minLength')::integer>(p_field->'validation'->>'maxLength')::integer)
     OR (p_field->'validation' ? 'pattern' AND (jsonb_typeof(p_field->'validation'->'pattern')<>'string' OR length(p_field->'validation'->>'pattern')>1000))
     OR (p_field->'validation' ? 'extensions' AND jsonb_typeof(p_field->'validation'->'extensions')<>'object')
  THEN RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071'; END IF;
  IF p_field->'validation' ? 'min' THEN PERFORM (p_field->'validation'->>'min')::double precision; END IF;
  IF p_field->'validation' ? 'max' THEN PERFORM (p_field->'validation'->>'max')::double precision; END IF;
  IF p_field->'validation' ? 'pattern' THEN PERFORM '' ~ (p_field->'validation'->>'pattern'); END IF;
  EXCEPTION WHEN invalid_regular_expression OR invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'invalid FieldDefinition validation at %',p_path USING ERRCODE='SB071';
  END;
  IF p_field->'quantity'<>'null'::jsonb THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'quantity',ARRAY['kind','dimension','storageUnit'],ARRAY['kind','dimension','storageUnit','allowedInputUnits','preferredDisplayUnit'],p_path||'.quantity');
    IF p_field->>'logicalType' NOT IN ('integer','decimal') OR length(btrim(p_field->'quantity'->>'kind')) NOT BETWEEN 1 AND 200
       OR length(btrim(p_field->'quantity'->>'dimension')) NOT BETWEEN 1 AND 200 OR length(btrim(p_field->'quantity'->>'storageUnit')) NOT BETWEEN 1 AND 200
       OR (p_field->'quantity' ? 'allowedInputUnits' AND (jsonb_typeof(p_field->'quantity'->'allowedInputUnits')<>'array' OR jsonb_array_length(p_field->'quantity'->'allowedInputUnits')>32))
       OR (p_field->'quantity' ? 'preferredDisplayUnit' AND (jsonb_typeof(p_field->'quantity'->'preferredDisplayUnit')<>'string' OR length(btrim(p_field->'quantity'->>'preferredDisplayUnit')) NOT BETWEEN 1 AND 200))
    THEN RAISE EXCEPTION 'invalid FieldDefinition quantity at %',p_path USING ERRCODE='SB071'; END IF;
    IF p_field->'quantity' ? 'allowedInputUnits' THEN
      FOR unit IN SELECT value FROM jsonb_array_elements(p_field->'quantity'->'allowedInputUnits') LOOP
        IF jsonb_typeof(unit)<>'string' OR length(btrim(unit#>>'{}')) NOT BETWEEN 1 AND 200 OR unit#>>'{}'=ANY(units) THEN RAISE EXCEPTION 'invalid or duplicate FieldDefinition input unit' USING ERRCODE='SB071'; END IF;
        units:=array_append(units,unit#>>'{}');
      END LOOP;
    END IF;
    IF p_field->'quantity' ? 'preferredDisplayUnit' AND p_field->'quantity'->>'preferredDisplayUnit'<>p_field->'quantity'->>'storageUnit' AND p_field->'quantity'->>'preferredDisplayUnit'<>ALL(units) THEN RAISE EXCEPTION 'preferred display unit must be a storage or input unit' USING ERRCODE='SB071'; END IF;
  END IF;
  IF p_field->>'cardinality'='many' AND p_field->'defaultValue'<>'null'::jsonb THEN RAISE EXCEPTION 'many FieldDefinitions cannot have defaults' USING ERRCODE='SB071'; END IF;
  IF p_field->'defaultValue'<>'null'::jsonb AND NOT internal.sheet_definition_scalar_matches(p_field->>'logicalType',p_field->'defaultValue') THEN RAISE EXCEPTION 'FieldDefinition default does not match logical type' USING ERRCODE='SB071'; END IF;
  IF p_field->>'logicalType'='category' THEN
    IF jsonb_typeof(p_field->'category')<>'object' OR p_field->'category'->>'kind' NOT IN ('embedded','vocabulary') THEN RAISE EXCEPTION 'category FieldDefinition requires a source' USING ERRCODE='SB071'; END IF;
    IF p_field->'category'->>'kind'='embedded' THEN
      PERFORM internal.assert_sheet_definition_object(p_field->'category',ARRAY['kind','options'],ARRAY['kind','options'],p_path||'.category');
      IF jsonb_typeof(p_field->'category'->'options')<>'array' OR jsonb_array_length(p_field->'category'->'options')>256 THEN RAISE EXCEPTION 'invalid embedded category options' USING ERRCODE='SB071'; END IF;
      FOR option IN SELECT value FROM jsonb_array_elements(p_field->'category'->'options') LOOP
        PERFORM internal.assert_sheet_definition_object(option,ARRAY['id','key','label','displayOrder','lifecycle'],ARRAY['id','key','label','displayOrder','lifecycle'],p_path||'.category.options');
        PERFORM internal.sheet_definition_uuid(option->>'id',p_path||'.category.options.id');
        IF option->>'id'=ANY(ids) OR option->>'key'=ANY(keys) OR option->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
           OR length(btrim(option->>'label')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(option->'displayOrder')<>'number' OR (option->>'displayOrder')::numeric<>trunc((option->>'displayOrder')::numeric) OR (option->>'displayOrder')::numeric NOT BETWEEN 0 AND 10000
           OR option->>'lifecycle' NOT IN ('active','retired') THEN RAISE EXCEPTION 'invalid or duplicate embedded category option' USING ERRCODE='SB071'; END IF;
        ids:=array_append(ids,option->>'id'); keys:=array_append(keys,option->>'key');
      END LOOP;
      IF p_field->'defaultValue'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_field->'category'->'options') value WHERE value->>'id'=p_field->>'defaultValue' AND value->>'lifecycle'='active') THEN RAISE EXCEPTION 'category default must name an active option' USING ERRCODE='SB071'; END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(p_field->'category',ARRAY['kind','vocabularyId'],ARRAY['kind','vocabularyId'],p_path||'.category');
      PERFORM internal.sheet_definition_uuid(p_field->'category'->>'vocabularyId',p_path||'.category.vocabularyId');
    END IF;
  ELSIF p_field->'category'<>'null'::jsonb THEN RAISE EXCEPTION 'only category FieldDefinitions may define category metadata' USING ERRCODE='SB071'; END IF;
  IF p_field->>'logicalType'='reference' THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'relationship',ARRAY['target','cardinality'],ARRAY['target','cardinality'],p_path||'.relationship');
    target:=p_field->'relationship'->'target';
    IF jsonb_typeof(target)<>'object' OR target->>'kind' NOT IN ('model','dataset-schema') OR p_field->'relationship'->>'cardinality'<>p_field->>'cardinality' THEN RAISE EXCEPTION 'invalid FieldDefinition relationship' USING ERRCODE='SB071'; END IF;
    IF target->>'kind'='model' THEN
      PERFORM internal.assert_sheet_definition_object(target,ARRAY['kind','modelKey'],ARRAY['kind','modelKey'],p_path||'.relationship.target');
      IF target->>'modelKey' !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'invalid relationship model key' USING ERRCODE='SB071'; END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(target,ARRAY['kind','schemaId'],ARRAY['kind','schemaId'],p_path||'.relationship.target');
      PERFORM internal.sheet_definition_uuid(target->>'schemaId',p_path||'.relationship.target.schemaId');
    END IF;
  ELSIF p_field->'relationship'<>'null'::jsonb THEN RAISE EXCEPTION 'only reference FieldDefinitions may define relationships' USING ERRCODE='SB071'; END IF;
  IF jsonb_typeof(p_field->'computation')<>'object' OR p_field->'computation'->>'mode' NOT IN ('stored','computed') THEN RAISE EXCEPTION 'invalid FieldDefinition computation' USING ERRCODE='SB071'; END IF;
  IF p_field->'computation'->>'mode'='stored' THEN
    PERFORM internal.assert_sheet_definition_object(p_field->'computation',ARRAY['mode'],ARRAY['mode'],p_path||'.computation');
  ELSE
    PERFORM internal.assert_sheet_definition_object(p_field->'computation',ARRAY['mode','expressionId'],ARRAY['mode','expressionId'],p_path||'.computation');
    PERFORM internal.sheet_definition_uuid(p_field->'computation'->>'expressionId',p_path||'.computation.expressionId');
    IF p_field->'defaultValue'<>'null'::jsonb THEN RAISE EXCEPTION 'computed FieldDefinitions cannot have defaults' USING ERRCODE='SB071'; END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION internal.validate_sheet_definition_configuration(p_config jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE item jsonb; nested jsonb; id text; source jsonb; field jsonb; type_spec jsonb; contract jsonb;
  parameter_ids text[]:='{}'; parameter_keys text[]:='{}'; binding_ids text[]:='{}'; binding_keys text[]:='{}'; column_ids text[]:='{}'; column_keys text[]:='{}'; calculation_ids text[]:='{}'; calculation_keys text[]:='{}'; action_keys text[]:='{}'; section_ids text[]; order_ids text[]:='{}';
BEGIN
  IF octet_length(p_config::text)>1048576 THEN RAISE EXCEPTION 'Sheet Definition configuration exceeds 1 MiB' USING ERRCODE='SB071'; END IF;
  PERFORM internal.assert_sheet_definition_object(p_config,
    ARRAY['formatVersion','parameters','bindings','rowIdentity','joins','columns','calculations','writeBackRules','actions','presentation'],
    ARRAY['formatVersion','parameters','bindings','rowIdentity','joins','columns','calculations','writeBackRules','actions','presentation'],'configuration');
  IF jsonb_typeof(p_config->'formatVersion') IS DISTINCT FROM 'number' OR p_config->'formatVersion'<>'1'::jsonb THEN RAISE EXCEPTION 'unsupported Sheet Definition configuration format' USING ERRCODE='SB071'; END IF;
  IF jsonb_typeof(p_config->'parameters')<>'array' OR jsonb_array_length(p_config->'parameters')>64
     OR jsonb_typeof(p_config->'bindings')<>'array' OR jsonb_array_length(p_config->'bindings')>64
     OR jsonb_typeof(p_config->'joins')<>'array' OR jsonb_array_length(p_config->'joins')>16
     OR jsonb_typeof(p_config->'columns')<>'array' OR jsonb_array_length(p_config->'columns')>256
     OR jsonb_typeof(p_config->'calculations')<>'array' OR jsonb_array_length(p_config->'calculations')>128
     OR jsonb_typeof(p_config->'writeBackRules')<>'array' OR jsonb_array_length(p_config->'writeBackRules')>64
     OR jsonb_typeof(p_config->'actions')<>'array' OR jsonb_array_length(p_config->'actions')>64
  THEN RAISE EXCEPTION 'invalid or oversized Sheet Definition section' USING ERRCODE='SB071'; END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','key','label','required','type','constraints'],ARRAY['id','key','label','required','type','defaultValue','constraints'],'parameters');
    id:=internal.sheet_definition_uuid(item->>'id','parameters.id')::text;
    IF id=ANY(parameter_ids) OR item->>'key'=ANY(parameter_keys) OR item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(item->'required')<>'boolean' OR jsonb_typeof(item->'constraints')<>'object' THEN RAISE EXCEPTION 'invalid or duplicate Sheet Definition parameter' USING ERRCODE='SB071'; END IF;
    parameter_ids:=array_append(parameter_ids,id); parameter_keys:=array_append(parameter_keys,item->>'key'); type_spec:=item->'type';
    IF jsonb_typeof(type_spec)<>'object' OR type_spec->>'kind' NOT IN ('scalar','record','dataset','dataset-version') THEN RAISE EXCEPTION 'invalid Sheet Definition parameter type' USING ERRCODE='SB071'; END IF;
    IF type_spec->>'kind'='scalar' THEN
      PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','valueType'],ARRAY['kind','valueType'],'parameters.type');
      IF type_spec->>'valueType' NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference') THEN RAISE EXCEPTION 'invalid scalar parameter type' USING ERRCODE='SB071'; END IF;
      IF item ? 'defaultValue' AND NOT internal.sheet_definition_scalar_matches(type_spec->>'valueType',item->'defaultValue') THEN RAISE EXCEPTION 'scalar parameter default does not match its value type' USING ERRCODE='SB071'; END IF;
    ELSIF type_spec->>'kind'='record' THEN
      PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','modelKey'],ARRAY['kind','modelKey'],'parameters.type');
      IF type_spec->>'modelKey' !~ '^[a-z][a-z0-9_]{0,59}$' THEN RAISE EXCEPTION 'invalid Record parameter model' USING ERRCODE='SB071'; END IF;
      IF item ? 'defaultValue' THEN RAISE EXCEPTION 'object parameters cannot have defaults' USING ERRCODE='SB071'; END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(type_spec,ARRAY['kind','contract'],ARRAY['kind','contract'],'parameters.type'); contract:=type_spec->'contract';
      IF jsonb_typeof(contract)<>'object' OR contract->>'mode' NOT IN ('exact','semantic') THEN RAISE EXCEPTION 'invalid Dataset parameter contract' USING ERRCODE='SB071'; END IF;
      IF contract->>'mode'='exact' THEN PERFORM internal.assert_sheet_definition_object(contract,ARRAY['mode','schemaVersionId'],ARRAY['mode','schemaVersionId'],'parameters.type.contract'); PERFORM internal.sheet_definition_uuid(contract->>'schemaVersionId','parameters.type.contract.schemaVersionId');
      ELSE
        PERFORM internal.assert_sheet_definition_object(contract,ARRAY['mode','requiredFieldIds'],ARRAY['mode','requiredFieldIds'],'parameters.type.contract');
        IF jsonb_typeof(contract->'requiredFieldIds')<>'array' OR jsonb_array_length(contract->'requiredFieldIds') NOT BETWEEN 1 AND 64 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(contract->'requiredFieldIds') x GROUP BY x HAVING count(*)>1) THEN RAISE EXCEPTION 'invalid semantic Dataset contract' USING ERRCODE='SB071'; END IF;
        FOR id IN SELECT value FROM jsonb_array_elements_text(contract->'requiredFieldIds') LOOP PERFORM internal.sheet_definition_uuid(id,'parameters.type.contract.requiredFieldIds'); END LOOP;
      END IF;
      IF item ? 'defaultValue' THEN RAISE EXCEPTION 'object parameters cannot have defaults' USING ERRCODE='SB071'; END IF;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'bindings') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','key','parameterId'],ARRAY['id','key','parameterId'],'bindings'); id:=internal.sheet_definition_uuid(item->>'id','bindings.id')::text;
    IF id=ANY(binding_ids) OR item->>'key'=ANY(binding_keys) OR item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR internal.sheet_definition_uuid(item->>'parameterId','bindings.parameterId')::text<>ALL(parameter_ids) THEN RAISE EXCEPTION 'invalid, duplicate or unresolved Sheet Definition binding' USING ERRCODE='SB071'; END IF;
    binding_ids:=array_append(binding_ids,id); binding_keys:=array_append(binding_keys,item->>'key');
  END LOOP;

  section_ids:='{}';
  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'columns') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','field','source'],ARRAY['id','field','source'],'columns'); id:=internal.sheet_definition_uuid(item->>'id','columns.id')::text;
    IF id=ANY(column_ids) THEN RAISE EXCEPTION 'duplicate Sheet Definition column ID' USING ERRCODE='SB071'; END IF;
    field:=item->'field'; PERFORM internal.validate_sheet_field_definition(field,'columns.field');
    IF field->>'fieldId'<>id OR field->>'key'=ANY(column_keys) THEN RAISE EXCEPTION 'column FieldDefinition identity or key is duplicate' USING ERRCODE='SB071'; END IF;
    source:=item->'source';
    IF jsonb_typeof(source)<>'object' OR source->>'kind' NOT IN ('declared','bound','calculated') THEN RAISE EXCEPTION 'invalid Sheet Definition column source' USING ERRCODE='SB071'; END IF;
    IF source->>'kind'='declared' THEN PERFORM internal.assert_sheet_definition_object(source,ARRAY['kind'],ARRAY['kind'],'columns.source'); IF field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'declared columns must use stored FieldDefinition semantics' USING ERRCODE='SB071'; END IF;
    ELSIF source->>'kind'='bound' THEN PERFORM internal.assert_sheet_definition_object(source,ARRAY['kind','bindingId','sourceFieldId'],ARRAY['kind','bindingId','sourceFieldId'],'columns.source'); IF internal.sheet_definition_uuid(source->>'bindingId','columns.source.bindingId')::text<>ALL(binding_ids) THEN RAISE EXCEPTION 'bound column references unknown binding' USING ERRCODE='SB071'; END IF; PERFORM internal.sheet_definition_uuid(source->>'sourceFieldId','columns.source.sourceFieldId'); IF field->'computation'->>'mode'<>'stored' THEN RAISE EXCEPTION 'bound columns must use stored FieldDefinition semantics' USING ERRCODE='SB071'; END IF;
    ELSE PERFORM internal.assert_sheet_definition_object(source,ARRAY['kind','calculationId'],ARRAY['kind','calculationId'],'columns.source'); section_ids:=array_append(section_ids,internal.sheet_definition_uuid(source->>'calculationId','columns.source.calculationId')::text); IF field->'computation'->>'mode'<>'computed' OR field->'computation'->>'expressionId'<>source->>'calculationId' THEN RAISE EXCEPTION 'calculated column FieldDefinition must reference its calculation' USING ERRCODE='SB071'; END IF; END IF;
    column_ids:=array_append(column_ids,id); column_keys:=array_append(column_keys,field->>'key');
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'calculations') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','key','label','outputColumnId','inputColumnIds','expression'],ARRAY['id','key','label','outputColumnId','inputColumnIds','expression'],'calculations'); id:=internal.sheet_definition_uuid(item->>'id','calculations.id')::text;
    IF id=ANY(calculation_ids) OR item->>'key'=ANY(calculation_keys) OR item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200
       OR internal.sheet_definition_uuid(item->>'outputColumnId','calculations.outputColumnId')::text<>ALL(column_ids)
       OR jsonb_typeof(item->'inputColumnIds')<>'array' OR jsonb_array_length(item->'inputColumnIds')>64 THEN RAISE EXCEPTION 'invalid or unresolved Sheet Definition calculation' USING ERRCODE='SB071'; END IF;
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_config->'columns') column_item WHERE column_item->>'id'=item->>'outputColumnId' AND column_item->'source'->>'kind'='calculated' AND column_item->'source'->>'calculationId'=id) THEN RAISE EXCEPTION 'calculation output must be its corresponding calculated column' USING ERRCODE='SB071'; END IF;
    FOR nested IN SELECT value FROM jsonb_array_elements(item->'inputColumnIds') LOOP IF internal.sheet_definition_uuid(nested#>>'{}','calculations.inputColumnIds')::text<>ALL(column_ids) THEN RAISE EXCEPTION 'calculation references unknown input column' USING ERRCODE='SB071'; END IF; END LOOP;
    PERFORM internal.assert_sheet_definition_object(item->'expression',ARRAY['language','source'],ARRAY['language','source'],'calculations.expression');
    IF item->'expression'->>'language'<>'sheetbase-formula-v1' OR length(btrim(item->'expression'->>'source')) NOT BETWEEN 1 AND 8192 THEN RAISE EXCEPTION 'invalid calculation expression' USING ERRCODE='SB071'; END IF;
    calculation_ids:=array_append(calculation_ids,id); calculation_keys:=array_append(calculation_keys,item->>'key');
  END LOOP;
  IF EXISTS(SELECT 1 FROM unnest(section_ids) x WHERE x<>ALL(calculation_ids)) THEN RAISE EXCEPTION 'calculated column references unknown calculation' USING ERRCODE='SB071'; END IF;

  PERFORM internal.assert_sheet_definition_object(p_config->'rowIdentity',ARRAY['kind','columnIds'],ARRAY['kind','columnIds'],'rowIdentity');
  IF p_config->'rowIdentity'->>'kind' NOT IN ('source','composite','local') OR jsonb_typeof(p_config->'rowIdentity'->'columnIds')<>'array' OR jsonb_array_length(p_config->'rowIdentity'->'columnIds') NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_config->'rowIdentity'->'columnIds') x GROUP BY x HAVING count(*)>1) THEN RAISE EXCEPTION 'invalid Sheet Definition row identity' USING ERRCODE='SB071'; END IF;
  FOR id IN SELECT value FROM jsonb_array_elements_text(p_config->'rowIdentity'->'columnIds') LOOP IF internal.sheet_definition_uuid(id,'rowIdentity.columnIds')::text<>ALL(column_ids) THEN RAISE EXCEPTION 'row identity references unknown column' USING ERRCODE='SB071'; END IF; END LOOP;

  section_ids:='{}';
  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'joins') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','leftBindingId','rightBindingId','leftColumnId','rightColumnId','joinType','cardinality'],ARRAY['id','leftBindingId','rightBindingId','leftColumnId','rightColumnId','joinType','cardinality'],'joins'); id:=internal.sheet_definition_uuid(item->>'id','joins.id')::text;
    IF id=ANY(section_ids) OR internal.sheet_definition_uuid(item->>'leftBindingId','joins.leftBindingId')::text<>ALL(binding_ids) OR internal.sheet_definition_uuid(item->>'rightBindingId','joins.rightBindingId')::text<>ALL(binding_ids)
       OR internal.sheet_definition_uuid(item->>'leftColumnId','joins.leftColumnId')::text<>ALL(column_ids) OR internal.sheet_definition_uuid(item->>'rightColumnId','joins.rightColumnId')::text<>ALL(column_ids)
       OR item->>'joinType' NOT IN ('inner','left') OR item->>'cardinality' NOT IN ('one-to-one','many-to-one') THEN RAISE EXCEPTION 'invalid, duplicate or unresolved Sheet Definition join' USING ERRCODE='SB071'; END IF; section_ids:=array_append(section_ids,id);
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_config->'columns') column_item WHERE column_item->>'id'=item->>'leftColumnId' AND column_item->'source'->>'kind'='bound' AND column_item->'source'->>'bindingId'=item->>'leftBindingId')
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_config->'columns') column_item WHERE column_item->>'id'=item->>'rightColumnId' AND column_item->'source'->>'kind'='bound' AND column_item->'source'->>'bindingId'=item->>'rightBindingId') THEN RAISE EXCEPTION 'join columns must belong to their corresponding bindings' USING ERRCODE='SB071'; END IF;
  END LOOP;

  section_ids:='{}';
  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'writeBackRules') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','bindingId','mode','mappings'],ARRAY['id','bindingId','mode','mappings'],'writeBackRules'); id:=internal.sheet_definition_uuid(item->>'id','writeBackRules.id')::text;
    IF id=ANY(section_ids) OR internal.sheet_definition_uuid(item->>'bindingId','writeBackRules.bindingId')::text<>ALL(binding_ids) OR item->>'mode'<>'update' OR jsonb_typeof(item->'mappings')<>'array' OR jsonb_array_length(item->'mappings') NOT BETWEEN 1 AND 128 THEN RAISE EXCEPTION 'invalid write-back rule' USING ERRCODE='SB071'; END IF;
    FOR nested IN SELECT value FROM jsonb_array_elements(item->'mappings') LOOP PERFORM internal.assert_sheet_definition_object(nested,ARRAY['columnId','targetFieldId'],ARRAY['columnId','targetFieldId'],'writeBackRules.mappings'); IF internal.sheet_definition_uuid(nested->>'columnId','writeBackRules.mappings.columnId')::text<>ALL(column_ids) THEN RAISE EXCEPTION 'write-back references unknown column' USING ERRCODE='SB071'; END IF; PERFORM internal.sheet_definition_uuid(nested->>'targetFieldId','writeBackRules.mappings.targetFieldId'); END LOOP;
    section_ids:=array_append(section_ids,id);
  END LOOP;

  section_ids:='{}';
  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'actions') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['id','key','label','kind'],ARRAY['id','key','label','kind','bindingId','parameterId'],'actions'); id:=internal.sheet_definition_uuid(item->>'id','actions.id')::text;
    IF id=ANY(section_ids) OR item->>'key'=ANY(action_keys) OR item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$' OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 OR item->>'kind' NOT IN ('create-record','link-record','open-record') THEN RAISE EXCEPTION 'invalid configured action' USING ERRCODE='SB071'; END IF;
    IF item ? 'bindingId' AND internal.sheet_definition_uuid(item->>'bindingId','actions.bindingId')::text<>ALL(binding_ids) THEN RAISE EXCEPTION 'action references unknown binding' USING ERRCODE='SB071'; END IF;
    IF item ? 'parameterId' AND internal.sheet_definition_uuid(item->>'parameterId','actions.parameterId')::text<>ALL(parameter_ids) THEN RAISE EXCEPTION 'action references unknown parameter' USING ERRCODE='SB071'; END IF; section_ids:=array_append(section_ids,id); action_keys:=array_append(action_keys,item->>'key');
  END LOOP;

  PERFORM internal.assert_sheet_definition_object(p_config->'presentation',ARRAY['columnOrder','hiddenColumnIds','columnWidths','frozenColumnCount','density'],ARRAY['columnOrder','hiddenColumnIds','columnWidths','frozenColumnCount','density'],'presentation');
  IF jsonb_typeof(p_config->'presentation'->'columnOrder')<>'array' OR jsonb_array_length(p_config->'presentation'->'columnOrder')<>cardinality(column_ids)
     OR jsonb_typeof(p_config->'presentation'->'hiddenColumnIds')<>'array' OR jsonb_array_length(p_config->'presentation'->'hiddenColumnIds')>256
     OR jsonb_typeof(p_config->'presentation'->'columnWidths')<>'object' OR jsonb_typeof(p_config->'presentation'->'frozenColumnCount')<>'number' OR (p_config->'presentation'->>'frozenColumnCount')::numeric<>trunc((p_config->'presentation'->>'frozenColumnCount')::numeric)
     OR (p_config->'presentation'->>'frozenColumnCount')::numeric NOT BETWEEN 0 AND 256 OR p_config->'presentation'->>'density' NOT IN ('compact','standard','comfortable') THEN RAISE EXCEPTION 'invalid Sheet Definition presentation defaults' USING ERRCODE='SB071'; END IF;
  FOR id IN SELECT value FROM jsonb_array_elements_text(p_config->'presentation'->'columnOrder') LOOP IF id=ANY(order_ids) OR internal.sheet_definition_uuid(id,'presentation.columnOrder')::text<>ALL(column_ids) THEN RAISE EXCEPTION 'column order must contain every column exactly once' USING ERRCODE='SB071'; END IF; order_ids:=array_append(order_ids,id); END LOOP;
  order_ids:='{}'; FOR id IN SELECT value FROM jsonb_array_elements_text(p_config->'presentation'->'hiddenColumnIds') LOOP IF id=ANY(order_ids) OR internal.sheet_definition_uuid(id,'presentation.hiddenColumnIds')::text<>ALL(column_ids) THEN RAISE EXCEPTION 'invalid hidden column reference' USING ERRCODE='SB071'; END IF; order_ids:=array_append(order_ids,id); END LOOP;
  FOR id,nested IN SELECT key,value FROM jsonb_each(p_config->'presentation'->'columnWidths') LOOP IF internal.sheet_definition_uuid(id,'presentation.columnWidths')::text<>ALL(column_ids) OR jsonb_typeof(nested)<>'number' OR (nested#>>'{}')::numeric NOT BETWEEN 40 AND 1000 OR (nested#>>'{}')::numeric<>trunc((nested#>>'{}')::numeric) THEN RAISE EXCEPTION 'invalid column width default' USING ERRCODE='SB071'; END IF; END LOOP;
END $$;

CREATE OR REPLACE FUNCTION internal.guard_sheet_definition() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sheet Definitions cannot be deleted' USING ERRCODE='SB072'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.id,NEW.workspace_id,NEW.key,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.key,OLD.created_at,OLD.created_by_user_id) THEN RAISE EXCEPTION 'Sheet Definition identity is immutable' USING ERRCODE='SB072'; END IF;
    IF OLD.lifecycle='retired' THEN RAISE EXCEPTION 'retired Sheet Definitions are immutable' USING ERRCODE='SB072'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sheet_definition BEFORE UPDATE OR DELETE ON api.sheet_definitions FOR EACH ROW EXECUTE FUNCTION internal.guard_sheet_definition();

CREATE OR REPLACE FUNCTION internal.guard_sheet_definition_version() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE parent api.sheet_definitions; expected integer;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Sheet Definition Versions cannot be deleted' USING ERRCODE='SB072'; END IF;
  SELECT * INTO parent FROM api.sheet_definitions WHERE id=NEW.definition_id FOR UPDATE;
  IF parent.id IS NULL THEN RAISE EXCEPTION 'Sheet Definition missing' USING ERRCODE='23503'; END IF;
  IF TG_OP='INSERT' THEN
    IF parent.lifecycle<>'active' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
    SELECT coalesce(max(version),0)+1 INTO expected FROM api.sheet_definition_versions WHERE definition_id=NEW.definition_id;
    IF NEW.version<>expected OR NEW.lifecycle<>'draft' OR NEW.revision<>1 OR NEW.published_at IS NOT NULL OR NEW.published_by_user_id IS NOT NULL OR NEW.retired_at IS NOT NULL OR NEW.retired_by_user_id IS NOT NULL THEN RAISE EXCEPTION 'Sheet Definition Versions must be explicit monotonic drafts' USING ERRCODE='SB071'; END IF;
    PERFORM internal.validate_sheet_definition_configuration(NEW.configuration);
  ELSE
    IF (NEW.id,NEW.definition_id,NEW.version,NEW.configuration_format_version,NEW.created_at,NEW.created_by_user_id) IS DISTINCT FROM (OLD.id,OLD.definition_id,OLD.version,OLD.configuration_format_version,OLD.created_at,OLD.created_by_user_id) THEN RAISE EXCEPTION 'Sheet Definition Version identity is immutable' USING ERRCODE='SB072'; END IF;
    IF OLD.lifecycle='retired' THEN RAISE EXCEPTION 'retired Sheet Definition Versions are immutable' USING ERRCODE='SB072'; END IF;
    IF OLD.lifecycle='published' THEN
      IF NEW.lifecycle<>'retired' OR NEW.configuration IS DISTINCT FROM OLD.configuration OR NEW.published_at IS DISTINCT FROM OLD.published_at OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id THEN RAISE EXCEPTION 'published Sheet Definition Versions are immutable' USING ERRCODE='SB072'; END IF;
    ELSE
      IF parent.lifecycle<>'active' AND NEW.lifecycle<>'retired' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
      PERFORM internal.validate_sheet_definition_configuration(NEW.configuration);
      IF NEW.lifecycle='published' AND (NEW.published_at IS NULL OR NEW.published_by_user_id IS NULL) THEN RAISE EXCEPTION 'publication attribution is required' USING ERRCODE='SB071'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_sheet_definition_version BEFORE INSERT OR UPDATE OR DELETE ON api.sheet_definition_versions FOR EACH ROW EXECUTE FUNCTION internal.guard_sheet_definition_version();

REVOKE EXECUTE ON FUNCTION internal.sheet_definition_uuid(text,text),internal.sheet_definition_scalar_matches(text,jsonb),internal.assert_sheet_definition_object(jsonb,text[],text[],text),internal.validate_sheet_field_definition(jsonb,text),internal.validate_sheet_definition_configuration(jsonb),internal.guard_sheet_definition(),internal.guard_sheet_definition_version() FROM PUBLIC,authenticated,api_client;

ALTER TABLE api.sheet_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.sheet_definition_versions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.sheet_definitions,api.sheet_definition_versions TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON api.sheet_definitions,api.sheet_definition_versions FROM authenticated;
CREATE POLICY sheet_definitions_read ON api.sheet_definitions FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY sheet_definition_versions_read ON api.sheet_definition_versions FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM api.sheet_definitions d WHERE d.id=definition_id AND d.workspace_id=api.current_workspace_id() AND api.is_workspace_member(d.workspace_id)));

CREATE OR REPLACE FUNCTION api.is_sheet_definition_admin(p_workspace_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT api.current_workspace_id()=p_workspace_id AND EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=p_workspace_id AND m.user_id=api.current_user_id() AND m.suspended_at IS NULL AND m.role IN ('owner','admin'))
$$;
REVOKE EXECUTE ON FUNCTION api.is_sheet_definition_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.is_sheet_definition_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION api.create_sheet_definition(p_workspace_id uuid,p_key text,p_name text,p_description text,p_configuration jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; version api.sheet_definition_versions; actor text:=api.current_user_id();
BEGIN
 IF NOT api.is_sheet_definition_admin(p_workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_description,''))>2000 THEN RAISE EXCEPTION 'invalid Sheet Definition metadata' USING ERRCODE='SB071'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration);
 INSERT INTO api.sheet_definitions(workspace_id,key,name,description,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,p_key,btrim(p_name),nullif(btrim(p_description),''),actor,actor) RETURNING * INTO definition;
 INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id) VALUES(definition.id,1,p_configuration,actor,actor) RETURNING * INTO version;
 RETURN jsonb_build_object('definition',to_jsonb(definition),'version',to_jsonb(version));
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_definition_version(p_definition_id uuid,p_expected_definition_revision bigint,p_configuration jsonb)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; result api.sheet_definition_versions; next_version integer; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL OR NOT api.is_sheet_definition_admin(definition.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF definition.revision<>p_expected_definition_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration); SELECT coalesce(max(version),0)+1 INTO next_version FROM api.sheet_definition_versions WHERE definition_id=definition.id;
 INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id) VALUES(definition.id,next_version,p_configuration,actor,actor) RETURNING * INTO result;
 UPDATE api.sheet_definitions SET revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_definition(p_definition_id uuid,p_expected_revision bigint,p_patch jsonb)
RETURNS api.sheet_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL OR NOT api.is_sheet_definition_admin(definition.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF definition.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch - ARRAY['name','description']<>'{}'::jsonb
    OR (p_patch ? 'name' AND (jsonb_typeof(p_patch->'name') IS DISTINCT FROM 'string' OR length(btrim(p_patch->>'name')) NOT BETWEEN 1 AND 200))
    OR (p_patch ? 'description' AND jsonb_typeof(p_patch->'description') NOT IN ('string','null'))
    OR (jsonb_typeof(p_patch->'description')='string' AND length(p_patch->>'description')>2000)
 THEN RAISE EXCEPTION 'invalid Sheet Definition metadata patch' USING ERRCODE='SB071'; END IF;
 UPDATE api.sheet_definitions SET name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE name END,description=CASE WHEN p_patch?'description' THEN nullif(btrim(p_patch->>'description'),'') ELSE description END,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id RETURNING * INTO definition; RETURN definition;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_definition_draft(p_version_id uuid,p_expected_revision bigint,p_configuration jsonb)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; workspace uuid; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE;
 SELECT workspace_id INTO workspace FROM api.sheet_definitions WHERE id=version.definition_id;
 IF version.id IS NULL OR NOT api.is_sheet_definition_admin(workspace) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF version.lifecycle<>'draft' THEN RAISE EXCEPTION 'only draft Sheet Definition Versions may be updated' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration);
 UPDATE api.sheet_definition_versions SET configuration=p_configuration,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;

CREATE OR REPLACE FUNCTION api.publish_sheet_definition_version(p_version_id uuid,p_expected_revision bigint)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE; SELECT * INTO definition FROM api.sheet_definitions WHERE id=version.definition_id FOR UPDATE;
 IF version.id IS NULL OR NOT api.is_sheet_definition_admin(definition.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' OR version.lifecycle<>'draft' THEN RAISE EXCEPTION 'only active Definition drafts may be published' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(version.configuration);
 UPDATE api.sheet_definition_versions SET lifecycle='published',revision=revision+1,published_at=now(),published_by_user_id=actor,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;

CREATE OR REPLACE FUNCTION api.retire_sheet_definition(p_definition_id uuid,p_expected_revision bigint)
RETURNS api.sheet_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL OR NOT api.is_sheet_definition_admin(definition.workspace_id) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF definition.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Definition is already retired' USING ERRCODE='SB072'; END IF;
 UPDATE api.sheet_definitions SET lifecycle='retired',revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id RETURNING * INTO definition; RETURN definition;
END $$;

CREATE OR REPLACE FUNCTION api.retire_sheet_definition_version(p_version_id uuid,p_expected_revision bigint)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; workspace uuid; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE;
 SELECT workspace_id INTO workspace FROM api.sheet_definitions WHERE id=version.definition_id;
 IF version.id IS NULL OR NOT api.is_sheet_definition_admin(workspace) THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF version.lifecycle='retired' THEN RAISE EXCEPTION 'Sheet Definition Version is already retired' USING ERRCODE='SB072'; END IF;
 UPDATE api.sheet_definition_versions SET lifecycle='retired',revision=revision+1,retired_at=now(),retired_by_user_id=actor,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;

REVOKE EXECUTE ON FUNCTION api.create_sheet_definition(uuid,text,text,text,jsonb),api.create_sheet_definition_version(uuid,bigint,jsonb),api.update_sheet_definition(uuid,bigint,jsonb),api.update_sheet_definition_draft(uuid,bigint,jsonb),api.publish_sheet_definition_version(uuid,bigint),api.retire_sheet_definition(uuid,bigint),api.retire_sheet_definition_version(uuid,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_sheet_definition(uuid,text,text,text,jsonb),api.create_sheet_definition_version(uuid,bigint,jsonb),api.update_sheet_definition(uuid,bigint,jsonb),api.update_sheet_definition_draft(uuid,bigint,jsonb),api.publish_sheet_definition_version(uuid,bigint),api.retire_sheet_definition(uuid,bigint),api.retire_sheet_definition_version(uuid,bigint) TO authenticated;
NOTIFY pgrst,'reload schema';
