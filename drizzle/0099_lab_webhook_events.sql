-- Webhook events for the lab features added since the original catalogue.
--
-- Reagent orders, stocktakes, shipments, requests, legal holds, retention,
-- sample workflows, incidents, registry entries, instrument limits and record
-- assignment all changed state without telling anyone outside the app. Each
-- state change now lands on the change feed, so webhooks, the live feed and
-- pipeline triggers can see it. Reagent orders, legal holds and the retention
-- rules already emitted change events; they only needed catalogue entries
-- (and retention gains one summary event below).

-- New kinds of thing on the change feed.
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK ((entity_type = ANY (ARRAY['project'::text, 'analysis_view'::text, 'folder'::text, 'record'::text, 'block'::text, 'record_link'::text, 'scientific_table'::text, 'scientific_row'::text, 'formula'::text, 'calculation'::text, 'record_field_definition'::text, 'model_field_option'::text, 'file'::text, 'dataset_schema'::text, 'dataset_schema_field'::text, 'dataset_schema_relationship'::text, 'dataset'::text, 'dataset_version'::text, 'sample_event'::text, 'comment'::text, 'review_submission'::text, 'record_model_version'::text, 'protocol_version'::text, 'protocol_deviation'::text, 'signature'::text, 'review_decision'::text, 'storage_site'::text, 'storage_room'::text, 'storage_unit'::text, 'storage_shelf'::text, 'storage_rack'::text, 'storage_box'::text, 'storage_position'::text, 'storage_movement'::text, 'plate_design'::text, 'plate_well'::text, 'plate_layout_template'::text, 'calendar_resource'::text, 'calendar_booking'::text, 'calendar_booking_participant'::text, 'calendar_booking_sample'::text, 'study_workstream'::text, 'study_task'::text, 'study_task_dependency'::text, 'study_task_assignment'::text, 'study_task_resource'::text, 'study_deliverable'::text, 'study_project'::text, 'study_experiment'::text, 'study_plan_snapshot'::text, 'instrument'::text, 'instrument_run'::text, 'instrument_run_stage'::text, 'instrument_observation'::text, 'instrument_plate_snapshot'::text, 'instrument_qc_check'::text, 'instrument_raw_file'::text, 'instrument_run_link'::text, 'report_definition'::text, 'report_section'::text, 'report_generation'::text, 'sheet_instance'::text, 'sheet_definition'::text, 'sheet_definition_version'::text, 'notebook_template'::text, 'notebook_template_version'::text, 'workspace_invitation'::text, 'workspace_settings'::text, 'project_access'::text, 'workspace_group'::text, 'workspace_group_membership'::text, 'project_access_request'::text, 'api_credential'::text, 'connector'::text, 'connector_run'::text, 'pipeline_definition'::text, 'pipeline_definition_version'::text, 'pipeline_run'::text, 'pipeline_schedule'::text, 'webhook_subscription'::text, 'webhook_delivery'::text, 'agent_operation_policy'::text, 'agent_operation_proposal'::text, 'extension'::text, 'dataset_import_file'::text, 'dataset_import'::text, 'parser'::text, 'parser_version'::text, 'system'::text, 'material'::text, 'approval_request'::text, 'member_handover'::text, 'member_absence'::text, 'idp_group_mapping'::text, 'member_passkey'::text, 'stocktake'::text, 'shipment'::text, 'request'::text, 'sample_workflow_run'::text, 'incident'::text, 'registry_entry'::text, 'instrument_feed'::text, 'record_assignment'::text])));
--> statement-breakpoint

-- Webhook subscriptions may list the new names.
INSERT INTO internal.webhook_event_names (name) VALUES
  ('reagent.order.requested'),
  ('reagent.order.placed'),
  ('reagent.order.received'),
  ('reagent.order.cancelled'),
  ('stocktake.completed'),
  ('shipment.sent'),
  ('shipment.in_transit'),
  ('shipment.received'),
  ('shipment.cancelled'),
  ('request.submitted'),
  ('request.decided'),
  ('legal_hold.created'),
  ('legal_hold.released'),
  ('retention.applied'),
  ('sample.workflow.advanced'),
  ('sample.workflow.enrolled'),
  ('sample.workflow.left'),
  ('incident.reported'),
  ('registry.entry.created'),
  ('instrument.reading.out_of_limits'),
  ('instrument.reading.back_in_range'),
  ('record.assigned');
