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

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Registries (docs/development/features.md)
-- ---------------------------------------------------------------------------
-- Pipeline actions, as src/features/datasets/operations.ts declares them.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('create_dataset_schema_definition', '{"operation":"create_dataset_schema_definition","rpc":"create_dataset_schema_definition","label":"Create a measurement table","description":"Creates a measurement table (the columns a dataset is made of) with a first draft version holding `p_fields`. `p_key` is lower case letters, digits and _, unique in the workspace. Publish the draft with `publish_dataset_schema_version` before datasets use it. Returns `{ schema_definition_id, schema_version_id }`. Sends `measurement_table.created` and `measurement_table.version.created`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_key","type":"text","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false},{"name":"p_fields","type":"jsonb","required":false,"nullable":false}]}'::jsonb),
  ('create_dataset_schema_subtype', '{"operation":"create_dataset_schema_subtype","rpc":"create_dataset_schema_subtype","label":"Create a measurement table that extends another","description":"Creates a measurement table under `p_parent_id`: it starts with every field of its parent and adds its own. Returns `{ schema_definition_id, schema_version_id }`. Sends `measurement_table.created`.","arguments":[{"name":"p_parent_id","type":"uuid","required":true,"nullable":false},{"name":"p_key","type":"text","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false}]}'::jsonb),
  ('create_dataset_structure_from_file', '{"operation":"create_dataset_structure_from_file","rpc":"create_dataset_structure_from_file","label":"Make a dataset structure from a file’s columns","description":"Makes and publishes a measurement table straight from the columns of a file, the way the import page does on a first import. Each field is `{ key, label, logical_type }` with `logical_type` one of `text`, `integer`, `decimal`, `boolean`, `date`, `timestamp`. Needs dataset work access, not schema editing. Returns the table and its published version.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_fields","type":"jsonb","required":true,"nullable":false}]}'::jsonb),
  ('create_next_dataset_schema_version', '{"operation":"create_next_dataset_schema_version","rpc":"create_next_dataset_schema_version","label":"Start a new version of a measurement table","description":"Starts a draft version from the latest one, with the same fields, to change and publish. Returns `{ schema_version_id, version }`. Sends `measurement_table.version.created`.","arguments":[{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('replace_dataset_schema_version_fields', '{"operation":"replace_dataset_schema_version_fields","rpc":"replace_dataset_schema_version_fields","label":"Change the fields of a draft measurement table","description":"Replaces every field of a draft version with `p_fields`. Only drafts change; a draft waiting for approval is locked. `p_expected_revision` refuses the change if someone else changed the draft since you read it. Returns the version. Sends `measurement_table.version.updated`.","arguments":[{"name":"p_schema_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_fields","type":"jsonb","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":false,"nullable":false}]}'::jsonb),
  ('publish_dataset_schema_version', '{"operation":"publish_dataset_schema_version","rpc":"publish_dataset_schema_version","label":"Publish a measurement table version","description":"Publishes a draft version so datasets can use it; the version before it is superseded. Refused while the workspace asks for an approval and none has been given. Returns the version. Sends `measurement_table.version.published`.","arguments":[{"name":"p_schema_version_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('delete_dataset_schema_version', '{"operation":"delete_dataset_schema_version","rpc":"delete_dataset_schema_version","label":"Discard a draft measurement table version","description":"Discards a draft version that was never published. Published versions are kept for good. Sends `measurement_table.version.deleted`.","arguments":[{"name":"p_schema_version_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('retire_dataset_schema_definition', '{"operation":"retire_dataset_schema_definition","rpc":"retire_dataset_schema_definition","label":"Retire a measurement table","description":"Stops new datasets from using a measurement table. Datasets that use it keep their data and can still be read. Undo with `restore_dataset_schema_definition`. Returns the table. Sends `measurement_table.retired`.","arguments":[{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('restore_dataset_schema_definition', '{"operation":"restore_dataset_schema_definition","rpc":"restore_dataset_schema_definition","label":"Bring back a retired measurement table","description":"Brings a retired measurement table back: active when it has a published version, otherwise a draft. Returns the table. Sends `measurement_table.restored`.","arguments":[{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('reparent_dataset_schema', '{"operation":"reparent_dataset_schema","rpc":"reparent_dataset_schema","label":"Move a measurement table under another","description":"Makes a measurement table extend `p_parent_id`, or no table when it is null. Its draft picks up the parent’s fields. Returns the table. Sends `measurement_table.updated`.","arguments":[{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_parent_id","type":"uuid","required":true,"nullable":true}]}'::jsonb),
  ('apply_dataset_schema_evolution', '{"operation":"apply_dataset_schema_evolution","rpc":"apply_dataset_schema_evolution","label":"Change a published measurement table","description":"Makes and publishes the next version from `p_fields` in one step, when the preview says it is safe. `p_idempotency_key` makes a retry return the first answer. Returns the preview and the published version.","arguments":[{"name":"p_schema_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_fields","type":"jsonb","required":true,"nullable":false},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"},{"name":"p_expected_revision","type":"bigint","required":false,"nullable":false}]}'::jsonb),
  ('apply_dataset_model_upgrade', '{"operation":"apply_dataset_model_upgrade","rpc":"apply_dataset_model_upgrade","label":"Move a dataset to a newer measurement table","description":"Moves a dataset to `p_target_version_id` of its measurement table, carrying its values across. `p_expected_revision` is the dataset revision you previewed. Needs schema editing. Sends `dataset.updated`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_target_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}'::jsonb),
  ('keep_dataset_version', '{"operation":"keep_dataset_version","rpc":"keep_dataset_version","label":"Keep a dataset snapshot","description":"Keeps a snapshot for the workspace’s retention period, with a reason, so it is not pruned. Returns the snapshot. Sends `dataset.version.kept`.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false}]}'::jsonb),
  ('flag_dataset_value', '{"operation":"flag_dataset_value","rpc":"flag_dataset_value","label":"Flag a value","description":"Flags one value in a dataset: `p_kind` is `out_of_range`, `missing_unit`, `above_curve` or `high_cv`, with a reason (up to 200 characters) and an optional comment. Returns the flag. Sends `dataset.value.flagged`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_row_id","type":"uuid","required":true,"nullable":false},{"name":"p_field_id","type":"uuid","required":true,"nullable":false},{"name":"p_kind","type":"text","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false},{"name":"p_comment","type":"text","required":false,"nullable":false}]}'::jsonb),
  ('clear_dataset_value_flag', '{"operation":"clear_dataset_value_flag","rpc":"clear_dataset_value_flag","label":"Clear a flag","description":"Clears an open flag, with an optional reason. Returns the flag. Sends `dataset.value.flag_cleared`.","arguments":[{"name":"p_flag_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]}'::jsonb),
  ('recompute_dataset_system_flags', '{"operation":"recompute_dataset_system_flags","rpc":"recompute_dataset_system_flags","label":"Check a dataset’s values again","description":"Runs the automatic checks (range, units, replicate CV) over every row again, opening and clearing system flags to match. Returns how many rows it checked.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('set_dataset_column_unit', '{"operation":"set_dataset_column_unit","rpc":"set_dataset_column_unit","label":"Set a column’s unit","description":"Sets the unit of one field of a dataset (by `p_field_key`) with a reason. The dataset moves to a new measurement table version with that unit, and `missing_unit` flags on the column clear. Needs publishing rights. Sends `dataset.updated`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_field_key","type":"text","required":true,"nullable":false},{"name":"p_unit","type":"text","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false}]}'::jsonb),
  ('set_dataset_intended_use', '{"operation":"set_dataset_intended_use","rpc":"set_dataset_intended_use","label":"Set what a dataset is for","description":"Sets what a dataset is for: `exploratory_research`, `controlled_development` or `regulated_record`, with a reason. Regulated datasets only take approved parsers. Needs publishing rights. Returns the dataset. Sends `dataset.updated`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_intended_use","type":"text","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false}]}'::jsonb),
  ('plan_dataset_row', '{"operation":"plan_dataset_row","rpc":"plan_dataset_row","label":"Plan a row","description":"Adds a row that is waiting for its measurement, optionally with when it is due (`p_scheduled_at`) and a key to find it by (`p_planned_key`, such as a sample or timepoint). Committing values to it later records it. Returns the row. Sends `dataset.updated`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_scheduled_at","type":"timestamptz","required":false,"nullable":true},{"name":"p_planned_key","type":"text","required":false,"nullable":true}]}'::jsonb),
  ('commit_dataset_row_batch_atomic', '{"operation":"commit_dataset_row_batch_atomic","rpc":"commit_dataset_row_batch_atomic","label":"Commit a large batch of rows","description":"Commits more rows than `commit_dataset_row_batch` takes at once (it splits them into chunks) and keeps the whole batch or none of it. `p_expected_dataset_revision` refuses the commit if the dataset changed since; `p_idempotency_key` makes a retry return the first answer. Sends `dataset.updated`.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_dataset_revision","type":"bigint","required":true,"nullable":false},{"name":"p_rows","type":"jsonb","required":true,"nullable":false},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"}]}'::jsonb),
  ('add_dataset_import_file', '{"operation":"add_dataset_import_file","rpc":"add_dataset_import_file","label":"Add a file to import","description":"Takes a file you uploaded with the files API (`p_file_id`) as a file to import: `p_format` is `csv`, `tsv`, `xlsx` or `json`, and `p_dataset_id` the dataset it is for, if you know. Returns the import file. Sends `import.file.added`.","arguments":[{"name":"p_file_id","type":"uuid","required":true,"nullable":false},{"name":"p_format","type":"text","required":true,"nullable":false},{"name":"p_dataset_id","type":"uuid","required":false,"nullable":true}]}'::jsonb),
  ('record_intake_failure', '{"operation":"record_intake_failure","rpc":"record_intake_failure","label":"Report a file that could not be brought in","description":"Records that a connector could not bring a file in, with a short `p_code` and a `p_message` for people. The same file failing again adds an attempt instead of a new problem. `p_source` is `agent` (a connector) or `upload`. Returns the problem. Sends `intake.failed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_connector_id","type":"uuid","required":true,"nullable":false},{"name":"p_file_name","type":"text","required":true,"nullable":false},{"name":"p_source","type":"text","required":true,"nullable":false},{"name":"p_code","type":"text","required":true,"nullable":false},{"name":"p_message","type":"text","required":true,"nullable":false},{"name":"p_file_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_checksum","type":"text","required":false,"nullable":true},{"name":"p_byte_size","type":"bigint","required":false,"nullable":true},{"name":"p_parser_key","type":"text","required":false,"nullable":true},{"name":"p_target","type":"jsonb","required":false,"nullable":false},{"name":"p_connector_run_id","type":"uuid","required":false,"nullable":true}]}'::jsonb),
  ('resolve_intake_failure', '{"operation":"resolve_intake_failure","rpc":"resolve_intake_failure","label":"Close an intake problem","description":"Closes an open intake problem: `p_resolution` is `resolved` (it came in after all, with the connector run that did it as `p_run_id`) or `dismissed`. Returns the problem. Sends `intake.resolved`.","arguments":[{"name":"p_failure_id","type":"uuid","required":true,"nullable":false},{"name":"p_resolution","type":"text","required":true,"nullable":false},{"name":"p_run_id","type":"uuid","required":false,"nullable":true}]}'::jsonb),
  ('resolve_intake_failures_for_file', '{"operation":"resolve_intake_failures_for_file","rpc":"resolve_intake_failures_for_file","label":"Close the problems for a file that came in","description":"Marks every open problem a connector had with the file of this checksum as resolved by connector run `p_run_id`. A connector calls it after a file finally comes in. Returns how many it closed. Sends `intake.resolved` for each.","arguments":[{"name":"p_connector_id","type":"uuid","required":true,"nullable":false},{"name":"p_checksum","type":"text","required":true,"nullable":false},{"name":"p_run_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('link_intake_dataset', '{"operation":"link_intake_dataset","rpc":"link_intake_dataset","label":"File a dataset from a connector","description":"Files a dataset a connector made: in project `p_project_id`, against instrument run `p_run_id` and its experiments, and records which connector run made it. Returns what it linked.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":true,"nullable":true},{"name":"p_run_id","type":"uuid","required":true,"nullable":true},{"name":"p_connector_run_id","type":"uuid","required":true,"nullable":true}]}'::jsonb),
  ('attach_instrument_raw_file', '{"operation":"attach_instrument_raw_file","rpc":"attach_instrument_raw_file","label":"Attach a raw file to an instrument run","description":"Keeps a file you uploaded with the files API (`p_file_id`) as a raw file of instrument run `p_run_id`, as it came off the instrument. `p_ingestion_status` is `pending` (default), `complete`, `partial` or `failed`, with `p_error_detail`. Returns the raw file. Sends `instrument.raw_file.added`.","arguments":[{"name":"p_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_file_id","type":"uuid","required":true,"nullable":false},{"name":"p_ingestion_status","type":"text","required":false,"nullable":false},{"name":"p_error_detail","type":"text","required":false,"nullable":true}]}'::jsonb),
  ('promote_calculation', '{"operation":"promote_calculation","rpc":"promote_calculation","label":"Promote a sheet calculation","description":"Moves calculation `p_calculation_id` of sheet `p_instance_id` to its sheet definition or to a draft of measurement table `p_schema_definition_id` (`p_target`). Returns what changed.","arguments":[{"name":"p_instance_id","type":"uuid","required":true,"nullable":false},{"name":"p_calculation_id","type":"uuid","required":true,"nullable":false},{"name":"p_target","type":"text","required":true,"nullable":false},{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":true},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"},{"name":"p_schema_version_id","type":"uuid","required":false,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":false,"nullable":false}]}'::jsonb),
  ('request_column_promotion', '{"operation":"request_column_promotion","rpc":"request_column_promotion","label":"Ask for a sheet column to be promoted","description":"Asks for column `p_field_id` of sheet `p_instance_id` to become a field of a measurement table or record type, with `p_reason`, when the workspace wants promotions approved. The approval is a person’s; once approved, `apply_column_promotion` makes the change. Returns the promotion.","arguments":[{"name":"p_instance_id","type":"uuid","required":true,"nullable":false},{"name":"p_field_id","type":"uuid","required":true,"nullable":false},{"name":"p_target","type":"text","required":true,"nullable":false},{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":true},{"name":"p_model_key","type":"text","required":true,"nullable":true},{"name":"p_reason","type":"text","required":true,"nullable":true},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"},{"name":"p_expected_revision","type":"bigint","required":false,"nullable":false}]}'::jsonb),
  ('apply_column_promotion', '{"operation":"apply_column_promotion","rpc":"apply_column_promotion","label":"Apply an approved column promotion","description":"Applies promotion `p_promotion_id` once it has been approved: the column joins the measurement table and its values move with it. `p_idempotency_key` (a uuid) makes a retry return the first result. Returns what changed.","arguments":[{"name":"p_promotion_id","type":"uuid","required":true,"nullable":false},{"name":"p_idempotency_key","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('create_plate_snapshot', '{"operation":"create_plate_snapshot","rpc":"create_plate_snapshot","label":"Keep a plate reading","description":"Keeps the wells of a plate read during instrument run `p_run_id`: `p_wells` maps well names to values, `p_plate_format` is the number of wells (`96` by default), with an optional cycle number and time. Returns the snapshot.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_wells","type":"jsonb","required":true,"nullable":false},{"name":"p_plate_format","type":"text","required":false,"nullable":false},{"name":"p_cycle_number","type":"integer","required":false,"nullable":false},{"name":"p_captured_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_observation_id","type":"uuid","required":false,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
-- Events a pipeline may start on.
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('measurement_table.created'),
  ('measurement_table.version.created'),
  ('measurement_table.version.updated'),
  ('measurement_table.version.published'),
  ('measurement_table.version.deleted'),
  ('measurement_table.retired'),
  ('measurement_table.restored'),
  ('measurement_table.updated'),
  ('dataset.version.kept'),
  ('dataset.value.flagged'),
  ('dataset.value.flag_cleared'),
  ('import.file.added'),
  ('import.file.read'),
  ('import.file.unreadable'),
  ('intake.failed'),
  ('intake.resolved'),
  ('instrument.raw_file.added')
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint
-- Discarding a draft measurement table version, behind a confirmation.
INSERT INTO internal.agent_allowed_deletes (action_key) VALUES ('delete_dataset_schema_version')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Steward reporting views. Storage keys are left out.
SELECT internal.register_reporting_view('datasets', 'datasets', 'Datasets',
  'Datasets with their measurement table version, intended use and revision.',
  'datasets',
  ARRAY['id','display_id','name','description','primary_project_id','schema_version_id','lifecycle','intended_use','revision','archived_at','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('dataset_snapshots', 'dataset_snapshots', 'Dataset snapshots',
  'Saved snapshots of each dataset and the revision each was taken at.',
  'dataset_versions',
  ARRAY['id','dataset_id','schema_version_id','source_dataset_revision','label','created_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('measurement_tables', 'measurement_tables', 'Measurement tables',
  'The measurement tables datasets are made of, and whether each is in use or retired.',
  'dataset_schema_definitions',
  ARRAY['id','display_id','key','name','description','lifecycle','parent_id','origin','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('dataset_value_flags', 'dataset_value_flags', 'Dataset value flags',
  'Flags on dataset values, by a person or a rule, with the reason and when each was cleared.',
  'dataset_value_flags',
  ARRAY['id','dataset_id','row_id','field_id','kind','reason','comment','source','system_rule','evaluated_value','threshold','set_by_user_id','set_at','cleared_at','cleared_by_user_id','cleared_reason']);
--> statement-breakpoint
SELECT internal.register_reporting_view('dataset_import_files', 'dataset_import_files', 'Import files',
  'Files uploaded to be imported into a dataset, and whether each was read. Where the file is stored is not listed.',
  'dataset_import_files',
  ARRAY['id','dataset_id','filename','media_type','byte_size','checksum','format','status','parse_error','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('intake_failures', 'intake_failures', 'Intake problems',
  'Files a connector or an upload could not bring in, why, and how each was closed.',
  'intake_failures',
  ARRAY['id','connector_id','instrument_id','connector_run_id','file_record_id','file_name','checksum','byte_size','source','code','message','parser_key','status','attempts','created_at','updated_at','last_attempt_at','resolved_at','resolved_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('instrument_raw_files', 'instrument_raw_files', 'Instrument raw files',
  'The raw files each instrument run produced, and whether each was read in. Where the file is stored is not listed.',
  'instrument_raw_files',
  ARRAY['id','run_id','file_id','filename','media_type','size_bytes','checksum','ingestion_status','error_detail','received_at','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('data_exports', 'data_exports', 'Data exports',
  'Data taken out of Sheetbase: what, in which format, how many rows and by whom.',
  'data_exports',
  ARRAY['id','object_type','object_id','format','row_count','byte_size','actor_user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('column_promotions', 'column_promotions', 'Column promotions',
  'Sheet columns asked to become shared fields, and how each was decided.',
  'column_promotions',
  ARRAY['id','sheet_instance_id','field_id','target','schema_definition_id','schema_version_id','model_key','state','approval_request_id','reason','requested_by_user_id','requested_at','decided_at','created_at','updated_at']);
