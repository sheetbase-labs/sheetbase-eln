-- CORE-06.5 / 06.6 / 06.10: instantiate independent Sheet Instances from
-- published Template Versions, explicit shared embeddings, and explicit
-- Template/Notebook upgrades. Existing published versions and Notebooks
-- are never silently mutated.

CREATE TABLE api.notebook_template_instantiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  actor_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  template_version_id uuid NOT NULL REFERENCES api.notebook_template_versions(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE RESTRICT,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notebook_template_instantiations_actor_key
    UNIQUE (workspace_id, actor_user_id, idempotency_key),
  CONSTRAINT chk_notebook_template_instantiations_key
    CHECK (length(idempotency_key) BETWEEN 1 AND 128)
);

CREATE TABLE api.notebook_template_upgrades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE RESTRICT,
  source_version_id uuid NOT NULL REFERENCES api.notebook_template_versions(id) ON DELETE RESTRICT,
  target_version_id uuid NOT NULL REFERENCES api.notebook_template_versions(id) ON DELETE RESTRICT,
  decisions jsonb NOT NULL,
  actor_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api.notebook_template_instantiations ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.notebook_template_upgrades ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.notebook_template_instantiations, api.notebook_template_upgrades TO authenticated;
CREATE POLICY notebook_template_instantiations_read ON api.notebook_template_instantiations
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY notebook_template_upgrades_read ON api.notebook_template_upgrades
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));

CREATE FUNCTION internal.template_parameter_inputs_for_placement(
  p_placement jsonb,
  p_template_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  mapping jsonb;
  input jsonb;
  mapped jsonb := '[]'::jsonb;
  found jsonb;
BEGIN
  FOR mapping IN SELECT value FROM jsonb_array_elements(coalesce(p_placement->'parameterMappings','[]'::jsonb)) LOOP
    found := NULL;
    SELECT value INTO found
      FROM jsonb_array_elements(coalesce(p_template_inputs,'[]'::jsonb)) value
      WHERE value->>'parameterId' = mapping->>'templateParameterId';
    IF found IS NULL THEN
      CONTINUE;
    END IF;
    input := found || jsonb_build_object('parameterId', mapping->>'definitionParameterId');
    mapped := mapped || jsonb_build_array(input);
  END LOOP;
  RETURN mapped;
END
$$;

CREATE FUNCTION internal.definition_derived_instance_state()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'bindings', '[]'::jsonb,
    'localFields', '[]'::jsonb,
    'localValues', '{}'::jsonb,
    'calculationOverrides', '{}'::jsonb
  )
$$;

CREATE FUNCTION api.sheet_instance_notebook_embeddings(p_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  instance api.sheet_instances;
  items jsonb;
BEGIN
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'Sheet Instance not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO instance FROM api.sheet_instances
    WHERE id = p_instance_id AND workspace_id = workspace;
  IF instance.id IS NULL THEN
    RAISE EXCEPTION 'Sheet Instance not found' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'blockId', b.id,
    'recordId', r.id,
    'identifier', r.identifier,
    'title', r.title
  ) ORDER BY r.identifier, b.id), '[]'::jsonb) INTO items
  FROM api.blocks b
  JOIN api.records r ON r.id = b.record_id
  WHERE r.workspace_id = workspace
    AND b.type = 'sheet'
    AND b.payload->>'instanceId' = p_instance_id::text;
  RETURN jsonb_build_object(
    'instanceId', p_instance_id,
    'count', jsonb_array_length(coalesce(items,'[]'::jsonb)),
    'embeddings', coalesce(items,'[]'::jsonb)
  );
END
$$;

