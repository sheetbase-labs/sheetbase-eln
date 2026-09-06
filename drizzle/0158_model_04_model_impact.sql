-- MODEL-04: dependency-aware model evolution.
--
-- Deepens model dependency discovery beyond the usage count and gives
-- Stewards explicit upgrade/migration semantics:
--
-- 1. api.discover_model_dependencies(p_model_key text) — a model-grain
--    impact report over stable identities only (no name matching):
--    field definitions, host rows carrying custom values, MODEL-03
--    relationship rules referencing the model, Sheet Definition Versions
--    whose record parameters name the model, Sheet Instances binding a
--    record of the model, and Notebook Template Versions whose record
--    parameters name the model (plus placements pinning a dependent
--    Sheet version). Every scan is workspace-scoped; the function fails
--    closed (42501/22023) when the caller scope or the model key is
--    ambiguous instead of returning a silent empty list.
-- 2. The model_field branch of api.discover_object_dependencies now
--    enumerates up to 25 host rows carrying the field (same host CASE as
--    api.model_field_usage) and marks the usage item requires_migration
--    while any value is stored — retiring a carried field always needed
--    confirmation, the item just said informational before.
-- 3. api.preview_model_field_evolution gains a `guidance` array naming
--    what Stewards must do downstream. Local working state (Sheet
--    Instance state, template versions) is never touched by evolution:
--    apply only retires/updates the definition.
--
-- Tables are untouched, so no schema.ts change and no snapshot: this
-- follows the function-only 0095-0100 wrapper pattern.

CREATE FUNCTION api.discover_model_dependencies(p_model_key text)
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
    RAISE EXCEPTION 'model not found' USING ERRCODE = '42501';
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
REVOKE EXECUTE ON FUNCTION api.discover_model_dependencies(text)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.discover_model_dependencies(text)
  TO authenticated;
--> statement-breakpoint
-- Deepen the model_field branch: enumerate the host rows carrying the
-- field (same host CASE as api.model_field_usage, capped at 25 with a
-- truncation signal) and report requires_migration while any stored
-- value exists. Follows the 0098-0100 wrapper-chain pattern.
ALTER FUNCTION api.discover_object_dependencies(text, uuid)
  RENAME TO discover_object_dependencies_core158;
