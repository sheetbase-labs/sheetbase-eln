-- GOV-03: Audit & History Experience.
--
-- Productise the existing authoritative audit trail without creating a second
-- event system. Three targeted extensions to the ADR-0016 machinery:
--
-- 1. Authoritative events for governed object classes whose mutations were
--    invisible to `api.change_events` (Datasets, Dataset Versions, Sheet
--    Instances, Notebook Templates/Versions, Sheet Definitions/Versions) and
--    for the governance rows that make review activity visible outside the
--    record timeline (`review_submissions`, `signatures`, `review_decisions`,
--    INSERT-only, mirroring their append-only contract).
--
-- 2. Narrow before/after data where humans need it: record metadata edits
--    (title/status/folder) and file display-name/media-type renames now carry
--    a `changes` object ({field: {from, to}}) alongside the existing payload
--    keys so LIVE-002/LIVE-003 consumers stay untouched.
--
-- 3. `api.audit_events` — one read-only SECURITY DEFINER RPC backing the
--    object-history panels and the administration audit explorer. It filters
--    by entity type / operation / actor / time range / free text / related
--    object, paginates deterministically by the per-workspace gapless
--    sequence (descending cursor), resolves actor display names, and restricts
--    sensitive security/administration event classes (credentials,
--    invitations, settings, project access) to owner/admin/steward members.
--    Cross-workspace isolation remains claim-bound; api_client is denied —
--    the explorer is a human-session surface.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary widening.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK (entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'model_field_option', 'file',
    'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship',
    'dataset', 'dataset_version',
    'sample_event', 'comment', 'review_submission', 'signature',
    'review_decision',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement',
    'plate_design', 'plate_well', 'plate_layout_template',
    'calendar_resource', 'calendar_booking', 'calendar_booking_participant',
    'calendar_booking_sample',
    'study_workstream', 'study_task', 'study_task_dependency',
    'study_task_assignment', 'study_task_resource', 'study_deliverable',
    'study_project', 'study_experiment', 'study_plan_snapshot',
    'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot',
    'instrument_qc_check', 'instrument_raw_file', 'instrument_run_link',
    'report_definition', 'report_section', 'report_generation',
    'sheet_instance', 'sheet_definition', 'sheet_definition_version',
    'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential'
  ));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Record trigger: keep every existing payload key; add narrow before/after