CREATE FUNCTION api.instantiate_notebook_template_version(
  p_version_id uuid,
  p_target_project_id uuid,
  p_title text,
  p_parameter_inputs jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
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
  mapped jsonb;
  title text;
  result jsonb;
BEGIN
  IF workspace IS NULL OR actor IS NULL OR NOT api.is_workspace_member(workspace) THEN
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
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(coalesce(version.configuration->'parameters','[]'::jsonb)) parameter
      WHERE coalesce((parameter->>'required')::boolean, false)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(p_parameter_inputs,'[]'::jsonb)) input
          WHERE input->>'parameterId' = parameter->>'id'
        )
  ) THEN
    RAISE EXCEPTION 'required Template parameter was not supplied' USING ERRCODE = 'SB091';
  END IF;

  rec := api.create_record(p_target_project_id, 'experiment', title, 'draft', '{}'::text[], '{}'::jsonb);
  UPDATE api.records
    SET source_notebook_template_version_id = version.id
    WHERE id = rec.id;

  FOR placement IN
    SELECT value FROM jsonb_array_elements(coalesce(version.configuration->'placements','[]'::jsonb)) value
    ORDER BY (value->>'order')::int, value->>'id'
  LOOP
    IF placement->>'kind' = 'narrative' THEN
      PERFORM api.insert_block(
        rec.id,
        placement->>'blockType',
        placement->'payload',
        1,
        NULL,
        NULL
      );
    ELSIF placement->>'kind' = 'sheet' THEN
      mapped := internal.template_parameter_inputs_for_placement(placement, coalesce(p_parameter_inputs,'[]'::jsonb));
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
      inserted := api.insert_sheet_instance_block(rec.id, NULL, NULL, instance.id);
    END IF;
  END LOOP;

  SELECT * INTO rec FROM api.records WHERE id = rec.id;
  result := jsonb_build_object(
    'record', to_jsonb(rec),
    'templateVersionId', version.id,
    'idempotent', false
  );
  INSERT INTO api.notebook_template_instantiations(
    workspace_id, actor_user_id, idempotency_key, template_version_id, record_id, result
  ) VALUES (workspace, actor, p_idempotency_key, version.id, rec.id, result);
  RETURN result;
END
$$;

