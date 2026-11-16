-- Open a dataset in a sheet, with no steward needed.
--
-- A sheet shows a dataset through a published sheet definition that takes the
-- dataset as an input. A dataset made from a file has no such definition, so
-- "Open in a sheet" used to stop at "ask a steward". This writes the missing
-- definition from the dataset's own columns, once per measurement table
-- version, and makes the sheet from it.
--
-- The definition only mirrors the columns the dataset already has: it adds no
-- rule, calculation or write-back, so it needs no authoring right. Whoever may
-- edit the notebook or the project (and so make a sheet) may open the data.

CREATE FUNCTION internal.ensure_dataset_sheet_definition(p_dataset api.datasets)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
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
           FILTER (WHERE f.cardinality = 'one'), '[]'::jsonb)
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
END $$;

ALTER FUNCTION internal.ensure_dataset_sheet_definition(api.datasets) OWNER TO migrator;
REVOKE ALL ON FUNCTION internal.ensure_dataset_sheet_definition(api.datasets) FROM PUBLIC;

CREATE FUNCTION api.open_dataset_in_sheet(
  p_dataset_id uuid,
  p_name text DEFAULT NULL,
  p_notebook_record_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_after_block_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  dataset api.datasets;
  notebook api.records;
  definition jsonb;
  instance api.sheet_instances;
  placed jsonb;
  sheet_name text;
  project uuid;
BEGIN
  SELECT * INTO dataset FROM api.datasets
   WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id() AND lifecycle = 'active';
  IF dataset.id IS NULL OR NOT api.is_workspace_writer(dataset.workspace_id) THEN
    RAISE EXCEPTION 'Dataset unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('dataset', dataset.id, 'view');

  IF p_notebook_record_id IS NOT NULL THEN
    SELECT * INTO notebook FROM api.records WHERE id = p_notebook_record_id;
    IF notebook.id IS NULL THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
    END IF;
  END IF;

  project := coalesce(p_project_id, notebook.project_id, dataset.primary_project_id);
  sheet_name := coalesce(nullif(btrim(p_name), ''), dataset.name);
  definition := internal.ensure_dataset_sheet_definition(dataset);

  instance := api.create_sheet_instance_from_definition(
    dataset.workspace_id, left(sheet_name, 200), NULL,
    (definition->>'versionId')::uuid, project, p_notebook_record_id,
    jsonb_build_object(
      'bindings', '[]'::jsonb, 'localFields', '[]'::jsonb, 'localValues', '{}'::jsonb,
      'calculationOverrides', '{}'::jsonb,
      'provenance', jsonb_build_object('createdFrom', 'definition_version')),
    jsonb_build_array(jsonb_build_object(
      'parameterId', definition->>'parameterId', 'kind', 'dataset', 'datasetId', dataset.id)));
  instance := api.resolve_sheet_instance_row_identity(instance.id, instance.revision);

  IF p_notebook_record_id IS NOT NULL THEN
    placed := api.insert_sheet_instance_block(p_notebook_record_id, p_after_block_id, NULL, instance.id);
  END IF;

  RETURN jsonb_build_object(
    'instance', to_jsonb(instance),
    'definitionVersionId', definition->>'versionId',
    'block', placed->'block');
END $$;

ALTER FUNCTION api.open_dataset_in_sheet(uuid, text, uuid, uuid, uuid) OWNER TO migrator;
REVOKE ALL ON FUNCTION api.open_dataset_in_sheet(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.open_dataset_in_sheet(uuid, text, uuid, uuid, uuid) TO authenticated, api_client;
--> statement-breakpoint
-- The pipeline action. Mirrors src/features/data-in/operations.ts.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('open_dataset_in_sheet', '{"operation":"open_dataset_in_sheet","rpc":"open_dataset_in_sheet","label":"Open a dataset in a sheet","description":"Makes a new sheet that shows every column and row of a dataset, and puts it in a notebook when you name one. No steward-made sheet definition is needed: the columns come from the dataset itself. Returns `{ instance, definitionVersionId, block }`; `block` is the notebook block when a notebook was named.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":false,"nullable":true},{"name":"p_notebook_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_after_block_id","type":"uuid","required":false,"nullable":true}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