--> statement-breakpoint
CREATE FUNCTION api.discover_object_dependencies(p_kind text, p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  base jsonb;
  items jsonb;
  definition api.record_field_definitions;
  model api.model_kinds;
  sample jsonb := '[]'::jsonb;
  total bigint := 0;
  sampled integer := 0;
  truncated boolean := false;
BEGIN
  IF p_kind = 'model_field' THEN
    base := api.discover_object_dependencies_core158(p_kind, p_object_id);
    -- The core branch already raised for a missing or out-of-workspace
    -- definition; re-read it workspace-scoped so every scan below stays
    -- inside the verified workspace (fail closed, never cross-workspace).
    SELECT * INTO definition FROM api.record_field_definitions
     WHERE id = p_object_id AND workspace_id = workspace;
    IF definition.id IS NULL THEN
      RETURN base;
    END IF;
    SELECT * INTO model FROM api.model_kinds WHERE key = definition.kind;
    total := coalesce(api.model_field_usage(definition.id), 0);
    IF model.identity_table = 'api.records' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'record', r.id, 'carries_field_value',
          CASE WHEN r.archived_at IS NULL THEN 'active' ELSE 'historical' END,
          'requires_migration', r.identifier
        ) ORDER BY r.identifier), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.records
           WHERE workspace_id = workspace
             AND kind = coalesce(model.record_kind, definition.kind)
             AND custom_fields ? definition.field_name
           ORDER BY identifier LIMIT 26
        ) r;
    ELSIF model.identity_table = 'api.projects' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'project', p.id, 'carries_field_value',
          CASE WHEN p.status = 'active' THEN 'active' ELSE 'historical' END,
          'requires_migration', p.title
        ) ORDER BY p.title), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.projects
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY title LIMIT 26
        ) p;
    ELSIF model.identity_table = 'api.plate_designs' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'plate_design', p.id, 'carries_field_value',
          CASE WHEN p.status = 'archived' THEN 'historical' ELSE 'active' END,
          'requires_migration', p.name
        ) ORDER BY p.name), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.plate_designs
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY name LIMIT 26
        ) p;
    ELSIF model.identity_table = 'api.instruments' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'instrument', p.id, 'carries_field_value',
          'active', 'requires_migration', p.name
        ) ORDER BY p.name), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.instruments
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY name LIMIT 26
        ) p;
    ELSIF model.identity_table = 'api.instrument_runs' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'instrument_run', p.id, 'carries_field_value',
          'active', 'requires_migration', p.name
        ) ORDER BY p.name), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.instrument_runs
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY name LIMIT 26
        ) p;
    ELSIF model.identity_table = 'api.dataset_schemas' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'dataset_schema', p.id, 'carries_field_value',
          CASE WHEN p.status = 'published' THEN 'active' ELSE 'historical' END,
          'requires_migration', p.name
        ) ORDER BY p.name), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.dataset_schemas
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY name LIMIT 26
        ) p;
    ELSIF model.identity_table = 'api.scientific_tables' THEN
      SELECT coalesce(jsonb_agg(internal.dependency_item(
          'scientific_table', p.id, 'carries_field_value',
          CASE WHEN p.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
          'requires_migration', p.name
        ) ORDER BY p.name), '[]'::jsonb),
        count(*)
        INTO sample, sampled
        FROM (
          SELECT * FROM api.scientific_tables
           WHERE workspace_id = workspace
             AND custom_fields ? definition.field_name
           ORDER BY name LIMIT 26
        ) p;
    ELSE
      RAISE EXCEPTION 'model host is not supported for impact analysis' USING ERRCODE = '22023';
    END IF;
    IF sampled > 25 THEN
      truncated := true;
      SELECT coalesce(jsonb_agg(value), '[]'::jsonb) INTO sample
        FROM (
          SELECT value FROM jsonb_array_elements(sample)
          WITH ORDINALITY ORDER BY ordinality LIMIT 25
        ) s;
    END IF;
    items := coalesce(base->'dependencies', '[]'::jsonb);
    IF total > 0 THEN
      -- A stored value needs steward handling on retire: the count item
      -- previously claimed informational, which understated the gate
      -- (apply already requires explicit confirmation for retire).
      SELECT coalesce(jsonb_agg(
        CASE WHEN value->>'kind' = 'model_field_usage'
          THEN value || '{"effect":"requires_migration"}'::jsonb
          ELSE value END
      ), '[]'::jsonb) INTO items
      FROM jsonb_array_elements(items) value;
    END IF;
    items := items || coalesce(sample, '[]'::jsonb);
    RETURN jsonb_build_object(
      'kind', p_kind,
      'id', p_object_id,
      'dependencies', items,
      'truncated', truncated
    );
  END IF;
  RETURN api.discover_object_dependencies_core158(p_kind, p_object_id);
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.discover_object_dependencies_core158(text, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.discover_object_dependencies(text, uuid)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.discover_object_dependencies(text, uuid)
  TO authenticated;
--> statement-breakpoint
-- Explicit upgrade/migration semantics: the preview now names what the
-- Steward must do downstream. Same signature and gate behaviour; only a
-- `guidance` array is added. Local working state (Sheet Instance state,
-- template versions) is never touched — apply only retires or updates
-- the definition itself.
CREATE OR REPLACE FUNCTION api.preview_model_field_evolution(
  p_definition_id uuid,
  p_action text,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  field api.record_field_definitions;
  classification text := 'compatible';
  reason text := 'metadata';
  impact jsonb;
  usage bigint := 0;
  guidance text[] := '{}';
BEGIN
  SELECT * INTO field FROM api.record_field_definitions WHERE id = p_definition_id;
  IF field.id IS NULL THEN RAISE EXCEPTION 'Model field not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(field.workspace_id, 'schema.edit');
  usage := coalesce(api.model_field_usage(field.id), 0);
  IF p_action = 'retire' THEN
    classification := 'migration-requiring';
    reason := 'retire_field';
    IF usage > 0 THEN
      guidance := array[
        usage::text || ' record(s) of model "' || field.kind
          || '" carry a value for "' || field.label
          || '". Retiring locks the field for new and edited records; stored values stay readable in history and evidence and are never deleted.',
        'Review downstream consumers of model "' || field.kind
          || '" — Sheet record bindings, template record parameters and relationship rules — before confirming. Local Sheet working state is never auto-migrated.'
      ];
    ELSE
      guidance := array[
        'No records carry a value for "' || field.label
          || '". Retiring locks the field for new and edited records; there is nothing to migrate.'
      ];
    END IF;
  ELSIF p_action = 'update' THEN
    IF p_patch ?| ARRAY['logicalType','logical_type','key','field_name'] THEN
      classification := 'breaking';
      reason := 'identity_change_blocked';
      guidance := array[
        'The stable key and logical type are immutable once set. Create a new field and migrate consumers explicitly instead of reinterpreting this one.'
      ];
    ELSIF field.lifecycle IN ('active','retired') AND p_patch ?| ARRAY['nullable','defaultValue','validation'] THEN
      classification := 'breaking';
      reason := 'active_contract_immutable';
      guidance := array[
        'Nullable, default and validation rules are immutable while the field is ' || field.lifecycle
          || '. Retire and replace the field rather than silently reinterpreting stored values.'
      ];
    ELSE
      classification := 'compatible';
      reason := 'metadata';
      guidance := array[
        'Metadata-only change (label, description, display order). Stored values, frozen evidence and local working state are unaffected; no downstream migration is required.'
      ];
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported Model field action' USING ERRCODE = '22023';
  END IF;
  impact := api.discover_object_dependencies('model_field', field.id);
  RETURN jsonb_build_object(
    'classification', classification,
    'reason', reason,
    'blocked', classification = 'breaking',
    'impact', impact->'dependencies',
    'guidance', to_jsonb(guidance)
  );
END;
$$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
