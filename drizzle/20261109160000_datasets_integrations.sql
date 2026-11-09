-- Datasets, measurement tables and intake reach the API, MCP, the assistant,
-- pipelines and webhooks.
--
--   1. Change events for what had none: measurement tables and their
--      versions, value flags, kept snapshots and intake problems.
--   2. Import-file and raw-file events stop carrying the storage key.
--   3. Two calls that take an uploaded file's id instead of a storage key, so
--      a token can add a file to import or attach a raw file to a run.
--   4. Webhook event names and steward reporting views.

-- ---------------------------------------------------------------------------
-- 1. Change events
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_type text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  FOREACH v_type IN ARRAY ARRAY['dataset_schema_definition', 'dataset_schema_version', 'dataset_value_flag', 'intake_failure'] LOOP
    IF position('''' || v_type || '''' IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_type || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

-- A measurement table: created, changed, retired (archive) or brought back
-- (restore).
CREATE FUNCTION internal.trg_change_event_dataset_schema_definition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_op text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'create';
  ELSIF NEW.lifecycle = 'retired' AND OLD.lifecycle <> 'retired' THEN
    v_op := 'archive';
  ELSIF OLD.lifecycle = 'retired' AND NEW.lifecycle <> 'retired' THEN
    v_op := 'restore';
  ELSIF (NEW.name, NEW.description, NEW.parent_id) IS DISTINCT FROM (OLD.name, OLD.description, OLD.parent_id) THEN
    v_op := 'update';
  ELSE
    -- A draft becoming active when its first version is published is told by
    -- the version's own event.
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'dataset_schema_definition', NEW.id, v_op, NULL, NULL,
    jsonb_build_object('id', NEW.id, 'displayId', NEW.display_id, 'key', NEW.key,
                       'name', NEW.name, 'description', NEW.description,
                       'lifecycle', NEW.lifecycle, 'parentId', NEW.parent_id,
                       'createdByUserId', NEW.created_by_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_dataset_schema_definition() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_schema_definitions
  AFTER INSERT OR UPDATE ON api.dataset_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_dataset_schema_definition();
--> statement-breakpoint

-- A version of a measurement table: started, its draft changed, published
-- (lifecycle becomes active) or discarded. A version superseded by a newer
-- one is told by the newer one's publish.
CREATE FUNCTION internal.trg_change_event_dataset_schema_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.dataset_schema_versions;
  v_op text;
  v_workspace uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD; v_op := 'delete';
  ELSIF TG_OP = 'INSERT' THEN
    v_row := NEW; v_op := 'create';
  ELSIF NEW.lifecycle = 'active' AND OLD.lifecycle <> 'active' THEN
    v_row := NEW; v_op := 'update';
  ELSIF NEW.lifecycle = 'draft' AND NEW.revision IS DISTINCT FROM OLD.revision THEN
    v_row := NEW; v_op := 'update';
  ELSE
    RETURN NULL;
  END IF;
  SELECT d.workspace_id INTO v_workspace
    FROM api.dataset_schema_definitions d WHERE d.id = v_row.schema_id;
  -- A definition removed with its versions has nobody left to tell.
  IF v_workspace IS NULL THEN RETURN NULL; END IF;
  PERFORM internal.emit_change_event(
    v_workspace, 'dataset_schema_version', v_row.id, v_op, NULL, NULL,
    jsonb_build_object('id', v_row.id, 'schemaId', v_row.schema_id,
                       'version', v_row.version, 'lifecycle', v_row.lifecycle,
                       'revision', v_row.revision, 'publishedAt', v_row.published_at,
                       'createdByUserId', v_row.created_by_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_dataset_schema_version() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_schema_versions
  AFTER INSERT OR UPDATE OR DELETE ON api.dataset_schema_versions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_dataset_schema_version();
--> statement-breakpoint

-- A flag on a dataset value: set, or cleared (resolve).
CREATE FUNCTION internal.trg_change_event_dataset_value_flag() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_op text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'create';
  ELSIF NEW.cleared_at IS NOT NULL AND OLD.cleared_at IS NULL THEN
    v_op := 'resolve';
  ELSE
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'dataset_value_flag', NEW.id, v_op, NULL, NULL,
    jsonb_build_object('id', NEW.id, 'datasetId', NEW.dataset_id, 'rowId', NEW.row_id,
                       'fieldId', NEW.field_id, 'kind', NEW.kind, 'reason', NEW.reason,
                       'comment', NEW.comment, 'source', NEW.source,
                       'systemRule', NEW.system_rule, 'evaluatedValue', NEW.evaluated_value,
                       'threshold', NEW.threshold, 'setByUserId', NEW.set_by_user_id,
                       'clearedAt', NEW.cleared_at, 'clearedByUserId', NEW.cleared_by_user_id,
                       'clearedReason', NEW.cleared_reason));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_dataset_value_flag() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_value_flags
  AFTER INSERT OR UPDATE ON api.dataset_value_flags
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_dataset_value_flag();
--> statement-breakpoint

-- A snapshot kept from pruning (dataset_version, lock).
CREATE FUNCTION internal.trg_change_event_dataset_version_keep() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.dataset_versions;
BEGIN
  SELECT * INTO v_version FROM api.dataset_versions WHERE id = NEW.dataset_version_id;
  IF v_version.id IS NULL THEN RETURN NULL; END IF;
  PERFORM internal.emit_change_event(
    v_version.workspace_id, 'dataset_version', v_version.id, 'lock', NULL, NULL,
    jsonb_build_object('versionId', v_version.id, 'datasetId', v_version.dataset_id,
                       'keptUntil', NEW.kept_until, 'reason', NEW.reason));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_dataset_version_keep() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_version_keeps
  AFTER INSERT OR UPDATE ON api.dataset_version_keeps
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_dataset_version_keep();
--> statement-breakpoint

-- An intake problem: recorded, or closed (resolve). Another try at the same
-- file only counts an attempt and is not an event.
CREATE FUNCTION internal.trg_change_event_intake_failure() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_op text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'create';
  ELSIF NEW.status <> 'open' AND OLD.status = 'open' THEN
    v_op := 'resolve';
  ELSE
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'intake_failure', NEW.id, v_op, NULL, NULL,
    jsonb_build_object('id', NEW.id, 'connectorId', NEW.connector_id,
                       'instrumentId', NEW.instrument_id, 'connectorRunId', NEW.connector_run_id,
                       'fileName', NEW.file_name, 'source', NEW.source, 'code', NEW.code,
                       'message', NEW.message, 'parserKey', NEW.parser_key,
                       'attempts', NEW.attempts, 'status', NEW.status,
                       'resolvedRunId', NEW.resolved_run_id,
                       'resolvedByUserId', NEW.resolved_by_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_intake_failure() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_intake_failures
  AFTER INSERT OR UPDATE ON api.intake_failures
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_intake_failure();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. File events without the storage key
-- ---------------------------------------------------------------------------
-- Import files and raw instrument files were told with the whole row, storage
-- key and all. A webhook receiver never needs where a file sits in the store.
CREATE FUNCTION internal.trg_change_event_stored_file() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_op text; v_payload jsonb;
BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW);
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW);
    ELSE v_op := 'delete'; v_payload := to_jsonb(OLD);
  END CASE;
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id), TG_ARGV[0], COALESCE(NEW.id, OLD.id),
    v_op, NULL, NULL, v_payload - 'storage_key' - 'metadata');
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_stored_file() OWNER TO migrator;
--> statement-breakpoint
DROP TRIGGER change_event_dataset_import_files ON api.dataset_import_files;
--> statement-breakpoint
CREATE TRIGGER change_event_dataset_import_files
  AFTER INSERT OR UPDATE OR DELETE ON api.dataset_import_files
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_stored_file('dataset_import_file');
--> statement-breakpoint
DROP TRIGGER change_event_instrument_raw_files ON api.instrument_raw_files;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_raw_files
  AFTER INSERT OR UPDATE OR DELETE ON api.instrument_raw_files
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_stored_file('instrument_raw_file');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Files by id
-- ---------------------------------------------------------------------------
-- The caller names a file it can already see (row security on file_objects
-- decides); the storage key, size and checksum come from the file itself.
CREATE FUNCTION api.add_dataset_import_file(p_file_id uuid, p_format text, p_dataset_id uuid DEFAULT NULL)
    RETURNS api.dataset_import_files
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
  v_file api.file_objects;