--    values for human-facing metadata fields on update.
-- ---------------------------------------------------------------------------
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
      'changedStructure', (OLD.structure_version IS DISTINCT FROM NEW.structure_version),
      'changes', jsonb_strip_nulls(jsonb_build_object(
        'title', CASE WHEN OLD.title IS DISTINCT FROM NEW.title
          THEN jsonb_build_object('from', OLD.title, 'to', NEW.title) END,
        'status', CASE WHEN OLD.status IS DISTINCT FROM NEW.status
          THEN jsonb_build_object('from', OLD.status, 'to', NEW.status) END,
        'folderId', CASE WHEN OLD.folder_id IS DISTINCT FROM NEW.folder_id
          THEN jsonb_build_object('from', OLD.folder_id, 'to', NEW.folder_id) END
      ))
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
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. File trigger: carry display-name/media-type renames the same way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_file_objects"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
  v_record "api"."records";
  v_project_id uuid;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = NEW.record_id;
    v_project_id := v_record.project_id;
    v_op := 'create';
    v_payload := jsonb_build_object(
      'recordId', NEW.record_id, 'storageKey', NEW.storage_key,
      'displayName', NEW.display_name, 'mediaType', NEW.media_type,
      'byteSize', NEW.byte_size, 'status', NEW.status
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'file', NEW.id, v_op, NEW.record_id, v_project_id, v_payload
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = NEW.record_id;
    v_project_id := v_record.project_id;
    IF OLD.status = 'active' AND NEW.status = 'quarantined' THEN
      v_op := 'quarantine';
    ELSIF OLD.status = 'quarantined' AND NEW.status = 'active' THEN
      v_op := 'restore';
    ELSIF OLD.status <> 'deleted' AND NEW.status = 'deleted' THEN
      v_op := 'delete';
    ELSIF OLD.status = 'deleted' AND NEW.status = 'active' THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'recordId', NEW.record_id, 'status', NEW.status,
      'statusReason', NEW.status_reason,
      'byteSize', NEW.byte_size, 'checksum', NEW.checksum,
      'version', NEW.version,
      'displayName', NEW.display_name,
      'mediaType', NEW.media_type,
      'changes', jsonb_strip_nulls(jsonb_build_object(
        'displayName', CASE WHEN OLD.display_name IS DISTINCT FROM NEW.display_name
          THEN jsonb_build_object('from', OLD.display_name, 'to', NEW.display_name) END,
        'mediaType', CASE WHEN OLD.media_type IS DISTINCT FROM NEW.media_type
          THEN jsonb_build_object('from', OLD.media_type, 'to', NEW.media_type) END
      ))
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'file', NEW.id, v_op, NEW.record_id, v_project_id, v_payload
    );
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = OLD.record_id;
    v_project_id := COALESCE(v_record.project_id, NULL);
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'file', OLD.id, 'delete', OLD.record_id, v_project_id,
      jsonb_build_object('recordId', OLD.record_id, 'storageKey', OLD.storage_key)
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4a. Datasets — create/update/archive/restore/delete. Lifecycle follows the
--     active <-> archived transition exactly like records.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_datasets"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_schema_version integer;
  v_old_schema_version integer;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT version INTO v_schema_version
      FROM "api"."dataset_schema_versions" WHERE id = NEW.schema_version_id;
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'dataset', NEW.id, 'create', NULL, NEW.primary_project_id,
      jsonb_build_object('name', NEW.name, 'description', NEW.description,
        'schemaVersionId', NEW.schema_version_id,
        'schemaVersion', v_schema_version, 'revision', NEW.revision)
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    SELECT version INTO v_schema_version
      FROM "api"."dataset_schema_versions" WHERE id = NEW.schema_version_id;
    SELECT version INTO v_old_schema_version
      FROM "api"."dataset_schema_versions" WHERE id = OLD.schema_version_id;
    IF OLD.lifecycle = 'active' AND NEW.lifecycle = 'archived' THEN
      v_op := 'archive';
    ELSIF OLD.lifecycle = 'archived' AND NEW.lifecycle = 'active' THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'dataset', NEW.id, v_op, NULL, NEW.primary_project_id,
      jsonb_build_object('name', NEW.name, 'description', NEW.description,
        'schemaVersionId', NEW.schema_version_id,
        'schemaVersion', v_schema_version, 'revision', NEW.revision,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'name', CASE WHEN OLD.name IS DISTINCT FROM NEW.name
            THEN jsonb_build_object('from', OLD.name, 'to', NEW.name) END,
          'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description
            THEN jsonb_build_object('from', OLD.description, 'to', NEW.description) END,
          'schemaVersion', CASE WHEN OLD.schema_version_id IS DISTINCT FROM NEW.schema_version_id
            THEN jsonb_build_object('from', v_old_schema_version, 'to', v_schema_version) END
        ))
      )
    );
  ELSE
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'dataset', OLD.id, 'delete', NULL, OLD.primary_project_id,
      jsonb_build_object('name', OLD.name)
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_datasets"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_datasets" ON "api"."datasets";
CREATE TRIGGER "change_event_datasets"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."datasets"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_datasets"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4b. Dataset Versions — immutable snapshots; create-only events carrying the
--     parent Dataset identity so history panels can correlate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_dataset_versions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent "api"."datasets";
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT * INTO v_parent FROM "api"."datasets" WHERE id = NEW.dataset_id;
    IF v_parent.id IS NULL THEN
      RETURN NULL;
    END IF;
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'dataset_version', NEW.id, 'create', NULL,
      v_parent.primary_project_id,
      jsonb_build_object('datasetId', NEW.dataset_id, 'label', NEW.label,
        'sourceRevision', NEW.source_dataset_revision,
        'schemaVersionId', NEW.schema_version_id)
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_dataset_versions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_dataset_versions" ON "api"."dataset_versions";
CREATE TRIGGER "change_event_dataset_versions"
  AFTER INSERT ON "api"."dataset_versions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_dataset_versions"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4c. Sheet Instances — create/update/archive/restore/delete. Events carry
