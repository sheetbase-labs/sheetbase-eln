-- CORE-06.2: canonical Notebook Sheet blocks reference Sheet Instances.
-- Legacy scientific-table `{tableId}` payloads remain valid and renderable.
-- New Notebook Sheet creation uses `insert_sheet_instance_block`.

CREATE FUNCTION internal.ad_hoc_sheet_instance_state()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'bindings', '[]'::jsonb,
    'localFields', '[]'::jsonb,
    'localValues', '{}'::jsonb,
    'calculationOverrides', '{}'::jsonb,
    'presentation', jsonb_build_object(
      'columnOrder', '[]'::jsonb,
      'hiddenColumnIds', '[]'::jsonb,
      'columnWidths', '{}'::jsonb,
      'frozenColumnCount', 0,
      'density', 'standard',
      'filters', '[]'::jsonb,
      'sorts', '[]'::jsonb
    ),
    'provenance', jsonb_build_object('createdFrom', 'ad_hoc')
  )
$$;

CREATE FUNCTION api.validate_notebook_sheet_block()
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
  converting boolean;
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
    WHERE key NOT IN ('instanceId', 'tableId', 'presentation')
  ) THEN
    RAISE EXCEPTION 'sheet payload may only contain instanceId, tableId and presentation'
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

CREATE TRIGGER validate_notebook_sheet_block
  BEFORE INSERT OR UPDATE ON api.blocks
  FOR EACH ROW
  WHEN (NEW.type = 'sheet')
  EXECUTE FUNCTION api.validate_notebook_sheet_block();

