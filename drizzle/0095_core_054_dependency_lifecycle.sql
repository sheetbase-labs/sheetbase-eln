-- CORE-05.4 / 05.10: stable-ID dependency discovery and ADR 0023 lifecycle.

CREATE OR REPLACE FUNCTION internal.collect_uuid(p_value text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p_value IS NULL OR p_value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION internal.sheet_configuration_references(p_configuration jsonb)
RETURNS TABLE(kind text, object_id uuid)
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT DISTINCT refs.kind, refs.object_id
  FROM (
    SELECT 'dataset_schema_version'::text AS kind, internal.collect_uuid(param->'type'->'contract'->>'schemaVersionId') AS object_id
      FROM jsonb_array_elements(coalesce(p_configuration->'parameters','[]'::jsonb)) param
    UNION ALL
    SELECT 'dataset_schema_field', internal.collect_uuid(field_id)
      FROM jsonb_array_elements(coalesce(p_configuration->'parameters','[]'::jsonb)) param
      CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(param->'type'->'contract'->'requiredFieldIds','[]'::jsonb)) field_id
    UNION ALL
    SELECT 'dataset_schema_field', internal.collect_uuid(col->'source'->>'sourceFieldId')
      FROM jsonb_array_elements(coalesce(p_configuration->'columns','[]'::jsonb)) col
    UNION ALL
    SELECT 'dataset_schema_field', internal.collect_uuid(mapping->>'targetFieldId')
      FROM jsonb_array_elements(coalesce(p_configuration->'writeBackRules','[]'::jsonb)) rule
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(rule->'mappings','[]'::jsonb)) mapping
    UNION ALL
    SELECT 'sheet_definition_column', internal.collect_uuid(col->>'id')
      FROM jsonb_array_elements(coalesce(p_configuration->'columns','[]'::jsonb)) col
    UNION ALL
    SELECT 'sheet_definition_calculation', internal.collect_uuid(calc->>'id')
      FROM jsonb_array_elements(coalesce(p_configuration->'calculations','[]'::jsonb)) calc
  ) refs
  WHERE refs.object_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION internal.dependency_item(
  p_kind text, p_id uuid, p_relation text, p_liveness text, p_effect text, p_label text
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object(
    'kind', p_kind,
    'id', p_id,
    'relation', p_relation,
    'liveness', p_liveness,
    'effect', p_effect,
    'label', p_label
  )
$$;

CREATE OR REPLACE FUNCTION api.discover_object_dependencies(p_kind text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  items jsonb := '[]'::jsonb;
  schema_def api.dataset_schema_definitions;
  schema_ver api.dataset_schema_versions;
  sheet_def api.sheet_definitions;
  sheet_ver api.sheet_definition_versions;
  instance api.sheet_instances;
  dataset api.datasets;
  field_def api.record_field_definitions;
BEGIN
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_object_id IS NULL THEN
    RAISE EXCEPTION 'object kind and id are required' USING ERRCODE = '22023';
  END IF;

  IF p_kind = 'dataset_schema_version' THEN
    SELECT * INTO schema_ver FROM api.dataset_schema_versions WHERE id = p_object_id;
    SELECT * INTO schema_def FROM api.dataset_schema_definitions WHERE id = schema_ver.schema_id AND workspace_id = workspace;
    IF schema_def.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'dataset', d.id, 'binds_schema_version',
      CASE WHEN d.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
      'blocks_deletion', d.name
    ) ORDER BY d.name), '[]'::jsonb) INTO items
      FROM api.datasets d WHERE d.schema_version_id = p_object_id AND d.workspace_id = workspace;
    items := coalesce(items, '[]'::jsonb) || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'dataset_version', v.id, 'snapshot_schema_version', 'historical', 'blocks_deletion',
        coalesce(d.name, v.id::text)
      ) ORDER BY v.created_at)
      FROM api.dataset_versions v
      JOIN api.datasets d ON d.id = v.dataset_id
      WHERE v.schema_version_id = p_object_id AND v.workspace_id = workspace
    ), '[]'::jsonb);
    items := items || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'sheet_definition_version', version.id, 'configuration_schema_version',
        CASE WHEN version.lifecycle = 'published' AND definition.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'requires_migration', definition.name
      ) ORDER BY definition.key, version.version)
      FROM api.sheet_definition_versions version
      JOIN api.sheet_definitions definition ON definition.id = version.definition_id
      JOIN LATERAL internal.sheet_configuration_references(version.configuration) ref ON true
      WHERE definition.workspace_id = workspace
        AND ref.kind = 'dataset_schema_version'
        AND ref.object_id = p_object_id
    ), '[]'::jsonb);

  ELSIF p_kind = 'dataset_schema_field' THEN
    items := coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'dataset_schema_version', v.id, 'contains_field',
        CASE WHEN v.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        CASE WHEN v.lifecycle IN ('active','retired') THEN 'blocks_deletion' ELSE 'informational' END,
        s.key || ' v' || v.version::text
      ) ORDER BY s.key, v.version)
      FROM api.dataset_schema_version_fields f
      JOIN api.dataset_schema_versions v ON v.id = f.schema_version_id
      JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
      WHERE f.field_id = p_object_id AND s.workspace_id = workspace
    ), '[]'::jsonb);
    items := items || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'sheet_definition_version', version.id, 'configuration_field',
        CASE WHEN version.lifecycle = 'published' AND definition.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'requires_migration', definition.name
      ) ORDER BY definition.key)
      FROM api.sheet_definition_versions version
      JOIN api.sheet_definitions definition ON definition.id = version.definition_id
      JOIN LATERAL internal.sheet_configuration_references(version.configuration) ref ON true
      WHERE definition.workspace_id = workspace
        AND ref.kind = 'dataset_schema_field'
        AND ref.object_id = p_object_id
    ), '[]'::jsonb);

  ELSIF p_kind = 'dataset_schema_definition' THEN
    SELECT * INTO schema_def FROM api.dataset_schema_definitions WHERE id = p_object_id AND workspace_id = workspace;
    IF schema_def.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'dataset_schema_version', v.id, 'version_of_definition',
      CASE WHEN v.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
      CASE WHEN v.lifecycle IN ('active','retired') THEN 'blocks_deletion' ELSE 'informational' END,
      'v' || v.version::text
    ) ORDER BY v.version), '[]'::jsonb) INTO items
      FROM api.dataset_schema_versions v WHERE v.schema_id = schema_def.id;

  ELSIF p_kind = 'sheet_definition_version' THEN
    SELECT * INTO sheet_ver FROM api.sheet_definition_versions WHERE id = p_object_id;
    SELECT * INTO sheet_def FROM api.sheet_definitions WHERE id = sheet_ver.definition_id AND workspace_id = workspace;
    IF sheet_def.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_instance', i.id, 'pinned_definition_version',
      CASE WHEN i.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
      'blocks_deletion', i.name
    ) ORDER BY i.name), '[]'::jsonb) INTO items
      FROM api.sheet_instances i
     WHERE i.source_definition_version_id = p_object_id AND i.workspace_id = workspace;
    items := items || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'sheet_instance', u.instance_id, 'upgrade_provenance', 'historical', 'informational', 'upgrade'
      ))
      FROM api.sheet_instance_definition_upgrades u
      WHERE u.workspace_id = workspace
        AND (u.source_definition_version_id = p_object_id OR u.target_definition_version_id = p_object_id)
    ), '[]'::jsonb);

  ELSIF p_kind = 'sheet_definition' THEN
    SELECT * INTO sheet_def FROM api.sheet_definitions WHERE id = p_object_id AND workspace_id = workspace;
    IF sheet_def.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_definition_version', v.id, 'version_of_definition',
      CASE WHEN v.lifecycle = 'published' THEN 'active' ELSE 'historical' END,
      'informational', 'v' || v.version::text
    ) ORDER BY v.version), '[]'::jsonb) INTO items
      FROM api.sheet_definition_versions v WHERE v.definition_id = sheet_def.id;
    items := items || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'sheet_instance', i.id, 'pinned_definition_version',
        CASE WHEN i.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'blocks_deletion', i.name
      ) ORDER BY i.name)
      FROM api.sheet_instances i
      JOIN api.sheet_definition_versions v ON v.id = i.source_definition_version_id
      WHERE v.definition_id = sheet_def.id AND i.workspace_id = workspace
    ), '[]'::jsonb);

  ELSIF p_kind = 'dataset' THEN
    SELECT * INTO dataset FROM api.datasets WHERE id = p_object_id AND workspace_id = workspace;
    IF dataset.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'dataset_version', v.id, 'snapshot_of_dataset', 'historical', 'blocks_deletion', v.id::text
    ) ORDER BY v.created_at), '[]'::jsonb) INTO items
      FROM api.dataset_versions v WHERE v.dataset_id = dataset.id;
    items := items || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'sheet_instance', i.id, 'resolved_dataset_binding',
        CASE WHEN i.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'blocks_deletion', i.name
      ) ORDER BY i.name)
      FROM api.sheet_instances i
      WHERE i.workspace_id = workspace
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(i.state->'bindings','[]'::jsonb)) b
           WHERE b->>'datasetId' = dataset.id::text
        )
    ), '[]'::jsonb);

  ELSIF p_kind = 'sheet_instance' THEN
    SELECT * INTO instance FROM api.sheet_instances WHERE id = p_object_id AND workspace_id = workspace;
    IF instance.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    IF instance.source_definition_version_id IS NOT NULL THEN
      items := items || jsonb_build_array(internal.dependency_item(
        'sheet_definition_version', instance.source_definition_version_id, 'instance_source',
        'active', 'informational', 'pinned definition'
      ));
    END IF;

  ELSIF p_kind = 'model_field' THEN
    SELECT * INTO field_def FROM api.record_field_definitions WHERE id = p_object_id AND workspace_id = workspace;
    IF field_def.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    items := jsonb_build_array(internal.dependency_item(
      'model_field_usage', field_def.id, 'record_custom_field_count', 'informational', 'informational',
      coalesce(api.model_field_usage(field_def.id), 0)::text || ' records'
    ));

  ELSE
    RAISE EXCEPTION 'unsupported dependency kind' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'id', p_object_id,
    'dependencies', coalesce(items, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.preview_hard_delete(p_kind text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  discovered jsonb;
  blocking jsonb;
BEGIN
  discovered := api.discover_object_dependencies(p_kind, p_object_id);
  SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO blocking
    FROM jsonb_array_elements(discovered->'dependencies') value
   WHERE value->>'effect' = 'blocks_deletion';
  RETURN jsonb_build_object(
    'kind', p_kind,
    'id', p_object_id,
    'allowed', jsonb_array_length(blocking) = 0,
    'blocking', blocking,
    'dependencies', discovered->'dependencies'
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.execute_hard_delete(p_kind text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  preview jsonb;
  workspace uuid := api.current_workspace_id();
  schema_def api.dataset_schema_definitions;
  sheet_def api.sheet_definitions;
BEGIN
  preview := api.preview_hard_delete(p_kind, p_object_id);
  IF (preview->>'allowed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'protected dependencies block hard delete' USING ERRCODE = 'SB072';
  END IF;
  PERFORM api.require_capability(workspace, 'schema.retire');
  IF p_kind = 'dataset_schema_definition' THEN
    SELECT * INTO schema_def FROM api.dataset_schema_definitions WHERE id = p_object_id AND workspace_id = workspace;
    IF schema_def.lifecycle <> 'draft' OR EXISTS (
      SELECT 1 FROM api.dataset_schema_versions WHERE schema_id = schema_def.id AND lifecycle IN ('active','retired')
    ) THEN
      RAISE EXCEPTION 'only unused draft Dataset Schema Definitions may be hard-deleted' USING ERRCODE = 'SB072';
    END IF;
    DELETE FROM api.dataset_schema_definitions WHERE id = schema_def.id;
  ELSIF p_kind = 'sheet_definition' THEN
    SELECT * INTO sheet_def FROM api.sheet_definitions WHERE id = p_object_id AND workspace_id = workspace;
    IF EXISTS (
      SELECT 1 FROM api.sheet_instances i
      JOIN api.sheet_definition_versions v ON v.id = i.source_definition_version_id
      WHERE v.definition_id = sheet_def.id
    ) THEN
      RAISE EXCEPTION 'protected dependencies block hard delete' USING ERRCODE = 'SB072';
    END IF;
    RAISE EXCEPTION 'Sheet Definitions cannot be hard-deleted' USING ERRCODE = 'SB072';
  ELSE
    RAISE EXCEPTION 'hard delete is not permitted for this object kind' USING ERRCODE = 'SB072';
  END IF;
  RETURN jsonb_build_object('ok', true, 'kind', p_kind, 'id', p_object_id);
END;
$$;

CREATE OR REPLACE FUNCTION api.archive_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_member(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'active' THEN RAISE EXCEPTION 'Dataset is already archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'archived', revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;

CREATE OR REPLACE FUNCTION api.restore_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_member(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'archived' THEN RAISE EXCEPTION 'Dataset is not archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'active', revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;

CREATE OR REPLACE FUNCTION api.restore_sheet_instance(p_instance_id uuid, p_expected_revision bigint)
RETURNS api.sheet_instances
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; actor text := api.current_user_id();
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF instance.revision <> p_expected_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE = 'SB073'; END IF;
  IF instance.lifecycle <> 'archived' THEN RAISE EXCEPTION 'Sheet Instance is not archived' USING ERRCODE = 'SB073'; END IF;
  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true);
  UPDATE api.sheet_instances
     SET lifecycle = 'active', revision = revision + 1, updated_at = now(), updated_by_user_id = actor
   WHERE id = instance.id RETURNING * INTO instance;
  RETURN instance;
END $$;

CREATE OR REPLACE FUNCTION api.restore_sheet_definition(p_definition_id uuid, p_expected_revision bigint)
RETURNS api.sheet_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; actor text := api.current_user_id();
BEGIN
  SELECT * INTO definition FROM api.sheet_definitions WHERE id = p_definition_id FOR UPDATE;
  IF definition.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(definition.workspace_id, 'schema.retire');
  IF definition.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE = 'SB001'; END IF;
  IF definition.lifecycle <> 'retired' THEN RAISE EXCEPTION 'Sheet Definition is not retired' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.sheet_definitions
     SET lifecycle = 'active', revision = revision + 1, updated_at = now(), updated_by_user_id = actor
   WHERE id = definition.id RETURNING * INTO definition;
  RETURN definition;
END $$;

CREATE OR REPLACE FUNCTION api.restore_dataset_schema_definition(p_schema_definition_id uuid)
RETURNS api.dataset_schema_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.dataset_schema_definitions;
BEGIN
  SELECT * INTO definition FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id FOR UPDATE;
  IF definition.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(definition.workspace_id, 'schema.retire');
  IF definition.lifecycle <> 'retired' THEN RAISE EXCEPTION 'Dataset Schema Definition is not retired' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.dataset_schema_definitions
     SET lifecycle = CASE WHEN EXISTS (
       SELECT 1 FROM api.dataset_schema_versions WHERE schema_id = definition.id AND lifecycle = 'active'
     ) THEN 'active' ELSE 'draft' END,
         updated_at = now()
   WHERE id = definition.id RETURNING * INTO definition;
  RETURN definition;
END $$;

REVOKE EXECUTE ON FUNCTION
  internal.collect_uuid(text),
  internal.sheet_configuration_references(jsonb),
  internal.dependency_item(text, uuid, text, text, text, text)
  FROM PUBLIC, authenticated, api_client;
REVOKE EXECUTE ON FUNCTION
  api.discover_object_dependencies(text, uuid),
  api.preview_hard_delete(text, uuid),
  api.execute_hard_delete(text, uuid),
  api.archive_dataset(uuid, bigint),
  api.restore_dataset(uuid, bigint),
  api.restore_sheet_instance(uuid, bigint),
  api.restore_sheet_definition(uuid, bigint),
  api.restore_dataset_schema_definition(uuid)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.discover_object_dependencies(text, uuid),
  api.preview_hard_delete(text, uuid),
  api.execute_hard_delete(text, uuid),
  api.archive_dataset(uuid, bigint),
  api.restore_dataset(uuid, bigint),
  api.restore_sheet_instance(uuid, bigint),
  api.restore_sheet_definition(uuid, bigint),
  api.restore_dataset_schema_definition(uuid)
  TO authenticated;
GRANT DELETE ON api.dataset_schema_definitions TO CURRENT_USER;
NOTIFY pgrst, 'reload schema';