--> statement-breakpoint

-- A count of the freezer is finished.
CREATE FUNCTION internal.trg_change_event_stocktakes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_counts jsonb;
BEGIN
  SELECT coalesce(jsonb_object_agg(c.state, c.n), '{}'::jsonb) INTO v_counts
    FROM (SELECT i.state, count(*) AS n FROM api.stocktake_items i
           WHERE i.stocktake_id = NEW.id GROUP BY i.state) c;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'stocktake', NEW.id, 'update', NULL, NULL,
    jsonb_build_object('status', NEW.status, 'stocktakeId', NEW.id, 'number', NEW.number,
                       'scopeLevel', NEW.scope_level, 'scopeName', NEW.scope_name,
                       'scopePath', NEW.scope_path, 'counts', v_counts,
                       'completedByUserId', NEW.completed_by));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_stocktakes() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_stocktakes AFTER UPDATE OF status ON api.stocktakes
  FOR EACH ROW WHEN (OLD.status = 'open' AND NEW.status = 'completed')
  EXECUTE FUNCTION internal.trg_change_event_stocktakes();
--> statement-breakpoint

-- A shipment leaves, is on its way, arrives or is called off. An outbound
-- shipment going into transit is "sent"; an inbound one is "in_transit".
CREATE FUNCTION internal.trg_change_event_shipments() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_event text;
BEGIN
  v_event := CASE NEW.status
    WHEN 'in_transit' THEN CASE NEW.direction WHEN 'outbound' THEN 'sent' ELSE 'in_transit' END
    WHEN 'received' THEN 'received'
    WHEN 'cancelled' THEN 'cancelled'
  END;
  IF v_event IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'shipment', NEW.id, 'update', NULL, NEW.project_id,
    jsonb_build_object('event', v_event, 'status', NEW.status, 'shipmentId', NEW.id,
                       'reference', 'SHP-' || lpad(NEW.number::text, 4, '0'),
                       'direction', NEW.direction, 'counterparty', NEW.counterparty,
                       'carrier', NEW.carrier, 'trackingReference', NEW.tracking_reference,
                       'expectedOn', NEW.expected_on,
                       'items', (SELECT count(*) FROM api.shipment_items i WHERE i.shipment_id = NEW.id)));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_shipments() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_shipments AFTER UPDATE OF status ON api.shipments
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION internal.trg_change_event_shipments();
--> statement-breakpoint

-- A request comes in, and is accepted, declined or completed.
CREATE FUNCTION internal.trg_change_event_requests() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.records;
  v_decided boolean := NEW.decided_at IS NOT NULL;
BEGIN
  SELECT * INTO r FROM api.records WHERE id = NEW.record_id;
  IF r.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'request', NEW.record_id,
    CASE WHEN v_decided THEN 'update' ELSE 'create' END, NEW.record_id, r.project_id,
    jsonb_build_object('recordId', r.id, 'identifier', r.identifier, 'title', r.title,
                       'model', r.kind, 'status', r.status,
                       'requestedByUserId', r.created_by_user_id)
    || CASE WHEN v_decided
            THEN jsonb_build_object('decision', r.status, 'decidedByUserId', NEW.decided_by)
            ELSE '{}'::jsonb END);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_requests() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_requests_submitted AFTER INSERT ON api.request_details
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_requests();
--> statement-breakpoint
CREATE TRIGGER change_event_requests_decided AFTER UPDATE OF decided_at ON api.request_details
  FOR EACH ROW WHEN (NEW.decided_at IS NOT NULL AND OLD.decided_at IS DISTINCT FROM NEW.decided_at)
  EXECUTE FUNCTION internal.trg_change_event_requests();
--> statement-breakpoint

