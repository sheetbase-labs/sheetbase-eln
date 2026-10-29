-- Webhook subscriptions only accept event names the catalogue emits, and
-- approval requests announce themselves on the change feed.
--
-- Webhook events are checked against the catalogue's names (canonical names
-- and the wire names still accepted as aliases). A name nobody emits used to
-- save quietly and never fire.
CREATE TABLE internal.webhook_event_names (
    name text NOT NULL,
    CONSTRAINT webhook_event_names_pkey PRIMARY KEY (name)
);
--> statement-breakpoint
ALTER TABLE internal.webhook_event_names OWNER TO migrator;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('project.created'), ('project.updated'), ('project.deleted'), ('project.archived'), ('project.restored'),
  ('record.created'), ('record.updated'), ('record.moved'), ('record.deleted'), ('record.archived'), ('record.restored'),
  ('record.amended'), ('record.signed'),
  ('dataset.created'), ('dataset.updated'), ('dataset.archived'), ('dataset.restored'), ('dataset.versioned'),
  ('sheet.created'), ('sheet.updated'), ('sheet.archived'), ('sheet.restored'),
  ('sheet.definition.created'), ('sheet.definition.updated'), ('sheet.definition.versioned'),
  ('sheet_instance.created'), ('sheet_instance.updated'), ('sheet_instance.archived'), ('sheet_instance.restored'),
  ('sheet_definition.created'), ('sheet_definition.updated'), ('sheet_definition.versioned'),
  ('notebook.submitted'), ('notebook.amended'), ('notebook.signed'), ('review.decided'),
  ('notebook.template.created'), ('notebook.template.updated'), ('notebook.template.versioned'),
  ('notebook_template.created'), ('notebook_template.updated'), ('notebook_template.versioned'),
  ('sample.received'), ('sample.moved'), ('sample.consumed'), ('sample.released'),
  ('sample.quarantined'), ('sample.disposed'), ('sample.hold_exceeded'),
  ('booking.created'), ('booking.updated'), ('booking.cancelled'),
  ('import.created'), ('import.committed'), ('import.failed'),
  ('approval.requested'), ('approval.approved'), ('approval.returned'), ('approval.withdrawn'),
  ('pipeline.created'), ('pipeline.updated'), ('pipeline.deleted'),
  ('pipeline.version.created'), ('pipeline.version.updated'),
  ('pipeline.run.created'), ('pipeline.run.updated'), ('pipeline.run.completed'),
  ('pipeline.schedule.created'), ('pipeline.schedule.updated'),
  ('workspace.invitation.created'), ('workspace.invitation.updated'), ('workspace.invitation.deleted'),
  ('workspace.settings.created'), ('workspace.settings.updated'),
  ('project.access.granted'), ('project.access.updated'), ('project.access.revoked'),
  ('workspace.credential.created'), ('workspace.credential.revoked');
--> statement-breakpoint
CREATE FUNCTION internal.check_webhook_event_types() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_item text;
BEGIN
  FOR v_item IN SELECT jsonb_array_elements_text(NEW.event_types) LOOP
    IF NOT EXISTS (SELECT 1 FROM internal.webhook_event_names n WHERE n.name = v_item) THEN
      RAISE EXCEPTION 'unknown event type: %', v_item USING ERRCODE = 'SB034';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_webhook_event_types() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER check_webhook_event_types BEFORE INSERT OR UPDATE OF event_types ON api.webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION internal.check_webhook_event_types();
--> statement-breakpoint
-- Approval requests announce themselves on the change feed, so webhooks and
-- live updates can tell people when an approval is asked for or decided.
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK ((entity_type = ANY (ARRAY['project'::text, 'analysis_view'::text, 'folder'::text, 'record'::text, 'block'::text, 'record_link'::text, 'scientific_table'::text, 'scientific_row'::text, 'formula'::text, 'calculation'::text, 'record_field_definition'::text, 'model_field_option'::text, 'file'::text, 'dataset_schema'::text, 'dataset_schema_field'::text, 'dataset_schema_relationship'::text, 'dataset'::text, 'dataset_version'::text, 'sample_event'::text, 'comment'::text, 'review_submission'::text, 'record_model_version'::text, 'protocol_version'::text, 'protocol_deviation'::text, 'signature'::text, 'review_decision'::text, 'storage_site'::text, 'storage_room'::text, 'storage_unit'::text, 'storage_shelf'::text, 'storage_rack'::text, 'storage_box'::text, 'storage_position'::text, 'storage_movement'::text, 'plate_design'::text, 'plate_well'::text, 'plate_layout_template'::text, 'calendar_resource'::text, 'calendar_booking'::text, 'calendar_booking_participant'::text, 'calendar_booking_sample'::text, 'study_workstream'::text, 'study_task'::text, 'study_task_dependency'::text, 'study_task_assignment'::text, 'study_task_resource'::text, 'study_deliverable'::text, 'study_project'::text, 'study_experiment'::text, 'study_plan_snapshot'::text, 'instrument'::text, 'instrument_run'::text, 'instrument_run_stage'::text, 'instrument_observation'::text, 'instrument_plate_snapshot'::text, 'instrument_qc_check'::text, 'instrument_raw_file'::text, 'instrument_run_link'::text, 'report_definition'::text, 'report_section'::text, 'report_generation'::text, 'sheet_instance'::text, 'sheet_definition'::text, 'sheet_definition_version'::text, 'notebook_template'::text, 'notebook_template_version'::text, 'workspace_invitation'::text, 'workspace_settings'::text, 'project_access'::text, 'workspace_group'::text, 'workspace_group_membership'::text, 'project_access_request'::text, 'api_credential'::text, 'connector'::text, 'connector_run'::text, 'pipeline_definition'::text, 'pipeline_definition_version'::text, 'pipeline_run'::text, 'pipeline_schedule'::text, 'webhook_subscription'::text, 'webhook_delivery'::text, 'agent_operation_policy'::text, 'agent_operation_proposal'::text, 'extension'::text, 'dataset_import_file'::text, 'dataset_import'::text, 'parser'::text, 'parser_version'::text, 'system'::text, 'material'::text, 'approval_request'::text])));
--> statement-breakpoint
CREATE FUNCTION internal.trg_change_event_approval_requests() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(
    NEW.workspace_id,
    'approval_request',
    NEW.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
    CASE WHEN NEW.object_kind = 'record' THEN NEW.object_id END,
    NULL,
    jsonb_build_object(
      'state', NEW.state,
      'objectKind', NEW.object_kind,
      'objectId', NEW.object_id,
      'requiredApprovals', NEW.required_approvals,
      'submittedByUserId', NEW.submitted_by_user_id,
      'decidedByUserId', NEW.decided_by_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_approval_requests() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_approval_requests AFTER INSERT OR UPDATE ON api.approval_requests FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_approval_requests();
