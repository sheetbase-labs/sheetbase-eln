-- CORE-03.12: explicit, value-free Sheet Instance structure extraction into
-- a new Definition draft. Publication remains a separate controlled action.

CREATE FUNCTION internal.build_sheet_definition_extraction_preview(
  p_instance api.sheet_instances,
  p_selection jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE
  source_config jsonb;
  source_columns jsonb := '[]'::jsonb;
  selected_local_fields jsonb := '[]'::jsonb;
  selected_calculations jsonb := '[]'::jsonb;
  parameters jsonb := '[]'::jsonb;
  bindings jsonb := '[]'::jsonb;
  joins jsonb := '[]'::jsonb;
  columns jsonb := '[]'::jsonb;
  calculations jsonb := '[]'::jsonb;
  presentation jsonb;
  configuration jsonb;
  manifest jsonb;
  item jsonb;
  source_item jsonb;
  dependency jsonb;
  all_column_ids text[];
  ordered_column_ids text[] := '{}';
  selected_binding_ids text[];
  selected_column_ids text[];
  selected_join_ids text[];
  selected_local_field_ids text[];
  selected_calculation_ids text[];
  selected_id text;
  source_kind text;
  parameter_kind text;
  candidate_schema_version uuid;
  local_row_count integer;
  local_cell_count integer;
BEGIN
  PERFORM internal.assert_sheet_definition_object(
    p_selection,
    ARRAY['bindings','columnIds','joinIds','localFieldIds','calculationIds','rowIdentity','includePresentation'],
    ARRAY['bindings','columnIds','joinIds','localFieldIds','calculationIds','rowIdentity','includePresentation'],
    'Definition extraction selection'
  );
  IF jsonb_typeof(p_selection->'bindings') <> 'array'
     OR jsonb_array_length(p_selection->'bindings') > 64
     OR jsonb_typeof(p_selection->'columnIds') <> 'array'
     OR jsonb_array_length(p_selection->'columnIds') > 256
     OR jsonb_typeof(p_selection->'joinIds') <> 'array'
     OR jsonb_array_length(p_selection->'joinIds') > 16
     OR jsonb_typeof(p_selection->'localFieldIds') <> 'array'
     OR jsonb_array_length(p_selection->'localFieldIds') > 256
     OR jsonb_typeof(p_selection->'calculationIds') <> 'array'
     OR jsonb_array_length(p_selection->'calculationIds') > 128
     OR jsonb_typeof(p_selection->'includePresentation') <> 'boolean'
  THEN
    RAISE EXCEPTION 'invalid or oversized Definition extraction selection' USING ERRCODE='SB086';
  END IF;
  PERFORM internal.assert_sheet_definition_object(
    p_selection->'rowIdentity',ARRAY['kind','columnIds'],ARRAY['kind','columnIds'],
    'Definition extraction row identity'
  );
  IF p_selection->'rowIdentity'->>'kind' NOT IN ('source','composite','local')
     OR jsonb_typeof(p_selection->'rowIdentity'->'columnIds') <> 'array'
     OR jsonb_array_length(p_selection->'rowIdentity'->'columnIds') NOT BETWEEN 1 AND 8
  THEN RAISE EXCEPTION 'invalid Definition extraction row identity' USING ERRCODE='SB086'; END IF;

  SELECT coalesce(array_agg(value ORDER BY ordinal),'{}') INTO selected_column_ids
    FROM jsonb_array_elements_text(p_selection->'columnIds') WITH ORDINALITY selected(value,ordinal);
  SELECT coalesce(array_agg(value ORDER BY ordinal),'{}') INTO selected_join_ids
    FROM jsonb_array_elements_text(p_selection->'joinIds') WITH ORDINALITY selected(value,ordinal);
  SELECT coalesce(array_agg(value ORDER BY ordinal),'{}') INTO selected_local_field_ids
    FROM jsonb_array_elements_text(p_selection->'localFieldIds') WITH ORDINALITY selected(value,ordinal);
  SELECT coalesce(array_agg(value ORDER BY ordinal),'{}') INTO selected_calculation_ids
    FROM jsonb_array_elements_text(p_selection->'calculationIds') WITH ORDINALITY selected(value,ordinal);
  IF cardinality(selected_column_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(selected_column_ids) value))
     OR cardinality(selected_join_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(selected_join_ids) value))
     OR cardinality(selected_local_field_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(selected_local_field_ids) value))
     OR cardinality(selected_calculation_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(selected_calculation_ids) value))
  THEN RAISE EXCEPTION 'Definition extraction selection IDs must be unique' USING ERRCODE='SB086'; END IF;
  FOREACH selected_id IN ARRAY selected_column_ids LOOP PERFORM internal.sheet_definition_uuid(selected_id,'Definition extraction source column ID'); END LOOP;
  FOREACH selected_id IN ARRAY selected_join_ids LOOP PERFORM internal.sheet_definition_uuid(selected_id,'Definition extraction join ID'); END LOOP;
  FOREACH selected_id IN ARRAY selected_local_field_ids LOOP PERFORM internal.sheet_definition_uuid(selected_id,'Definition extraction local field ID'); END LOOP;
  FOREACH selected_id IN ARRAY selected_calculation_ids LOOP PERFORM internal.sheet_definition_uuid(selected_id,'Definition extraction calculation ID'); END LOOP;

  IF p_instance.source_definition_version_id IS NOT NULL THEN
    SELECT configuration INTO source_config
      FROM api.sheet_definition_versions
      WHERE id=p_instance.source_definition_version_id;
  END IF;

  selected_binding_ids := '{}';
  FOR item IN SELECT value FROM jsonb_array_elements(p_selection->'bindings') LOOP
    PERFORM internal.assert_sheet_definition_object(item,ARRAY['bindingId','key','parameter'],ARRAY['bindingId','key','parameter'],'Definition extraction binding');
    selected_id := internal.sheet_definition_uuid(item->>'bindingId','Definition extraction binding ID')::text;
    IF selected_id=ANY(selected_binding_ids) OR item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
    THEN RAISE EXCEPTION 'duplicate or invalid Definition extraction binding' USING ERRCODE='SB086'; END IF;
    SELECT value INTO source_item FROM jsonb_array_elements(p_instance.state->'bindings') WHERE value->>'bindingId'=selected_id;
    IF source_item IS NULL THEN RAISE EXCEPTION 'selected binding is absent from the source Instance' USING ERRCODE='SB086'; END IF;
    IF item->'parameter'->>'id' IS DISTINCT FROM source_item->>'parameterId'
    THEN RAISE EXCEPTION 'selected parameter must preserve the stable Instance parameter ID' USING ERRCODE='SB086'; END IF;
    source_kind := source_item->>'kind';
    parameter_kind := item->'parameter'->'type'->>'kind';
    IF (source_kind='record' AND parameter_kind<>'record')
       OR (source_kind='dataset' AND source_item->'policy'->>'mode'='live' AND parameter_kind<>'dataset')
       OR (source_kind='dataset' AND source_item->'policy'->>'mode'='version' AND parameter_kind<>'dataset-version')
    THEN RAISE EXCEPTION 'selected parameter type does not match the concrete binding policy' USING ERRCODE='SB086'; END IF;
    selected_binding_ids := array_append(selected_binding_ids,selected_id);
    parameters := parameters || jsonb_build_array(item->'parameter');
    bindings := bindings || jsonb_build_array(jsonb_build_object('id',selected_id,'key',item->>'key','parameterId',item->'parameter'->>'id'));
  END LOOP;

  IF cardinality(selected_binding_ids) <> cardinality(ARRAY(SELECT DISTINCT value FROM unnest(selected_binding_ids) value))
     OR (SELECT count(*) FROM jsonb_array_elements(parameters)) <>
        (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(parameters))
     OR (SELECT count(*) FROM jsonb_array_elements(bindings)) <>
        (SELECT count(DISTINCT value->>'key') FROM jsonb_array_elements(bindings))
  THEN RAISE EXCEPTION 'Definition extraction binding identities and keys must be unique' USING ERRCODE='SB086'; END IF;

  FOR selected_id IN SELECT value FROM jsonb_array_elements_text(p_selection->'columnIds') LOOP
    SELECT value INTO source_item FROM jsonb_array_elements(coalesce(source_config->'columns','[]'::jsonb)) WHERE value->>'id'=selected_id;
    IF source_item IS NULL OR source_item->'source'->>'kind'='calculated'
    THEN RAISE EXCEPTION 'selected source column is absent or calculated' USING ERRCODE='SB086'; END IF;
    IF source_item->'source'->>'kind'='bound' AND source_item->'source'->>'bindingId'<>ALL(selected_binding_ids)
    THEN RAISE EXCEPTION 'selected bound column requires its explicit parameterised binding' USING ERRCODE='SB086'; END IF;
    source_columns := source_columns || jsonb_build_array(source_item);
  END LOOP;

  FOR selected_id IN SELECT value FROM jsonb_array_elements_text(p_selection->'joinIds') LOOP
    SELECT value INTO source_item FROM jsonb_array_elements(coalesce(source_config->'joins','[]'::jsonb)) WHERE value->>'id'=selected_id;
    IF source_item IS NULL OR source_item->>'leftBindingId'<>ALL(selected_binding_ids)
       OR source_item->>'rightBindingId'<>ALL(selected_binding_ids)
       OR source_item->>'leftColumnId'<>ALL(selected_column_ids)
       OR source_item->>'rightColumnId'<>ALL(selected_column_ids)
    THEN RAISE EXCEPTION 'selected join and its stable dependencies must all be selected' USING ERRCODE='SB086'; END IF;
    joins := joins || jsonb_build_array(source_item);
  END LOOP;

  FOR selected_id IN SELECT value FROM jsonb_array_elements_text(p_selection->'localFieldIds') LOOP
    SELECT value INTO source_item FROM jsonb_array_elements(p_instance.state->'localFields') WHERE value->>'fieldId'=selected_id;
    IF source_item IS NULL OR source_item->>'lifecycle'='retired'
    THEN RAISE EXCEPTION 'selected local field is absent or retired' USING ERRCODE='SB086'; END IF;
    selected_local_fields := selected_local_fields || jsonb_build_array(source_item);
  END LOOP;

  FOR selected_id IN SELECT value FROM jsonb_array_elements_text(p_selection->'calculationIds') LOOP
    SELECT value INTO source_item FROM jsonb_array_elements(coalesce(p_instance.state->'instanceCalculations','[]'::jsonb)) WHERE value->>'id'=selected_id;
    IF source_item IS NULL OR source_item->>'lifecycle'<>'active'
    THEN RAISE EXCEPTION 'selected Instance calculation is absent or retired' USING ERRCODE='SB086'; END IF;
    FOR dependency IN SELECT value FROM jsonb_array_elements(source_item->'dependencies') LOOP
      IF (dependency->>'kind'='column' AND dependency->>'id'<>ALL(selected_column_ids))
         OR (dependency->>'kind'='local-field' AND dependency->>'id'<>ALL(selected_local_field_ids))
         OR (dependency->>'kind'='calculation' AND dependency->>'id'<>ALL(selected_calculation_ids))
      THEN RAISE EXCEPTION 'selected calculation requires every stable dependency to be selected' USING ERRCODE='SB086'; END IF;
    END LOOP;
    selected_calculations := selected_calculations || jsonb_build_array(source_item);
  END LOOP;

  columns := source_columns;
  FOR item IN SELECT value FROM jsonb_array_elements(selected_local_fields) LOOP
    columns := columns || jsonb_build_array(jsonb_build_object('id',item->>'fieldId','field',item,'source',jsonb_build_object('kind','declared')));
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(selected_calculations) LOOP
    columns := columns || jsonb_build_array(jsonb_build_object('id',item->>'id','field',item->'outputField','source',jsonb_build_object('kind','calculated','calculationId',item->>'id')));
    calculations := calculations || jsonb_build_array(jsonb_build_object(
      'id',item->>'id','key',item->>'key','label',item->>'label','outputColumnId',item->>'id',
      'inputColumnIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(item->'dependencies') WITH ORDINALITY dependency(value,ordinal)),'[]'::jsonb),
      'expression',item->'expression'
    ));
  END LOOP;
  SELECT coalesce(array_agg(value->>'id' ORDER BY ordinal),'{}') INTO all_column_ids
    FROM jsonb_array_elements(columns) WITH ORDINALITY selected(value,ordinal);

  IF (p_selection->>'includePresentation')::boolean THEN
    FOR selected_id IN SELECT value FROM jsonb_array_elements_text(p_instance.state->'presentation'->'columnOrder') LOOP
      IF selected_id=ANY(all_column_ids) AND selected_id<>ALL(ordered_column_ids) THEN ordered_column_ids:=array_append(ordered_column_ids,selected_id); END IF;
    END LOOP;
    FOREACH selected_id IN ARRAY all_column_ids LOOP
      IF selected_id<>ALL(ordered_column_ids) THEN ordered_column_ids:=array_append(ordered_column_ids,selected_id); END IF;
    END LOOP;
    presentation := jsonb_build_object(
      'columnOrder',to_jsonb(ordered_column_ids),
      'hiddenColumnIds',coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM jsonb_array_elements_text(p_instance.state->'presentation'->'hiddenColumnIds') WITH ORDINALITY hidden(value,ordinal) WHERE value=ANY(all_column_ids)),'[]'::jsonb),
      'columnWidths',coalesce((SELECT jsonb_object_agg(key,value) FROM jsonb_each(p_instance.state->'presentation'->'columnWidths') WHERE key=ANY(all_column_ids) AND (value#>>'{}')::numeric BETWEEN 40 AND 1000),'{}'::jsonb),
      'frozenColumnCount',least((p_instance.state->'presentation'->>'frozenColumnCount')::integer,cardinality(all_column_ids)),
      'density',p_instance.state->'presentation'->>'density',
      'filters',coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM jsonb_array_elements(coalesce(p_instance.state->'presentation'->'filters','[]'::jsonb)) WITH ORDINALITY filter(value,ordinal) WHERE value->>'columnId'=ANY(all_column_ids) AND value->>'operator' IN ('is-empty','is-not-empty')),'[]'::jsonb),
      'sorts',coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM jsonb_array_elements(coalesce(p_instance.state->'presentation'->'sorts','[]'::jsonb)) WITH ORDINALITY sort(value,ordinal) WHERE value->>'columnId'=ANY(all_column_ids)),'[]'::jsonb)
    );
  ELSE
    presentation := jsonb_build_object('columnOrder',to_jsonb(all_column_ids),'hiddenColumnIds','[]'::jsonb,'columnWidths','{}'::jsonb,'frozenColumnCount',0,'density','standard','filters','[]'::jsonb,'sorts','[]'::jsonb);
  END IF;

  configuration := jsonb_build_object(
    'formatVersion',1,'parameters',parameters,'bindings',bindings,
    'rowIdentity',p_selection->'rowIdentity','joins',joins,'columns',columns,
    'calculations',calculations,'writeBackRules','[]'::jsonb,'actions','[]'::jsonb,
    'presentation',presentation
  );
  BEGIN
    PERFORM internal.validate_sheet_definition_configuration(configuration);
    FOR item IN SELECT value FROM jsonb_array_elements(p_selection->'bindings') LOOP
      SELECT value INTO source_item FROM jsonb_array_elements(p_instance.state->'bindings') WHERE value->>'bindingId'=item->>'bindingId';
      IF source_item->>'kind'='record' THEN
        IF NOT EXISTS(
          SELECT 1 FROM api.records record
          JOIN api.model_kinds model ON model.record_kind=record.kind AND model.identity_table='api.records'
          WHERE record.id=(source_item->>'recordId')::uuid AND record.workspace_id=p_instance.workspace_id
            AND record.deleted_at IS NULL AND model.key=item->'parameter'->'type'->>'modelKey'
        ) THEN RAISE EXCEPTION 'concrete Record does not satisfy the selected stable Model contract' USING ERRCODE='SB086'; END IF;
      ELSE
        IF source_item->'policy'->>'mode'='live' THEN
          SELECT schema_version_id INTO candidate_schema_version FROM api.datasets
            WHERE id=(source_item->>'datasetId')::uuid AND workspace_id=p_instance.workspace_id AND lifecycle='active';
        ELSE
          SELECT schema_version_id INTO candidate_schema_version FROM api.dataset_versions
            WHERE id=(source_item->'policy'->>'datasetVersionId')::uuid AND workspace_id=p_instance.workspace_id AND dataset_id=(source_item->>'datasetId')::uuid;
        END IF;
        IF candidate_schema_version IS NULL THEN RAISE EXCEPTION 'concrete Dataset source is unavailable for parameterisation' USING ERRCODE='SB086'; END IF;
        PERFORM internal.assert_dataset_parameter_compatible(item->'parameter'->'type'->'contract',candidate_schema_version,configuration,(item->>'bindingId')::uuid);
        candidate_schema_version:=NULL;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid extracted Definition configuration: %',SQLERRM USING ERRCODE='SB086';
  END;

  SELECT count(DISTINCT row_entry.key),count(cell.key)
    INTO local_row_count,local_cell_count
    FROM jsonb_each(p_instance.state->'localValues') row_entry
    LEFT JOIN LATERAL jsonb_object_keys(row_entry.value) cell(key) ON true;
  manifest := jsonb_build_object(
    'reusable',jsonb_build_object(
      'parameterIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(parameters) WITH ORDINALITY parameter(value,ordinal)),'[]'::jsonb),
      'bindingIds',to_jsonb(selected_binding_ids),'sourceColumnIds',to_jsonb(selected_column_ids),
      'joinIds',to_jsonb(selected_join_ids),'localFieldIds',to_jsonb(selected_local_field_ids),
      'calculationIds',to_jsonb(selected_calculation_ids),'presentationDefaultsIncluded',(p_selection->>'includePresentation')::boolean
    ),
    'excluded',jsonb_build_object(
      'concreteBindingValueBindingIds',to_jsonb(selected_binding_ids),
      'unselectedSourceColumnIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(source_config->'columns','[]'::jsonb)) WITH ORDINALITY source(value,ordinal) WHERE value->>'id'<>ALL(selected_column_ids)),'[]'::jsonb),
      'unselectedJoinIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(source_config->'joins','[]'::jsonb)) WITH ORDINALITY source(value,ordinal) WHERE value->>'id'<>ALL(selected_join_ids)),'[]'::jsonb),
      'unselectedLocalFieldIds',coalesce((SELECT jsonb_agg(value->>'fieldId' ORDER BY ordinal) FROM jsonb_array_elements(p_instance.state->'localFields') WITH ORDINALITY source(value,ordinal) WHERE value->>'fieldId'<>ALL(selected_local_field_ids)),'[]'::jsonb),
      'unselectedCalculationIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(p_instance.state->'instanceCalculations','[]'::jsonb)) WITH ORDINALITY source(value,ordinal) WHERE value->>'id'<>ALL(selected_calculation_ids)),'[]'::jsonb),
      'localValues',jsonb_build_object('rowCount',local_row_count,'cellCount',local_cell_count),
      'calculationOverrideIds',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(p_instance.state->'calculationOverrides') keys(key)),'[]'::jsonb),
      'calculationResults','all','writeBackRuleIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(source_config->'writeBackRules','[]'::jsonb)) WITH ORDINALITY source(value,ordinal)),'[]'::jsonb),
      'actionIds',coalesce((SELECT jsonb_agg(value->>'id' ORDER BY ordinal) FROM jsonb_array_elements(coalesce(source_config->'actions','[]'::jsonb)) WITH ORDINALITY source(value,ordinal)),'[]'::jsonb),
      'presentationValueFilterCount',(SELECT count(*) FROM jsonb_array_elements(coalesce(p_instance.state->'presentation'->'filters','[]'::jsonb)) filter WHERE filter->>'operator' IN ('equals','not-equals')),
      'presentationOutOfRangeWidthColumnIds',coalesce((SELECT jsonb_agg(key ORDER BY key) FROM jsonb_each(p_instance.state->'presentation'->'columnWidths') WHERE key=ANY(all_column_ids) AND (value#>>'{}')::numeric>1000),'[]'::jsonb),
      'rowIdentitiesDerivedFromValues','all'
    )
  );
  RETURN jsonb_build_object(
    'source',jsonb_build_object('instanceId',p_instance.id,'instanceRevision',p_instance.revision),
    'selection',p_selection,'configuration',configuration,'manifest',manifest
  );
EXCEPTION WHEN SQLSTATE 'SB071' THEN
  RAISE EXCEPTION 'invalid Definition extraction selection: %',SQLERRM USING ERRCODE='SB086';
END $$;

CREATE FUNCTION api.preview_sheet_definition_extraction(
  p_instance_id uuid,
  p_expected_instance_revision bigint,
  p_selection jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR SHARE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id)
  THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE='42501'; END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision
  THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  RETURN internal.build_sheet_definition_extraction_preview(instance,p_selection);
END $$;

CREATE FUNCTION api.extract_sheet_definition_draft(
  p_instance_id uuid,
  p_expected_instance_revision bigint,
  p_key text,
  p_name text,
  p_description text,
  p_selection jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; preview jsonb; definition api.sheet_definitions; version api.sheet_definition_versions; actor text:=api.current_user_id();
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR NOT api.is_sheet_definition_admin(instance.workspace_id)
  THEN RAISE EXCEPTION 'owner/admin required' USING ERRCODE='42501'; END IF;
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision
  THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' OR p_name IS NULL
     OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_description,''))>2000
  THEN RAISE EXCEPTION 'invalid Sheet Definition metadata' USING ERRCODE='SB071'; END IF;
  preview:=internal.build_sheet_definition_extraction_preview(instance,p_selection);
  INSERT INTO api.sheet_definitions(workspace_id,key,name,description,created_by_user_id,updated_by_user_id)
    VALUES(instance.workspace_id,p_key,btrim(p_name),nullif(btrim(p_description),''),actor,actor) RETURNING * INTO definition;
  INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id)
    VALUES(definition.id,1,preview->'configuration',actor,actor) RETURNING * INTO version;
  RETURN jsonb_build_object('definition',to_jsonb(definition),'version',to_jsonb(version),'preview',preview);
END $$;

REVOKE EXECUTE ON FUNCTION internal.build_sheet_definition_extraction_preview(api.sheet_instances,jsonb) FROM PUBLIC,authenticated,api_client;
REVOKE EXECUTE ON FUNCTION api.preview_sheet_definition_extraction(uuid,bigint,jsonb),api.extract_sheet_definition_draft(uuid,bigint,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.preview_sheet_definition_extraction(uuid,bigint,jsonb),api.extract_sheet_definition_draft(uuid,bigint,text,text,text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
