-- Open a dataset in a sheet: tell rows apart by columns that always hold a value.
--
-- A row was told apart by its first columns, whether or not they could be empty.
-- A dataset whose early columns are optional (a link to a sample that only some
-- wells have, a condition left blank) then failed to open: "composed row is
-- missing its resolved identity value". The required columns come first now; a
-- dataset with none keeps the old rule.

CREATE OR REPLACE FUNCTION internal.ensure_dataset_sheet_definition(p_dataset api.datasets)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  def_key text;
  def_id uuid;
  version_id uuid;
  parameter_id uuid := gen_random_uuid();
  binding_id uuid := gen_random_uuid();
  column_ids jsonb;
  identity_ids jsonb;
  columns_json jsonb;
  config jsonb;
  schema_name text;
  actor text := api.current_user_id();
BEGIN
  def_key := 'columns_' || left(replace(p_dataset.schema_version_id::text, '-', ''), 16);

  SELECT v.id, v.configuration->'parameters'->0->>'id'
    INTO version_id, parameter_id
    FROM api.sheet_definitions d
    JOIN api.sheet_definition_versions v ON v.definition_id = d.id
   WHERE d.workspace_id = p_dataset.workspace_id AND d.key = def_key
     AND d.lifecycle = 'active' AND v.lifecycle = 'published'
   ORDER BY v.version DESC LIMIT 1;

  IF version_id IS NOT NULL THEN
    RETURN jsonb_build_object('versionId', version_id, 'parameterId', parameter_id);
  END IF;
  parameter_id := gen_random_uuid();

  SELECT coalesce(jsonb_agg(f.field_id ORDER BY f.display_order), '[]'::jsonb),
         coalesce(jsonb_agg(f.field_id ORDER BY f.display_order)
           FILTER (WHERE f.cardinality = 'one' AND NOT f.nullable),
           coalesce(jsonb_agg(f.field_id ORDER BY f.display_order)
             FILTER (WHERE f.cardinality = 'one'), '[]'::jsonb))
    INTO column_ids, identity_ids
    FROM (SELECT * FROM api.dataset_schema_version_fields
           WHERE schema_version_id = p_dataset.schema_version_id AND lifecycle = 'active'
           ORDER BY display_order LIMIT 256) f;

  IF jsonb_array_length(column_ids) = 0 OR jsonb_array_length(identity_ids) = 0 THEN
    RAISE EXCEPTION 'this dataset has no columns to show' USING ERRCODE = 'SB074';
  END IF;

  -- A row is told apart by its first columns together (up to eight), or by the
  -- only column there is.
  SELECT jsonb_agg(value) INTO identity_ids
    FROM (SELECT value FROM jsonb_array_elements(identity_ids) WITH ORDINALITY t(value, n)
           ORDER BY n LIMIT 8) s;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', f.field_id,
      'field', jsonb_build_object(
        'fieldId', f.field_id, 'key', f.key, 'label', f.label,
        'description', f.description, 'logicalType', f.logical_type,
        'nullable', f.nullable, 'defaultValue', coalesce(f.default_value, 'null'::jsonb),
        'cardinality', f.cardinality,
        'quantity', CASE WHEN f.quantity IS NULL THEN NULL ELSE jsonb_strip_nulls(jsonb_build_object(
          'kind', f.quantity->'kind', 'dimension', f.quantity->'dimension',
          'storageUnit', f.quantity->'storageUnit',
          'allowedInputUnits', f.quantity->'allowedInputUnits',
          'preferredDisplayUnit', f.quantity->'preferredDisplayUnit')) END,
        'validation', f.validation, 'category', f.category,
        'relationship', f.relationship,
        'computation', jsonb_build_object('mode', 'stored'), 'lifecycle', 'active'),
      'source', jsonb_build_object('kind', 'bound', 'bindingId', binding_id, 'sourceFieldId', f.field_id)
    ) ORDER BY f.display_order), '[]'::jsonb)
    INTO columns_json
    FROM (SELECT * FROM api.dataset_schema_version_fields
           WHERE schema_version_id = p_dataset.schema_version_id AND lifecycle = 'active'
           ORDER BY display_order LIMIT 256) f;

  config := jsonb_build_object(
    'formatVersion', 1,
    'parameters', jsonb_build_array(jsonb_build_object(
      'id', parameter_id, 'key', 'data', 'label', 'Data', 'required', true,
      'type', jsonb_build_object('kind', 'dataset', 'contract',
        jsonb_build_object('mode', 'exact', 'schemaVersionId', p_dataset.schema_version_id)),
      'constraints', '{}'::jsonb)),
    'bindings', jsonb_build_array(jsonb_build_object('id', binding_id, 'key', 'data', 'parameterId', parameter_id)),
    'rowIdentity', jsonb_build_object(
      'kind', CASE WHEN jsonb_array_length(identity_ids) = 1 THEN 'source' ELSE 'composite' END,
      'columnIds', identity_ids),
    'joins', '[]'::jsonb,
    'columns', columns_json,
    'calculations', '[]'::jsonb,
    'writeBackRules', '[]'::jsonb,
    'actions', '[]'::jsonb,
    'presentation', jsonb_build_object(
      'columnOrder', column_ids, 'hiddenColumnIds', '[]'::jsonb, 'columnWidths', '{}'::jsonb,
      'frozenColumnCount', 0, 'density', 'standard', 'filters', '[]'::jsonb, 'sorts', '[]'::jsonb));

  PERFORM internal.validate_sheet_definition_configuration(config);

  SELECT coalesce(s.name, p_dataset.name) INTO schema_name
    FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
   WHERE v.id = p_dataset.schema_version_id;

  INSERT INTO api.sheet_definitions(workspace_id, key, name, description, created_by_user_id, updated_by_user_id)
  VALUES (p_dataset.workspace_id, def_key, left(coalesce(schema_name, p_dataset.name), 200),
          'The columns of this measurement table, as a sheet. Made when its data was first opened in a sheet.',
          actor, actor)
  ON CONFLICT (workspace_id, key) DO UPDATE SET updated_at = now()
  RETURNING id INTO def_id;

  INSERT INTO api.sheet_definition_versions(definition_id, version, configuration,
                                            created_by_user_id, updated_by_user_id)
  VALUES (def_id,
          (SELECT coalesce(max(version), 0) + 1 FROM api.sheet_definition_versions WHERE definition_id = def_id),
          config, actor, actor)
  RETURNING id INTO version_id;

  UPDATE api.sheet_definition_versions
     SET lifecycle = 'published', revision = revision + 1, published_at = now(),
         published_by_user_id = actor, updated_at = now(), updated_by_user_id = actor
   WHERE id = version_id;

  RETURN jsonb_build_object('versionId', version_id, 'parameterId', parameter_id);
END $function$;
