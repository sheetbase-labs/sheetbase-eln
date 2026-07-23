-- SCI-007 (decision 0032): include `properties` in the change-event trigger's
-- `changedMetadata` flag so overview configuration updates (stored in
-- `records.properties.overview.excludedBlockIds`) accurately report
-- `changedMetadata: true`. The event is emitted on every UPDATE regardless;
-- this migration only improves the payload's accuracy.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_records"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    v_op := 'create';
    v_payload := jsonb_build_object(
      'kind', NEW.kind, 'identifier', NEW.identifier, 'title', NEW.title,
      'status', NEW.status, 'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    -- Derive the semantic operation from the archived_at transition first;
    -- otherwise it is a metadata/structure update.
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN
      v_op := 'archive';
    ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'title', NEW.title, 'status', NEW.status,
      'structureVersion', NEW.structure_version,
      'metadataVersion', NEW.metadata_version,
      'changedMetadata', (OLD.title IS DISTINCT FROM NEW.title
        OR OLD.status IS DISTINCT FROM NEW.status
        OR OLD.tags IS DISTINCT FROM NEW.tags
        OR OLD.folder_id IS DISTINCT FROM NEW.folder_id
        OR OLD.properties IS DISTINCT FROM NEW.properties),
      'changedStructure', (OLD.structure_version IS DISTINCT FROM NEW.structure_version)
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'record', NEW.id, v_op, NEW.id, NEW.project_id, v_payload
    );
  ELSIF (TG_OP = 'DELETE') THEN
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'record', OLD.id, 'delete', OLD.id, OLD.project_id,
      jsonb_build_object('identifier', OLD.identifier, 'kind', OLD.kind)
    );
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