CREATE FUNCTION api.preview_notebook_template_upgrade(
  p_record_id uuid,
  p_target_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  rec api.records;
  source api.notebook_template_versions;
  target api.notebook_template_versions;
  source_tmpl api.notebook_templates;
  target_tmpl api.notebook_templates;
  placement jsonb;
  target_placement jsonb;
  block api.blocks;
  conflicts jsonb := '[]'::jsonb;
  automatic jsonb := '[]'::jsonb;
  instance_preview jsonb;
BEGIN
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO rec FROM api.records WHERE id = p_record_id AND workspace_id = workspace;
  IF rec.id IS NULL OR rec.source_notebook_template_version_id IS NULL THEN
    RAISE EXCEPTION 'Notebook is not based on a Template Version' USING ERRCODE = 'SB090';
  END IF;
  SELECT * INTO source FROM api.notebook_template_versions WHERE id = rec.source_notebook_template_version_id;
  SELECT * INTO target FROM api.notebook_template_versions WHERE id = p_target_version_id;
  SELECT * INTO source_tmpl FROM api.notebook_templates WHERE id = source.template_id;
  SELECT * INTO target_tmpl FROM api.notebook_templates WHERE id = target.template_id;
  IF target.id IS NULL OR target.lifecycle <> 'published'
     OR source_tmpl.id IS DISTINCT FROM target_tmpl.id
     OR target.version <= source.version
     OR source_tmpl.workspace_id IS DISTINCT FROM workspace THEN
    RAISE EXCEPTION 'target must be a newer published Version of the same Template' USING ERRCODE = 'SB090';
  END IF;

  FOR placement IN SELECT value FROM jsonb_array_elements(coalesce(source.configuration->'placements','[]'::jsonb)) LOOP
    SELECT value INTO target_placement
      FROM jsonb_array_elements(coalesce(target.configuration->'placements','[]'::jsonb)) value
      WHERE value->>'id' = placement->>'id';
    IF target_placement IS NULL THEN
      automatic := automatic || jsonb_build_array(jsonb_build_object(
        'kind','placement-removed','placementId',placement->>'id'
      ));
    ELSIF placement->>'kind' = 'sheet' AND target_placement->>'kind' = 'sheet'
       AND placement->>'definitionVersionId' IS DISTINCT FROM target_placement->>'definitionVersionId' THEN
      SELECT b.* INTO block
        FROM api.blocks b
        WHERE b.record_id = rec.id AND b.type = 'sheet'
          AND b.payload->>'instanceId' IS NOT NULL
        ORDER BY b."order"
        LIMIT 1;
      -- Prefer the block whose Instance was created for this placement by matching
      -- current definition version when unique.
      SELECT b.* INTO block
        FROM api.blocks b
        JOIN api.sheet_instances i ON i.id = (b.payload->>'instanceId')::uuid
        WHERE b.record_id = rec.id AND b.type = 'sheet'
          AND i.source_definition_version_id = (placement->>'definitionVersionId')::uuid
        ORDER BY b.id
        LIMIT 1;
      IF block.id IS NULL THEN
        conflicts := conflicts || jsonb_build_array(jsonb_build_object(
          'id','placement:'||(placement->>'id'),
          'kind','sheet-placement-unresolved',
          'placementId',placement->>'id',
          'allowedOutcomes', jsonb_build_array('keep')
        ));
      ELSE
        instance_preview := api.preview_sheet_instance_definition_upgrade(
          (block.payload->>'instanceId')::uuid,
          (SELECT revision FROM api.sheet_instances WHERE id = (block.payload->>'instanceId')::uuid),
          (target_placement->>'definitionVersionId')::uuid
        );
        IF jsonb_array_length(coalesce(instance_preview->'conflicts','[]'::jsonb)) = 0 THEN
          automatic := automatic || jsonb_build_array(jsonb_build_object(
            'kind','sheet-definition-compatible',
            'placementId',placement->>'id',
            'blockId',block.id,
            'instanceId',block.payload->>'instanceId',
            'targetDefinitionVersionId',target_placement->>'definitionVersionId'
          ));
        ELSE
          conflicts := conflicts || jsonb_build_array(jsonb_build_object(
            'id','placement:'||(placement->>'id'),
            'kind','sheet-definition-conflict',
            'placementId',placement->>'id',
            'blockId',block.id,
            'instanceId',block.payload->>'instanceId',
            'allowedOutcomes', jsonb_build_array('keep','retarget'),
            'instancePreview', instance_preview
          ));
        END IF;
      END IF;
    END IF;
    target_placement := NULL;
  END LOOP;

  FOR target_placement IN SELECT value FROM jsonb_array_elements(coalesce(target.configuration->'placements','[]'::jsonb)) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(source.configuration->'placements','[]'::jsonb)) value
      WHERE value->>'id' = target_placement->>'id'
    ) THEN
      automatic := automatic || jsonb_build_array(jsonb_build_object(
        'kind','placement-added','placementId',target_placement->>'id'
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'recordId', rec.id,
    'sourceVersionId', source.id,
    'targetVersionId', target.id,
    'automatic', automatic,
    'conflicts', conflicts
  );
END
$$;

CREATE OR REPLACE FUNCTION internal.guard_record_template_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.source_notebook_template_version_id IS NOT NULL
     AND NEW.source_notebook_template_version_id IS DISTINCT FROM OLD.source_notebook_template_version_id
     AND coalesce(current_setting('sheetbase.notebook_template_upgrade', true), '') <> 'v1' THEN
    RAISE EXCEPTION 'Notebook Template Version association is immutable' USING ERRCODE = 'SB090';
  END IF;
  RETURN NEW;
END
$$;

CREATE FUNCTION api.retarget_notebook_template_sheet_placement(
  p_version_id uuid,
  p_expected_revision bigint,
  p_placement_id uuid,
  p_target_definition_version_id uuid
)
RETURNS api.notebook_template_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result api.notebook_template_versions;
  template api.notebook_templates;
  config jsonb;
  actor text := api.current_user_id();
BEGIN
  SELECT * INTO result FROM api.notebook_template_versions WHERE id = p_version_id FOR UPDATE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE = '42501'; END IF;
  SELECT * INTO template FROM api.notebook_templates WHERE id = result.template_id FOR UPDATE;
  PERFORM api.require_capability(template.workspace_id, 'schema.edit');
  IF result.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Notebook Template Versions can retarget Sheet placements' USING ERRCODE = 'SB090';
  END IF;
  IF result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Notebook Template Version revision' USING ERRCODE = 'SB001';
  END IF;
  config := result.configuration;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(config->'placements') value
    WHERE value->>'id' = p_placement_id::text AND value->>'kind' = 'sheet'
  ) THEN
    RAISE EXCEPTION 'Sheet placement not found' USING ERRCODE = 'SB091';
  END IF;
  config := jsonb_set(
    config,
    '{placements}',
    (
      SELECT jsonb_agg(
        CASE WHEN value->>'id' = p_placement_id::text AND value->>'kind' = 'sheet'
          THEN jsonb_set(value,'{definitionVersionId}', to_jsonb(p_target_definition_version_id::text))
          ELSE value
        END
        ORDER BY (value->>'order')::int, value->>'id'
      )
      FROM jsonb_array_elements(config->'placements') value
    )
  );
  PERFORM internal.validate_notebook_template_configuration(template.workspace_id, config);
  UPDATE api.notebook_template_versions
    SET configuration = config, revision = revision + 1, updated_at = now(), updated_by_user_id = actor
    WHERE id = result.id
  RETURNING * INTO result;
  RETURN result;