BEGIN
  SELECT * INTO v_file FROM api.file_objects
   WHERE id = p_file_id AND deleted_at IS NULL AND quarantined_at IS NULL;
  IF v_file.id IS NULL THEN
    RAISE EXCEPTION 'file not found' USING ERRCODE = 'SB106';
  END IF;
  RETURN api.create_dataset_import_file(
    v_file.workspace_id, v_file.display_name, v_file.media_type, v_file.byte_size,
    v_file.checksum, v_file.storage_key, p_format, p_dataset_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_dataset_import_file(uuid, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_dataset_import_file(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_dataset_import_file(uuid, text, uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.attach_instrument_raw_file(p_run_id uuid, p_file_id uuid, p_ingestion_status text DEFAULT 'pending', p_error_detail text DEFAULT NULL)
    RETURNS api.instrument_raw_files
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
  v_file api.file_objects;
BEGIN
  SELECT * INTO v_file FROM api.file_objects
   WHERE id = p_file_id AND deleted_at IS NULL AND quarantined_at IS NULL;
  IF v_file.id IS NULL THEN
    RAISE EXCEPTION 'file not found' USING ERRCODE = 'SB106';
  END IF;
  RETURN api.register_raw_file(
    v_file.workspace_id, p_run_id, v_file.display_name, v_file.media_type,
    v_file.byte_size, v_file.storage_key, v_file.checksum, v_file.id,
    coalesce(p_ingestion_status, 'pending'), p_error_detail);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.attach_instrument_raw_file(uuid, uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.attach_instrument_raw_file(uuid, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.attach_instrument_raw_file(uuid, uuid, text, text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Webhook event names
-- ---------------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('measurement_table.created'),
  ('measurement_table.updated'),
  ('measurement_table.retired'),
  ('measurement_table.restored'),
  ('measurement_table.version.created'),
  ('measurement_table.version.updated'),
  ('measurement_table.version.published'),
  ('measurement_table.version.deleted'),
  ('dataset.version.kept'),
  ('dataset.value.flagged'),
  ('dataset.value.flag_cleared'),
  ('import.file.added'),
  ('import.file.read'),
  ('import.file.unreadable'),
  ('intake.failed'),
  ('intake.resolved'),
  ('instrument.raw_file.added')
ON CONFLICT DO NOTHING;
