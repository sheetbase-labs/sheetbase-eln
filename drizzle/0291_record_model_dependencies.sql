-- MDL-01 follow-up — model impact for workspace-defined record models (ADR-0051).
--
-- api.discover_model_dependencies resolved only global api.model_kinds, so a
-- workspace record model key (e.g. cell_bank) raised 42501 and the MDL-02
-- Usage tab could not report dependencies. Resolve a workspace model from
-- api.record_models (same workspace only) and treat it as an api.records host
-- with record_kind = key. The field, record, relationship, sheet and template
-- dependency classes are otherwise unchanged; no second engine.

CREATE OR REPLACE FUNCTION api.discover_model_dependencies(p_model_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  model api.model_kinds;
  items jsonb := '[]'::jsonb;
  class_items jsonb;
  class_count integer;
  truncated boolean := false;
  sheet_version_ids uuid[] := '{}';
BEGIN
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
  END IF;
  IF p_model_key IS NULL OR btrim(p_model_key) = '' THEN
    RAISE EXCEPTION 'model key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO model FROM api.model_kinds WHERE key = p_model_key;
  IF model.key IS NULL THEN
    -- ADR-0051: a workspace-defined record model is a record host too. Resolve
    -- it from this workspace's registry so the same field/record dependency
    -- classes apply. Only this workspace's model is visible (RLS + workspace
    -- filter); another workspace's key reads as not found.
    SELECT m.key INTO model.key
      FROM api.record_models m
      WHERE m.workspace_id = workspace AND m.key = p_model_key;
    IF model.key IS NULL THEN
      RAISE EXCEPTION 'model not found' USING ERRCODE = '42501';
    END IF;
    model.identity_table := 'api.records';
    model.record_kind := p_model_key;
    model.label := (
      SELECT m.name FROM api.record_models m
      WHERE m.workspace_id = workspace AND m.key = p_model_key
    );
  END IF;

  -- Field definitions of this model, annotated with their stored-value
  -- usage so the report shows which fields carry migration weight.
  SELECT coalesce(jsonb_agg(internal.dependency_item(
      'model_field', d.id, 'defines_field',
      CASE WHEN d.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
      'informational',
      d.label || ' (' || d.field_name || ') · '
        || coalesce(api.model_field_usage(d.id), 0)::text || ' records'
    ) ORDER BY d.field_name), '[]'::jsonb),
    count(*)
    INTO class_items, class_count
    FROM (
      SELECT * FROM api.record_field_definitions
       WHERE workspace_id = workspace AND kind = p_model_key
       ORDER BY field_name LIMIT 26
    ) d;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);

  -- Host rows carrying any custom value for this model (records via
  -- custom fields; other hosts via their own custom_fields column).
  IF model.identity_table = 'api.records' AND model.record_kind IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'record', r.id, 'carries_custom_values',
        CASE WHEN r.archived_at IS NULL THEN 'active' ELSE 'historical' END,
        'requires_migration', r.identifier
      ) ORDER BY r.identifier), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.records
         WHERE workspace_id = workspace AND kind = model.record_kind
           AND custom_fields <> '{}'::jsonb
         ORDER BY identifier LIMIT 26
      ) r;
  ELSIF model.identity_table = 'api.projects' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'project', p.id, 'carries_custom_values',
        CASE WHEN p.status = 'active' THEN 'active' ELSE 'historical' END,
        'requires_migration', p.title
      ) ORDER BY p.title), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.projects
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY title LIMIT 26
      ) p;
  ELSIF model.identity_table = 'api.plate_designs' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'plate_design', p.id, 'carries_custom_values',
        CASE WHEN p.status = 'archived' THEN 'historical' ELSE 'active' END,
        'requires_migration', p.name
      ) ORDER BY p.name), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.plate_designs
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY name LIMIT 26
      ) p;
  ELSIF model.identity_table = 'api.instruments' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'instrument', p.id, 'carries_custom_values',
        'active', 'requires_migration', p.name
      ) ORDER BY p.name), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.instruments
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY name LIMIT 26
      ) p;
  ELSIF model.identity_table = 'api.instrument_runs' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'instrument_run', p.id, 'carries_custom_values',
        'active', 'requires_migration', p.name
      ) ORDER BY p.name), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.instrument_runs
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY name LIMIT 26
      ) p;
  ELSIF model.identity_table = 'api.dataset_schemas' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'dataset_schema', p.id, 'carries_custom_values',
        CASE WHEN p.status = 'published' THEN 'active' ELSE 'historical' END,
        'requires_migration', p.name
      ) ORDER BY p.name), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.dataset_schemas
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY name LIMIT 26
      ) p;
  ELSIF model.identity_table = 'api.scientific_tables' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'scientific_table', p.id, 'carries_custom_values',
        CASE WHEN p.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'requires_migration', p.name
      ) ORDER BY p.name), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT * FROM api.scientific_tables
         WHERE workspace_id = workspace AND custom_fields <> '{}'::jsonb
         ORDER BY name LIMIT 26
      ) p;
  ELSE
    -- Unknown host table: fail closed rather than silently omitting the
    -- class — the report must never claim completeness it cannot prove.
    RAISE EXCEPTION 'model host is not supported for impact analysis' USING ERRCODE = '22023';
  END IF;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);

  -- MODEL-03 rules referencing this model as source or target.
  SELECT coalesce(jsonb_agg(internal.dependency_item(
      'model_relationship_rule', r.id,
      CASE WHEN r.source_model_key = p_model_key
        THEN 'constrains_source_links' ELSE 'referenced_as_target' END,
      'active',
      CASE WHEN r.source_model_key = p_model_key THEN 'requires_migration'
        ELSE 'informational' END,
      CASE WHEN r.source_model_key = p_model_key
        THEN r.link_type || ' → ' || r.target_model_key
          || ' (' || r.min_links::text || '–' || coalesce(r.max_links::text, '∞') || ')'
          || coalesce(' · “' || r.label || '”', '')
        ELSE r.source_model_key || ' · ' || r.link_type || ' → ' || r.target_model_key
      END
    ) ORDER BY r.source_model_key, r.link_type, r.target_model_key), '[]'::jsonb),
    count(*)
    INTO class_items, class_count
    FROM (
      SELECT * FROM api.model_relationship_rules
       WHERE workspace_id = workspace
         AND (source_model_key = p_model_key OR target_model_key = p_model_key)
       ORDER BY source_model_key, link_type, target_model_key LIMIT 26
    ) r;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);

  -- Sheets via record parameters: definition versions whose configuration
  -- declares a record parameter bound to this model (stable modelKey,
  -- same shape internal.validate_parameter enforces).
  SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_definition_version', v.id, 'parameter_model_contract',
      CASE WHEN v.lifecycle = 'published' AND d.lifecycle = 'active'
        THEN 'active' ELSE 'historical' END,
      'requires_migration', d.name || ' v' || v.version::text
    ) ORDER BY d.key, v.version), '[]'::jsonb),
    count(*)
    INTO class_items, class_count
    FROM (
      SELECT v.* FROM api.sheet_definition_versions v
      JOIN api.sheet_definitions d ON d.id = v.definition_id
      WHERE d.workspace_id = workspace
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            coalesce(v.configuration->'parameters', '[]'::jsonb)) param
          WHERE param->'type'->>'kind' = 'record'
            AND param->'type'->>'modelKey' = p_model_key
        )
      ORDER BY d.key, v.version LIMIT 26
    ) v
    JOIN api.sheet_definitions d ON d.id = v.definition_id;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);
  SELECT coalesce(array_agg((value->>'id')::uuid), '{}') INTO sheet_version_ids
    FROM jsonb_array_elements(items) value
   WHERE value->>'kind' = 'sheet_definition_version';

  -- Sheets via bindings/record links: instances binding a record whose
  -- model is this model. Record IDs resolve through api.records so a
  -- malformed binding can never leak or match across workspaces
  -- (internal.collect_uuid returns NULL instead of raising).
  SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_instance', i.id, 'binds_model_record',
      CASE WHEN i.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
      'requires_migration', i.name
    ) ORDER BY i.name), '[]'::jsonb),
    count(*)
    INTO class_items, class_count
    FROM (
      SELECT i.* FROM api.sheet_instances i
      WHERE i.workspace_id = workspace
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            coalesce(i.state->'bindings', '[]'::jsonb)) b
          JOIN api.records r
            ON r.id = internal.collect_uuid(b->>'recordId')
          JOIN api.model_kinds m
            ON m.record_kind = r.kind
           AND m.identity_table = 'api.records'
          WHERE b->>'kind' = 'record'
            AND r.workspace_id = workspace
            AND m.key = p_model_key
        )
      ORDER BY i.name LIMIT 26
    ) i;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);

  -- Templates via record parameters: template versions declaring a record
  -- parameter bound to this model (same validate_parameter shape).
  SELECT coalesce(jsonb_agg(internal.dependency_item(
      'notebook_template_version', v.id, 'parameter_model_contract',
      CASE WHEN v.lifecycle = 'published' THEN 'active' ELSE 'historical' END,
      'requires_migration', t.key || ' v' || v.version::text
    ) ORDER BY t.key, v.version), '[]'::jsonb),
    count(*)
    INTO class_items, class_count
    FROM (
      SELECT v.* FROM api.notebook_template_versions v
      JOIN api.notebook_templates t ON t.id = v.template_id
      WHERE t.workspace_id = workspace
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(
            coalesce(v.configuration->'parameters', '[]'::jsonb)) param
          WHERE param->'type'->>'kind' = 'record'
            AND param->'type'->>'modelKey' = p_model_key
        )
      ORDER BY t.key, v.version LIMIT 26
    ) v
    JOIN api.notebook_templates t ON t.id = v.template_id;
  IF class_count > 25 THEN
    truncated := true;
    SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
      FROM (
        SELECT value FROM jsonb_array_elements(class_items)
        WITH ORDINALITY ORDER BY ordinality LIMIT 25
      ) s;
  END IF;
  items := items || coalesce(class_items, '[]'::jsonb);

  -- Templates via placements: versions pinning a dependent Sheet version
  -- found above. Informational: the sheet dependency itself carries the
  -- migration weight; the template only names a consequence.
  IF sheet_version_ids <> '{}' THEN
    SELECT coalesce(jsonb_agg(internal.dependency_item(
        'notebook_template_version', v.id, 'pins_dependent_sheet',
        CASE WHEN v.lifecycle = 'published' THEN 'active' ELSE 'historical' END,
        'informational', t.key || ' v' || v.version::text
      ) ORDER BY t.key, v.version), '[]'::jsonb),
      count(*)
      INTO class_items, class_count
      FROM (
        SELECT v.* FROM api.notebook_template_versions v
        JOIN api.notebook_templates t ON t.id = v.template_id
        WHERE t.workspace_id = workspace
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              coalesce(v.configuration->'placements', '[]'::jsonb)) placement
            WHERE placement->>'kind' = 'sheet'
              AND internal.collect_uuid(placement->>'definitionVersionId')
                = ANY(sheet_version_ids)
          )
        ORDER BY t.key, v.version LIMIT 26
      ) v
      JOIN api.notebook_templates t ON t.id = v.template_id;
    IF class_count > 25 THEN
      truncated := true;
      SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO class_items
        FROM (
          SELECT value FROM jsonb_array_elements(class_items)
          WITH ORDINALITY ORDER BY ordinality LIMIT 25
        ) s;
    END IF;
    items := items || coalesce(class_items, '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'kind', 'model',
    'id', p_model_key,
    'dependencies', coalesce(items, '[]'::jsonb),
    'truncated', truncated
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.discover_model_dependencies(text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.discover_model_dependencies(text) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