END
$$;

CREATE FUNCTION api.apply_notebook_template_upgrade(
  p_record_id uuid,
  p_expected_structure_version int,
  p_target_version_id uuid,
  p_decisions jsonb,
  p_parameter_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  preview jsonb;
  rec api.records;
  actor text := api.current_user_id();
  conflict jsonb;
  decision jsonb;
  item jsonb;
  target api.notebook_template_versions;
  target_placement jsonb;
  mapped jsonb;
  instance api.sheet_instances;
  apply_result jsonb;
BEGIN
  IF workspace IS NULL OR actor IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO rec FROM api.records WHERE id = p_record_id AND workspace_id = workspace FOR UPDATE;
  IF rec.id IS NULL THEN RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501'; END IF;
  IF rec.locked_at IS NOT NULL THEN RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011'; END IF;
  IF rec.structure_version <> p_expected_structure_version THEN
    RAISE EXCEPTION 'structure version mismatch: expected %, got %',
      p_expected_structure_version, rec.structure_version USING ERRCODE = 'SB001';
  END IF;
  preview := api.preview_notebook_template_upgrade(p_record_id, p_target_version_id);
  IF jsonb_typeof(coalesce(p_decisions,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'upgrade decisions are required' USING ERRCODE = 'SB090';
  END IF;
  FOR conflict IN SELECT value FROM jsonb_array_elements(coalesce(preview->'conflicts','[]'::jsonb)) LOOP
    SELECT value INTO decision
      FROM jsonb_array_elements(p_decisions) value
      WHERE value->>'conflictId' = conflict->>'id';
    IF decision IS NULL OR NOT (conflict->'allowedOutcomes' @> jsonb_build_array(decision->>'outcome')) THEN
      RAISE EXCEPTION 'invalid or stale Template upgrade decision' USING ERRCODE = 'SB090';
    END IF;
  END LOOP;

  FOR conflict IN SELECT value FROM jsonb_array_elements(coalesce(preview->'conflicts','[]'::jsonb)) LOOP
    SELECT value INTO decision FROM jsonb_array_elements(p_decisions) value WHERE value->>'conflictId' = conflict->>'id';
    IF decision->>'outcome' = 'retarget' THEN
      SELECT * INTO target FROM api.notebook_template_versions WHERE id = p_target_version_id;
      SELECT value INTO target_placement
        FROM jsonb_array_elements(target.configuration->'placements') value
        WHERE value->>'id' = conflict->>'placementId';
      mapped := internal.template_parameter_inputs_for_placement(
        target_placement, coalesce(p_parameter_inputs,'[]'::jsonb)
      );
      apply_result := api.apply_sheet_instance_definition_upgrade(
        (conflict->>'instanceId')::uuid,
        (SELECT si.revision FROM api.sheet_instances si WHERE si.id = (conflict->>'instanceId')::uuid),
        (target_placement->>'definitionVersionId')::uuid,
        coalesce(decision->'instanceDecisions','[]'::jsonb),
        mapped
      );
      IF apply_result->>'status' IS DISTINCT FROM 'applied' THEN
        RAISE EXCEPTION 'Sheet Instance upgrade did not apply' USING ERRCODE = 'SB090';
      END IF;
    END IF;
  END LOOP;

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(preview->'automatic','[]'::jsonb)) LOOP
    IF item->>'kind' = 'sheet-definition-compatible' THEN
      SELECT * INTO target FROM api.notebook_template_versions WHERE id = p_target_version_id;
      SELECT value INTO target_placement
        FROM jsonb_array_elements(target.configuration->'placements') value
        WHERE value->>'id' = item->>'placementId';
      mapped := internal.template_parameter_inputs_for_placement(
        coalesce(target_placement, '{"parameterMappings":[]}'::jsonb),
        coalesce(p_parameter_inputs,'[]'::jsonb)
      );
      PERFORM api.apply_sheet_instance_definition_upgrade(
        (item->>'instanceId')::uuid,
        (SELECT si.revision FROM api.sheet_instances si WHERE si.id = (item->>'instanceId')::uuid),
        (item->>'targetDefinitionVersionId')::uuid,
        '[]'::jsonb,
        mapped
      );
    ELSIF item->>'kind' = 'placement-added' THEN
      SELECT * INTO target FROM api.notebook_template_versions WHERE id = p_target_version_id;
      SELECT value INTO target_placement
        FROM jsonb_array_elements(target.configuration->'placements') value
        WHERE value->>'id' = item->>'placementId';
      IF target_placement->>'kind' = 'narrative' THEN
        PERFORM api.insert_block(rec.id, target_placement->>'blockType', target_placement->'payload', 1, NULL, NULL);
      ELSIF target_placement->>'kind' = 'sheet' THEN
        mapped := internal.template_parameter_inputs_for_placement(target_placement, coalesce(p_parameter_inputs,'[]'::jsonb));
        instance := api.create_sheet_instance_from_definition(
          rec.workspace_id,
          coalesce(nullif(btrim(target_placement->>'title'),''), 'Notebook sheet'),
          NULL,
          (target_placement->>'definitionVersionId')::uuid,
          rec.project_id,
          rec.id,
          internal.definition_derived_instance_state(),
          mapped
        );
        PERFORM api.insert_sheet_instance_block(rec.id, NULL, NULL, instance.id);
      END IF;
    END IF;
  END LOOP;

  PERFORM set_config('sheetbase.notebook_template_upgrade', 'v1', true);
  UPDATE api.records
    SET source_notebook_template_version_id = p_target_version_id,
        updated_at = now(),
        updated_by_user_id = actor
    WHERE id = rec.id
  RETURNING * INTO rec;
  INSERT INTO api.notebook_template_upgrades(
    workspace_id, record_id, source_version_id, target_version_id, decisions, actor_user_id
  ) VALUES (
    rec.workspace_id, rec.id,
    (preview->>'sourceVersionId')::uuid, p_target_version_id,
    coalesce(p_decisions,'[]'::jsonb), actor
  );
  RETURN jsonb_build_object('record', to_jsonb(rec), 'preview', preview);
END
$$;

ALTER FUNCTION api.discover_object_dependencies(text, uuid)
  RENAME TO discover_object_dependencies_core063;

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
  rec api.records;
  items jsonb := '[]'::jsonb;
BEGIN
  IF p_kind IN ('record','notebook_record') THEN
    base := api.discover_object_dependencies_core063(p_kind, p_object_id);
    SELECT * INTO rec FROM api.records WHERE id = p_object_id AND workspace_id = workspace;
    IF rec.source_notebook_template_version_id IS NOT NULL THEN
      items := coalesce(base->'dependencies','[]'::jsonb) || jsonb_build_array(internal.dependency_item(
        'notebook_template_version', rec.source_notebook_template_version_id,
        'instantiated_from', 'active', 'informational', rec.identifier
      ));
      RETURN jsonb_build_object('kind', p_kind, 'id', p_object_id, 'dependencies', items);
    END IF;
    RETURN base;
  END IF;
  RETURN api.discover_object_dependencies_core063(p_kind, p_object_id);
END
$$;

REVOKE EXECUTE ON FUNCTION
  internal.template_parameter_inputs_for_placement(jsonb, jsonb),
  internal.definition_derived_instance_state(),
  api.discover_object_dependencies_core063(text, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
REVOKE EXECUTE ON FUNCTION
  api.sheet_instance_notebook_embeddings(uuid),
  api.instantiate_notebook_template_version(uuid, uuid, text, jsonb, text),
  api.preview_notebook_template_upgrade(uuid, uuid),
  api.apply_notebook_template_upgrade(uuid, int, uuid, jsonb, jsonb),
  api.retarget_notebook_template_sheet_placement(uuid, bigint, uuid, uuid),
  api.discover_object_dependencies(text, uuid)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.sheet_instance_notebook_embeddings(uuid),
  api.instantiate_notebook_template_version(uuid, uuid, text, jsonb, text),
  api.preview_notebook_template_upgrade(uuid, uuid),
  api.apply_notebook_template_upgrade(uuid, int, uuid, jsonb, jsonb),
  api.retarget_notebook_template_sheet_placement(uuid, bigint, uuid, uuid),
  api.discover_object_dependencies(text, uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';