--     record_id = owning notebook record so they flow into record timelines.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_sheet_instances"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_definition_version integer;
  v_old_definition_version integer;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT version INTO v_definition_version
      FROM "api"."sheet_definition_versions" WHERE id = NEW.source_definition_version_id;
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'sheet_instance', NEW.id, 'create', NEW.notebook_record_id,
      NEW.project_id,
      jsonb_build_object('name', NEW.name, 'description', NEW.description,
        'sourceDefinitionVersionId', NEW.source_definition_version_id,
        'definitionVersion', v_definition_version, 'revision', NEW.revision)
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    SELECT version INTO v_definition_version
      FROM "api"."sheet_definition_versions" WHERE id = NEW.source_definition_version_id;
    SELECT version INTO v_old_definition_version
      FROM "api"."sheet_definition_versions" WHERE id = OLD.source_definition_version_id;
    IF OLD.lifecycle = 'active' AND NEW.lifecycle = 'archived' THEN
      v_op := 'archive';
    ELSIF OLD.lifecycle = 'archived' AND NEW.lifecycle = 'active' THEN
      v_op := 'restore';
    ELSE
      v_op := 'update';
    END IF;
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'sheet_instance', NEW.id, v_op, NEW.notebook_record_id,
      NEW.project_id,
      jsonb_build_object('name', NEW.name, 'description', NEW.description,
        'sourceDefinitionVersionId', NEW.source_definition_version_id,
        'definitionVersion', v_definition_version, 'revision', NEW.revision,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'name', CASE WHEN OLD.name IS DISTINCT FROM NEW.name
            THEN jsonb_build_object('from', OLD.name, 'to', NEW.name) END,
          'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description
            THEN jsonb_build_object('from', OLD.description, 'to', NEW.description) END,
          'definitionVersion', CASE
            WHEN OLD.source_definition_version_id IS DISTINCT FROM NEW.source_definition_version_id
            THEN jsonb_build_object('from', v_old_definition_version, 'to', v_definition_version) END
        ))
      )
    );
  ELSE
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'sheet_instance', OLD.id, 'delete', OLD.notebook_record_id,
      OLD.project_id,
      jsonb_build_object('name', OLD.name)
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_sheet_instances"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_sheet_instances" ON "api"."sheet_instances";
CREATE TRIGGER "change_event_sheet_instances"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."sheet_instances"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_sheet_instances"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4d/e. Notebook Templates and Sheet Definitions catalogues plus their
--       version tables. Catalogue rows follow create/update/delete; versions
--       emit create plus lifecycle transitions as explicit before/after
--       values (publish/retire are ordinary lifecycle updates, never hidden
--       behind synthetic operations).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_notebook_templates"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'notebook_template', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('name', NEW.name, 'description', NEW.description))
    ;
  ELSIF (TG_OP = 'UPDATE') THEN
    v_op := 'update';
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'notebook_template', NEW.id, v_op, NULL, NULL,
      jsonb_build_object('name', NEW.name, 'description', NEW.description,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'name', CASE WHEN OLD.name IS DISTINCT FROM NEW.name
            THEN jsonb_build_object('from', OLD.name, 'to', NEW.name) END,
          'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description
            THEN jsonb_build_object('from', OLD.description, 'to', NEW.description) END
        ))
      )
    );
  ELSE
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'notebook_template', OLD.id, 'delete', NULL, NULL,
      jsonb_build_object('name', OLD.name));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_notebook_templates"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_notebook_templates" ON "api"."notebook_templates";
