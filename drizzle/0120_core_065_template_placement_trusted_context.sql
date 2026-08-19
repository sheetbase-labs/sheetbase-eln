-- CORE-06.5 P1: templatePlacementId assignment must not trust a user-settable
-- GUC. Request roles cannot insert capability rows; only the restricted helper
-- can, and the trigger consults that storage via a definer guard.

CREATE TABLE internal.template_placement_assign_capability (
  tx bigint PRIMARY KEY,
  block_id uuid NOT NULL,
  placement_id uuid NOT NULL
);
--> statement-breakpoint

REVOKE ALL ON internal.template_placement_assign_capability
  FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.template_placement_assignment_is_trusted(
  p_block_id uuid,
  p_placement_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM internal.template_placement_assign_capability c
    WHERE c.tx = txid_current()
      AND c.block_id = p_block_id
      AND c.placement_id = p_placement_id
  );
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.template_placement_assignment_is_trusted(uuid, uuid)
  FROM PUBLIC, anon;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION internal.template_placement_assignment_is_trusted(uuid, uuid)
  TO authenticated, api_client;
--> statement-breakpoint

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

  INSERT INTO internal.template_placement_assign_capability (tx, block_id, placement_id)
  VALUES (txid_current(), p_block_id, p_placement_id);
  BEGIN
    UPDATE api.blocks
      SET payload = payload || jsonb_build_object('templatePlacementId', p_placement_id::text)
      WHERE id = p_block_id
      RETURNING * INTO block;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM internal.template_placement_assign_capability WHERE tx = txid_current();
    RAISE;
  END;
  DELETE FROM internal.template_placement_assign_capability WHERE tx = txid_current();
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
  assigning_placement := false;

  IF TG_OP = 'UPDATE'
     AND OLD.payload ? 'templatePlacementId'
     AND (
       NOT (NEW.payload ? 'templatePlacementId')
       OR OLD.payload->>'templatePlacementId' IS DISTINCT FROM NEW.payload->>'templatePlacementId'
     ) THEN
    RAISE EXCEPTION 'Template placement reference is immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.payload ? 'templatePlacementId' THEN
    BEGIN
      placement_id := (NEW.payload->>'templatePlacementId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'templatePlacementId must be a UUID' USING ERRCODE = '23514';
    END;
    assigning_placement := internal.template_placement_assignment_is_trusted(NEW.id, placement_id);
  END IF;

  IF NEW.payload ? 'templatePlacementId' AND NOT assigning_placement THEN
    IF TG_OP = 'INSERT'
       OR NOT (OLD.payload ? 'templatePlacementId') THEN
      RAISE EXCEPTION 'templatePlacementId is system-managed and cannot be set directly'
        USING ERRCODE = '23514';
    END IF;
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

REVOKE EXECUTE ON FUNCTION internal.assign_sheet_block_template_placement(uuid, uuid)
  FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