-- A sample is enrolled in a workflow, moves between steps, or leaves it.
CREATE FUNCTION internal.trg_change_event_sample_workflow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.sample_workflow_runs;
  v_workflow_name text;
  v_project uuid;
  v_change text;
BEGIN
  v_change := CASE WHEN NEW.from_stage_name IS NULL THEN 'enrolled'
                   WHEN NEW.to_stage_name IS NULL THEN 'left'
                   ELSE 'advanced' END;
  SELECT * INTO v_run FROM api.sample_workflow_runs WHERE id = NEW.run_id;
  SELECT w.name INTO v_workflow_name FROM api.sample_workflows w WHERE w.id = v_run.workflow_id;
  SELECT r.project_id INTO v_project FROM api.records r WHERE r.id = NEW.record_id;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'sample_workflow_run', NEW.run_id, 'update',
    NEW.record_id, v_project,
    jsonb_build_object('change', v_change, 'runId', NEW.run_id, 'recordId', NEW.record_id,
                       'workflowId', v_run.workflow_id, 'workflow', v_workflow_name,
                       'fromStage', NEW.from_stage_name, 'toStage', NEW.to_stage_name,
                       'completed', v_run.completed_at IS NOT NULL));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_sample_workflow() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_sample_workflow AFTER INSERT ON api.sample_workflow_events
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_sample_workflow();
--> statement-breakpoint

-- An incident is logged, or an entry is added to a biological registry. Both
-- are ordinary records of a model with the right box ticked, so they are
-- spotted when the record is created.
CREATE FUNCTION internal.trg_change_event_record_created_kinds() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM api.model_incident_logs l
              WHERE l.workspace_id = NEW.workspace_id AND l.model_key = NEW.kind) THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'incident', NEW.id, 'create', NEW.id, NEW.project_id,
      jsonb_build_object('recordId', NEW.id, 'identifier', NEW.identifier, 'title', NEW.title,
                         'model', NEW.kind, 'status', NEW.status));
  END IF;
  IF EXISTS (SELECT 1 FROM api.record_models m
              WHERE m.workspace_id = NEW.workspace_id AND m.key = NEW.kind AND m.is_registry) THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'registry_entry', NEW.id, 'create', NEW.id, NEW.project_id,
      jsonb_build_object('recordId', NEW.id, 'identifier', NEW.identifier, 'title', NEW.title,
                         'registry', NEW.kind));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_record_created_kinds() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_record_created_kinds AFTER INSERT ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_record_created_kinds();
--> statement-breakpoint

-- A live feed reading crosses a limit, or comes back in range.
CREATE FUNCTION internal.trg_change_event_instrument_feeds() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text;
BEGIN
  SELECT i.name INTO v_name FROM api.instruments i WHERE i.id = NEW.instrument_id;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument_feed', NEW.id, 'update', NULL, NULL,
    jsonb_build_object('limitState', NEW.limit_state, 'previousState', OLD.limit_state,
                       'feedId', NEW.id, 'feed', NEW.name,
                       'instrumentId', NEW.instrument_id, 'instrument', v_name,
                       'value', NEW.last_value, 'unit', NEW.unit,
                       'lowLimit', NEW.low_limit, 'highLimit', NEW.high_limit,
                       'readingAt', NEW.last_at));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_feeds() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_feeds AFTER UPDATE OF limit_state ON api.instrument_feeds
  FOR EACH ROW WHEN (OLD.limit_state IS DISTINCT FROM NEW.limit_state)
  EXECUTE FUNCTION internal.trg_change_event_instrument_feeds();
--> statement-breakpoint