CREATE TRIGGER "change_event_notebook_templates"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."notebook_templates"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_notebook_templates"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_notebook_template_versions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent "api"."notebook_templates";
BEGIN
  SELECT * INTO v_parent FROM "api"."notebook_templates" WHERE id = NEW.template_id;
  IF v_parent.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      v_parent.workspace_id, 'notebook_template_version', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('templateId', NEW.template_id, 'version', NEW.version,
        'lifecycle', NEW.lifecycle));
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM "internal"."emit_change_event"(
      v_parent.workspace_id, 'notebook_template_version', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('templateId', NEW.template_id, 'version', NEW.version,
        'lifecycle', NEW.lifecycle,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'lifecycle', CASE WHEN OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
            THEN jsonb_build_object('from', OLD.lifecycle, 'to', NEW.lifecycle) END
        ))
      )
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_notebook_template_versions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_notebook_template_versions" ON "api"."notebook_template_versions";
CREATE TRIGGER "change_event_notebook_template_versions"
  AFTER INSERT OR UPDATE ON "api"."notebook_template_versions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_notebook_template_versions"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_sheet_definitions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'sheet_definition', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('key', NEW.key, 'name', NEW.name,
        'description', NEW.description, 'lifecycle', NEW.lifecycle));
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'sheet_definition', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('key', NEW.key, 'name', NEW.name,
        'description', NEW.description, 'lifecycle', NEW.lifecycle,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'name', CASE WHEN OLD.name IS DISTINCT FROM NEW.name
            THEN jsonb_build_object('from', OLD.name, 'to', NEW.name) END,
          'description', CASE WHEN OLD.description IS DISTINCT FROM NEW.description
            THEN jsonb_build_object('from', OLD.description, 'to', NEW.description) END,
          'lifecycle', CASE WHEN OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
            THEN jsonb_build_object('from', OLD.lifecycle, 'to', NEW.lifecycle) END
        ))
      )
    );
  ELSE
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'sheet_definition', OLD.id, 'delete', NULL, NULL,
      jsonb_build_object('key', OLD.key, 'name', OLD.name));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_sheet_definitions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_sheet_definitions" ON "api"."sheet_definitions";
CREATE TRIGGER "change_event_sheet_definitions"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."sheet_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_sheet_definitions"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_sheet_definition_versions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_parent "api"."sheet_definitions";
BEGIN
  SELECT * INTO v_parent FROM "api"."sheet_definitions" WHERE id = NEW.definition_id;
  IF v_parent.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      v_parent.workspace_id, 'sheet_definition_version', NEW.id, 'create', NULL, NULL,
      jsonb_build_object('definitionId', NEW.definition_id, 'version', NEW.version,
        'lifecycle', NEW.lifecycle));
  ELSIF (TG_OP = 'UPDATE') THEN
    PERFORM "internal"."emit_change_event"(
      v_parent.workspace_id, 'sheet_definition_version', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('definitionId', NEW.definition_id, 'version', NEW.version,
        'lifecycle', NEW.lifecycle,
        'changes', jsonb_strip_nulls(jsonb_build_object(
          'lifecycle', CASE WHEN OLD.lifecycle IS DISTINCT FROM NEW.lifecycle
            THEN jsonb_build_object('from', OLD.lifecycle, 'to', NEW.lifecycle) END
        ))
      )
    );
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_sheet_definition_versions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_sheet_definition_versions" ON "api"."sheet_definition_versions";
CREATE TRIGGER "change_event_sheet_definition_versions"
  AFTER INSERT OR UPDATE ON "api"."sheet_definition_versions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_sheet_definition_versions"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4f/g/h. Governance rows: submissions, signatures and decisions become
--         visible in the shared event stream (INSERT-only, matching their
--         append-only contract). Each carries the revision identity so
--         correlation stays explicit — never timestamp inference.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_review_submissions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'review_submission', NEW.id, 'create', NEW.record_id, NULL,
      jsonb_build_object('revisionId', NEW.revision_id, 'state', NEW.state,
        'workflowKey', NEW.workflow_definition_key,
        'workflowVersion', NEW.workflow_definition_version));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_review_submissions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_review_submissions" ON "api"."review_submissions";
CREATE TRIGGER "change_event_review_submissions"
  AFTER INSERT ON "api"."review_submissions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_review_submissions"();
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_signatures"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'signature', NEW.id, 'create', NEW.record_id, NULL,
      jsonb_build_object('revisionId', NEW.revision_id,
        'submissionId', NEW.submission_id,
        'signatureMeaning', NEW.signature_meaning,
        'assuranceLevel', NEW.assurance_level));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_signatures"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_signatures" ON "api"."signatures";
CREATE TRIGGER "change_event_signatures"
  AFTER INSERT ON "api"."signatures"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_signatures"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_review_decisions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'review_decision', NEW.id, 'create', NEW.record_id, NULL,
      jsonb_build_object('submissionId', NEW.submission_id,
        'revisionId', NEW.revision_id, 'decision', NEW.decision));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_review_decisions"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "change_event_review_decisions" ON "api"."review_decisions";