CREATE FUNCTION api.insert_sheet_instance_block(
  p_record_id uuid,
  p_after_block_id uuid DEFAULT NULL,
  p_expected_structure_version int DEFAULT NULL,
  p_instance_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rec api.records;
  instance api.sheet_instances;
  created boolean := false;
  inserted jsonb;
BEGIN
  SELECT * INTO rec FROM api.records WHERE id = p_record_id FOR UPDATE;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF rec.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  IF p_expected_structure_version IS NOT NULL
     AND rec.structure_version <> p_expected_structure_version THEN
    RAISE EXCEPTION 'structure version mismatch: expected %, got %',
      p_expected_structure_version, rec.structure_version USING ERRCODE = 'SB001';
  END IF;

  IF p_instance_id IS NULL THEN
    instance := api.create_sheet_instance(
      rec.workspace_id,
      'Notebook sheet',
      NULL,
      NULL,
      rec.project_id,
      rec.id,
      internal.ad_hoc_sheet_instance_state()
    );
    created := true;
  ELSE
    SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id;
    IF instance.id IS NULL THEN
      RAISE EXCEPTION 'Sheet Instance not found' USING ERRCODE = '42501';
    END IF;
    IF instance.workspace_id IS DISTINCT FROM rec.workspace_id THEN
      RAISE EXCEPTION 'Sheet Instance belongs to another workspace' USING ERRCODE = '42501';
    END IF;
  END IF;

  BEGIN
    inserted := api.insert_block(
      p_record_id,
      'sheet',
      jsonb_build_object('instanceId', instance.id),
      1,
      p_after_block_id,
      p_expected_structure_version
    );
  EXCEPTION WHEN OTHERS THEN
    IF created THEN
      PERFORM api.archive_sheet_instance(instance.id, instance.revision);
    END IF;
    RAISE;
  END;

  RETURN jsonb_build_object(
    'block', inserted->'block',
    'instance', to_jsonb(instance),
    'structure_version', (inserted->>'structure_version')::int
  );
END
$$;

CREATE FUNCTION api.duplicate_sheet_instance_block(
  p_block_id uuid,
  p_expected_structure_version int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  source api.blocks;
  instance api.sheet_instances;
  copy api.sheet_instances;
  inserted jsonb;
BEGIN
  SELECT * INTO source FROM api.blocks WHERE id = p_block_id FOR UPDATE;
  IF source.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF source.type <> 'sheet' OR NOT (source.payload ? 'instanceId') THEN
    RAISE EXCEPTION 'only canonical Sheet Instance blocks can be duplicated this way'
      USING ERRCODE = '23514';
  END IF;
  SELECT * INTO instance FROM api.sheet_instances
    WHERE id = (source.payload->>'instanceId')::uuid;
  IF instance.id IS NULL THEN
    RAISE EXCEPTION 'Sheet Instance not found' USING ERRCODE = '42501';
  END IF;
  copy := api.duplicate_sheet_instance(instance.id, instance.revision, instance.name || ' copy');
  BEGIN
    inserted := api.insert_sheet_instance_block(
      source.record_id,
      source.id,
      p_expected_structure_version,
      copy.id
    );
  EXCEPTION WHEN OTHERS THEN
    PERFORM api.archive_sheet_instance(copy.id, copy.revision);
    RAISE;
  END;
  RETURN inserted;
END
$$;

CREATE FUNCTION api.convert_legacy_sheet_block(
  p_block_id uuid,
  p_expected_version int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  source api.blocks;
  rec api.records;
  instance api.sheet_instances;
  payload jsonb;
BEGIN
  SELECT * INTO source FROM api.blocks WHERE id = p_block_id FOR UPDATE;
  IF source.id IS NULL THEN
    RAISE EXCEPTION 'block not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF source.type <> 'sheet' OR NOT (source.payload ? 'tableId') OR source.payload ? 'instanceId' THEN
    RAISE EXCEPTION 'block is not a legacy scientific-table sheet' USING ERRCODE = '23514';
  END IF;
  IF source.version <> p_expected_version THEN
    RAISE EXCEPTION 'block version mismatch: expected %, got %',
      p_expected_version, source.version USING ERRCODE = 'SB001';
  END IF;
  SELECT * INTO rec FROM api.records WHERE id = source.record_id FOR UPDATE;
  IF rec.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  instance := api.create_sheet_instance(
    rec.workspace_id,
    'Notebook sheet',
    NULL,
    NULL,
    rec.project_id,
    rec.id,
    internal.ad_hoc_sheet_instance_state()
  );
  payload := jsonb_build_object('instanceId', instance.id);
  IF source.payload ? 'presentation' THEN
    payload := payload || jsonb_build_object('presentation', source.payload->'presentation');
  END IF;
  BEGIN
    PERFORM set_config('sheetbase.sheet_block_convert', 'v1', true);
    source := api.update_block_payload(p_block_id, payload, p_expected_version, 1);
  EXCEPTION WHEN OTHERS THEN
    PERFORM api.archive_sheet_instance(instance.id, instance.revision);
    RAISE;
  END;
  RETURN jsonb_build_object('block', to_jsonb(source), 'instance', to_jsonb(instance));
END
$$;

ALTER FUNCTION api.discover_object_dependencies(text, uuid)
  RENAME TO discover_object_dependencies_core054;

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
  items jsonb := '[]'::jsonb;
  rec api.records;
  instance api.sheet_instances;
BEGIN
  IF p_kind IN ('record', 'notebook_record') THEN
    IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
      RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO rec FROM api.records WHERE id = p_object_id AND workspace_id = workspace;
    IF rec.id IS NULL THEN RAISE EXCEPTION 'object not found' USING ERRCODE = '42501'; END IF;
    SELECT coalesce(jsonb_agg(internal.dependency_item(
      'sheet_instance', instance_id, 'notebook_sheet_block',
      'active', 'blocks_deletion', rec.identifier
    ) ORDER BY instance_id), '[]'::jsonb) INTO items
    FROM (
      SELECT DISTINCT internal.collect_uuid(b.payload->>'instanceId') AS instance_id
      FROM api.blocks b
      WHERE b.record_id = rec.id
        AND b.type = 'sheet'
        AND b.payload ? 'instanceId'
    ) refs
    WHERE instance_id IS NOT NULL;
    RETURN jsonb_build_object(
      'kind', p_kind,
      'id', p_object_id,
      'dependencies', coalesce(items, '[]'::jsonb)
    );
  END IF;

  base := api.discover_object_dependencies_core054(p_kind, p_object_id);
  IF p_kind = 'sheet_instance' THEN
    SELECT * INTO instance FROM api.sheet_instances
      WHERE id = p_object_id AND workspace_id = workspace;
    items := coalesce(base->'dependencies', '[]'::jsonb) || coalesce((
      SELECT jsonb_agg(internal.dependency_item(
        'notebook_block', b.id, 'embeds_sheet_instance',
        CASE WHEN instance.lifecycle = 'active' THEN 'active' ELSE 'historical' END,
        'blocks_deletion', r.identifier
      ) ORDER BY b.id)
      FROM api.blocks b
      JOIN api.records r ON r.id = b.record_id
      WHERE r.workspace_id = workspace
        AND b.type = 'sheet'
        AND b.payload->>'instanceId' = p_object_id::text
    ), '[]'::jsonb);
    RETURN jsonb_build_object(
      'kind', p_kind,
      'id', p_object_id,
      'dependencies', coalesce(items, '[]'::jsonb)
    );
  END IF;
  RETURN base;
END
$$;

REVOKE EXECUTE ON FUNCTION api.validate_notebook_sheet_block() FROM PUBLIC, authenticated, api_client;
REVOKE EXECUTE ON FUNCTION api.discover_object_dependencies_core054(text, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
REVOKE EXECUTE ON FUNCTION internal.ad_hoc_sheet_instance_state()
  FROM PUBLIC, anon, api_client;
REVOKE EXECUTE ON FUNCTION
  api.insert_sheet_instance_block(uuid, uuid, int, uuid),
  api.duplicate_sheet_instance_block(uuid, int),
  api.convert_legacy_sheet_block(uuid, int),
  api.discover_object_dependencies(text, uuid)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION internal.ad_hoc_sheet_instance_state() TO authenticated;
GRANT EXECUTE ON FUNCTION
  api.insert_sheet_instance_block(uuid, uuid, int, uuid),
  api.duplicate_sheet_instance_block(uuid, int),
  api.convert_legacy_sheet_block(uuid, int),
  api.discover_object_dependencies(text, uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