-- A record is given to someone, or taken back.
CREATE FUNCTION internal.trg_change_event_record_assignment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(NEW.workspace_id, 'record_assignment', NEW.id, 'update', NEW.id, NEW.project_id,
    jsonb_build_object('recordId', NEW.id, 'identifier', NEW.identifier, 'title', NEW.title,
                       'assigneeUserId', NEW.assignee_user_id,
                       'previousAssigneeUserId', OLD.assignee_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_record_assignment() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_record_assignment AFTER UPDATE OF assignee_user_id ON api.records
  FOR EACH ROW WHEN (OLD.assignee_user_id IS DISTINCT FROM NEW.assignee_user_id)
  EXECUTE FUNCTION internal.trg_change_event_record_assignment();
--> statement-breakpoint

-- Applying retention archives each due record (one event apiece, as before)
-- and now also says once how many were archived.
CREATE OR REPLACE FUNCTION api.apply_retention(p_kind text DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_id uuid;
  v_ids uuid[];
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  SELECT coalesce(array_agg(d.record_id), '{}') INTO v_ids FROM api.retention_due(p_kind) d;
  UPDATE api.records
     SET archived_at = now(), metadata_version = metadata_version + 1,
         updated_by_user_id = api.current_user_id()
   WHERE id = ANY (v_ids) AND archived_at IS NULL;
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM internal.emit_change_event(v_workspace_id, 'record', v_id, 'archive', v_id, NULL,
      jsonb_build_object('effect', 'retention'));
  END LOOP;
  IF coalesce(cardinality(v_ids), 0) > 0 THEN
    PERFORM internal.emit_change_event(v_workspace_id, 'workspace_settings', v_workspace_id, 'update', NULL, NULL,
      jsonb_build_object('effect', 'retention_applied', 'kind', p_kind, 'archived', cardinality(v_ids)));
  END IF;
  RETURN coalesce(cardinality(v_ids), 0);
END $$;

--> statement-breakpoint

-- Pipelines may be triggered by the lab events that sit in the record family
-- (PIPELINE_TRIGGER_EVENTS in src/lib/pipeline-schedule.ts).
CREATE OR REPLACE FUNCTION api.normalize_pipeline_event_type(p_event text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  CASE p_event
    -- Pre-catalogue name, kept working at the intake boundary.
    WHEN 'dataset_version_created' THEN RETURN 'dataset.versioned';
    -- Shipped wire aliases, kept working at the intake boundary.
    WHEN 'sheet_instance.created' THEN RETURN 'sheet.created';
    WHEN 'sheet_instance.updated' THEN RETURN 'sheet.updated';
    WHEN 'sheet_instance.archived' THEN RETURN 'sheet.archived';
    WHEN 'sheet_instance.restored' THEN RETURN 'sheet.restored';
    WHEN 'sheet_definition.created' THEN RETURN 'sheet.definition.created';
    WHEN 'sheet_definition.updated' THEN RETURN 'sheet.definition.updated';
    WHEN 'sheet_definition.versioned' THEN RETURN 'sheet.definition.versioned';
    WHEN 'notebook_template.created' THEN RETURN 'notebook.template.created';
    WHEN 'notebook_template.updated' THEN RETURN 'notebook.template.updated';
    WHEN 'notebook_template.versioned' THEN RETURN 'notebook.template.versioned';
    ELSE
      -- Canonical triggerable set: stable catalogue entries with a producer
      -- in the record/dataset/sheet/notebook families. Mirrors
      -- PIPELINE_TRIGGER_EVENTS in src/lib/pipeline-schedule.ts.
      IF p_event IN (
        'record.created', 'record.updated', 'record.moved',
        'record.deleted', 'record.archived', 'record.restored',
        'dataset.created', 'dataset.updated',
        'dataset.archived', 'dataset.restored',
        'dataset.versioned',
        'sheet.created', 'sheet.updated',
        'sheet.archived', 'sheet.restored',
        'sheet.definition.created', 'sheet.definition.updated',
        'sheet.definition.versioned',
        'notebook.submitted', 'review.decided', 'notebook.signed',
        'notebook.template.created', 'notebook.template.updated',
        'notebook.template.versioned',
        -- Lab features in the record family.
        'request.submitted', 'request.decided', 'incident.reported',
        'registry.entry.created', 'record.assigned'
      ) THEN
        RETURN p_event;
      END IF;
      RAISE EXCEPTION 'unsupported event trigger' USING ERRCODE = 'SB034';
  END CASE;
END $$;