CREATE TRIGGER "change_event_review_decisions"
  AFTER INSERT ON "api"."review_decisions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_review_decisions"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. api.audit_events — filtered, deterministic, permission-aware read model
--    over api.change_events. Human sessions only; any workspace member may
--    read general event classes (ADR 0016 contract); credential/invitation/
--    settings/access events additionally require owner/admin/steward.
--    Pagination walks the gapless per-workspace sequence descending; the
--    response carries an exclusive nextCursor and hasMore instead of a total
--    count so counts of inaccessible objects can never leak.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."audit_events"(
  p_entity_type text DEFAULT NULL,
  p_operation text DEFAULT NULL,
  p_actor_user_id text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_object uuid DEFAULT NULL,
  p_before_sequence bigint DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_role text;
  v_privileged boolean;
  v_search_like text;
  v_limit integer;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL
     OR nullif(v_claims->>'sub', '') IS NULL
     OR nullif(v_claims->>'session_id', '') IS NULL
     OR v_claims->>'role' <> 'authenticated' THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;

  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = v_workspace
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  v_privileged := v_role IN ('owner', 'admin', 'steward');

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_search_like := '%' ||
    replace(replace(replace(btrim(COALESCE(p_search, '')), '\', '\\'), '%', '\%'), '_', '\%') ||
    '%';

  RETURN (
    WITH matches AS MATERIALIZED (
      SELECT e.sequence AS seq,
             e.id AS event_id,
             e.created_at AS created_at,
             e.entity_type AS entity_type,
             e.entity_uuid AS entity_uuid,
             e.operation AS operation,
             e.record_id AS record_id,
             e.project_id AS project_id,
             e.actor_user_id AS actor_user_id,
             e.actor_credential_id AS actor_credential_id,
             e.client_id AS client_id,
             e.payload AS payload,
             actor.name AS actor_name
      FROM api.change_events e
      LEFT JOIN "internal"."user" actor ON actor.id = e.actor_user_id
      WHERE e.workspace_id = v_workspace
        AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
        AND (p_operation IS NULL OR e.operation = p_operation)
        AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
        AND (p_from IS NULL OR e.created_at >= p_from)
        AND (p_to IS NULL OR e.created_at < p_to)
        AND (p_before_sequence IS NULL OR e.sequence < p_before_sequence)
        AND (
          v_privileged
          OR e.entity_type NOT IN (
            'api_credential', 'workspace_invitation', 'workspace_settings',
            'project_access'
          )
        )
        AND (
          btrim(COALESCE(p_search, '')) = ''
          OR e.payload::text ILIKE v_search_like
          OR e.entity_type ILIKE v_search_like
          OR e.operation ILIKE v_search_like
        )
        AND (
          p_object IS NULL
          OR e.entity_uuid = p_object
          OR e.record_id = p_object
          OR e.payload->>'datasetId' = p_object::text
          OR e.payload->>'templateId' = p_object::text
          OR e.payload->>'definitionId' = p_object::text
          OR e.payload->>'instanceId' = p_object::text
          OR e.payload->>'rotatedFromCredentialId' = p_object::text
          OR e.payload->>'rotatedToCredentialId' = p_object::text
        )
    ),
    page AS (
      SELECT * FROM matches ORDER BY seq DESC LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'formatVersion', 1,
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sequence', seq,
          'id', event_id,
          'createdAt', to_char(created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'entityType', entity_type,
          'entityUuid', entity_uuid,
          'operation', operation,
          'recordId', record_id,
          'projectId', project_id,
          'actorUserId', actor_user_id,
          'actorName', actor_name,
          'actorCredentialId', actor_credential_id,
          'clientId', client_id,
          'payload', payload
        ) ORDER BY seq DESC)
        FROM page
      ), '[]'::jsonb),
      'hasMore', EXISTS (SELECT 1 FROM matches OFFSET v_limit),
      'nextCursor', (SELECT MIN(seq) FROM page)
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  FROM PUBLIC, api_client;
GRANT EXECUTE ON FUNCTION "api"."audit_events"(text, text, text, timestamptz, timestamptz, text, uuid, bigint, integer)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
