-- CORE-06.5 P1 follow-up: reject templatePlacementId on every generic Sheet
-- block write unless a trusted internal assignment helper activates the
-- transaction-local gate. Instantiate and upgrade use that helper instead of
-- direct payload mutation.

CREATE OR REPLACE FUNCTION internal.assign_sheet_block_template_placement(
  p_block_id uuid,
  p_placement_id uuid
)
RETURNS api.blocks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  block api.blocks;
BEGIN
  SELECT * INTO block FROM api.blocks WHERE id = p_block_id FOR UPDATE;
  IF block.id IS NULL THEN
    RAISE EXCEPTION 'block not found' USING ERRCODE = '42501';
  END IF;
  IF block.type <> 'sheet' THEN
    RAISE EXCEPTION 'only sheet blocks accept template placement assignment'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (block.payload ? 'instanceId') THEN
    RAISE EXCEPTION 'sheet block must reference an instance before placement assignment'
      USING ERRCODE = '23514';
  END IF;
  IF block.payload ? 'templatePlacementId' THEN
    RAISE EXCEPTION 'template placement is already assigned' USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('sheetbase.template_placement_assign', 'v1', true);
  UPDATE api.blocks
    SET payload = payload || jsonb_build_object('templatePlacementId', p_placement_id::text)
    WHERE id = p_block_id
    RETURNING * INTO block;
  RETURN block;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.validate_notebook_sheet_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  owner api.records;
  instance api.sheet_instances;
  table_row api.scientific_tables;
  instance_id uuid;
  table_id uuid;
  placement_id uuid;
  converting boolean;
  assigning_placement boolean;
BEGIN
  IF NEW.type <> 'sheet' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.payload IS NOT DISTINCT FROM OLD.payload
     AND NEW.payload_schema_version IS NOT DISTINCT FROM OLD.payload_schema_version THEN
    RETURN NEW;
  END IF;
  IF NEW.payload_schema_version <> 1 OR jsonb_typeof(NEW.payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid sheet block payload' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(NEW.payload) key
    WHERE key NOT IN ('instanceId', 'tableId', 'presentation', 'templatePlacementId')
  ) THEN
    RAISE EXCEPTION 'sheet payload may only contain instanceId, tableId, presentation and templatePlacementId'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.payload ? 'presentation' AND jsonb_typeof(NEW.payload->'presentation') <> 'object' THEN
    RAISE EXCEPTION 'sheet presentation must be an object' USING ERRCODE = '23514';
  END IF;

  -- Legacy insert_sheet_block writes `{}` then replaces it with tableId.
  IF NEW.payload = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  IF NEW.payload ? 'instanceId' AND NEW.payload ? 'tableId' THEN
    RAISE EXCEPTION 'sheet block cannot reference both a Sheet Instance and a scientific table'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO owner FROM api.records WHERE id = NEW.record_id;
  IF owner.id IS NULL THEN
    RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503';
  END IF;

  converting := coalesce(current_setting('sheetbase.sheet_block_convert', true), '') = 'v1';
  assigning_placement := coalesce(current_setting('sheetbase.template_placement_assign', true), '') = 'v1';

  IF TG_OP = 'UPDATE'
     AND OLD.payload ? 'templatePlacementId'
     AND (
       NOT (NEW.payload ? 'templatePlacementId')
       OR OLD.payload->>'templatePlacementId' IS DISTINCT FROM NEW.payload->>'templatePlacementId'
     ) THEN
    RAISE EXCEPTION 'Template placement reference is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ? 'templatePlacementId' AND NOT assigning_placement THEN
    IF TG_OP = 'INSERT'
       OR NOT (OLD.payload ? 'templatePlacementId') THEN
      RAISE EXCEPTION 'templatePlacementId is system-managed and cannot be set directly'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.payload ? 'templatePlacementId' THEN
    BEGIN
      placement_id := (NEW.payload->>'templatePlacementId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'templatePlacementId must be a UUID' USING ERRCODE = '23514';
    END;
  END IF;

  IF NEW.payload ? 'instanceId' THEN
    BEGIN
      instance_id := (NEW.payload->>'instanceId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'instanceId must be a UUID' USING ERRCODE = '23514';
    END;
    IF TG_OP = 'UPDATE'
       AND OLD.payload ? 'instanceId'
       AND OLD.payload->>'instanceId' IS DISTINCT FROM NEW.payload->>'instanceId' THEN
      RAISE EXCEPTION 'Sheet Instance reference is immutable' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD.payload ? 'tableId'
       AND NOT converting THEN
      RAISE EXCEPTION 'legacy sheet blocks require convert_legacy_sheet_block' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO instance FROM api.sheet_instances WHERE id = instance_id;
    IF instance.id IS NULL OR instance.workspace_id IS DISTINCT FROM owner.workspace_id THEN
      RAISE EXCEPTION 'Sheet Instance must belong to the Notebook workspace' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payload ? 'tableId' THEN
    BEGIN
      table_id := (NEW.payload->>'tableId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'tableId must be a UUID' USING ERRCODE = '23514';
    END;
    IF TG_OP = 'UPDATE'
       AND OLD.payload ? 'instanceId' THEN
      RAISE EXCEPTION 'canonical sheet blocks cannot revert to scientific tables'
        USING ERRCODE = '23514';
    END IF;
    SELECT * INTO table_row FROM api.scientific_tables WHERE id = table_id;
    IF table_row.id IS NULL OR table_row.workspace_id IS DISTINCT FROM owner.workspace_id THEN
      RAISE EXCEPTION 'scientific table must belong to the Notebook workspace'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sheet block must reference instanceId or tableId' USING ERRCODE = '23514';
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.instantiate_notebook_template_version(
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
      PERFORM internal.assign_sheet_block_template_placement(
        (inserted->'block'->>'id')::uuid,
        (placement->>'id')::uuid
      );
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.apply_notebook_template_upgrade(
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
  inserted jsonb;
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
        inserted := api.insert_sheet_instance_block(rec.id, NULL, NULL, instance.id);
        PERFORM internal.assign_sheet_block_template_placement(
          (inserted->'block'->>'id')::uuid,
          (target_placement->>'id')::uuid
        );
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
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION internal.assign_sheet_block_template_placement(uuid, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
