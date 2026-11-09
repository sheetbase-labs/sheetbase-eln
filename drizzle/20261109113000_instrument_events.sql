-- Instruments, connectors and parsers on the change feed.
--
-- Webhooks, live updates, plugins and pipeline triggers hear about an
-- instrument being added, retired, brought back, taken out of service or put
-- back, calibrated, and about people being qualified; about connectors,
-- connector runs and parsers. Event bodies are summaries (never a
-- certificate, a note or a secret).

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(
    v_def,
    '::text]',
    '::text, ''instrument_state''::text, ''instrument_calibration''::text, ''instrument_qualification''::text, ''instrument_qualification_request''::text]'
  );
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('instrument.created'), ('instrument.updated'), ('instrument.retired'), ('instrument.reinstated'),
  ('instrument.out_of_service'), ('instrument.back_in_service'), ('instrument.calibrated'),
  ('instrument.qualification_set'), ('instrument.qualification_revoked'),
  ('instrument.qualification_requested'), ('instrument.qualification_request_closed'),
  ('resource.created'),
  ('connector.created'), ('connector.updated'),
  ('connector.run.started'), ('connector.run.completed'), ('connector.run.failed'),
  ('parser.created'), ('parser.version.created'), ('parser.version.approved')
ON CONFLICT (name) DO NOTHING;
--> statement-breakpoint

-- Events that can start a pipeline.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''storage.alarm.raised'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''storage.alarm.raised'',',
    '''booking.created'', ''booking.updated'', ''booking.cancelled'', ''import.created'', ''import.committed'', ''import.failed'', ''instrument.run.created'', ''instrument.run.completed'', ''instrument.run.failed'', ''instrument.created'', ''instrument.updated'', ''instrument.retired'', ''instrument.reinstated'', ''instrument.out_of_service'', ''instrument.back_in_service'', ''instrument.calibrated'', ''instrument.qualification_set'', ''instrument.qualification_revoked'', ''instrument.qualification_requested'', ''instrument.qualification_request_closed'', ''resource.created'', ''connector.created'', ''connector.updated'', ''connector.run.started'', ''connector.run.completed'', ''connector.run.failed'', ''parser.created'', ''parser.version.created'', ''parser.version.approved'', ''storage.alarm.raised'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- The database's copy of the pipeline action catalogue (checked when a
-- pipeline is saved) learns the instrument, booking and run actions.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"create_instrument","rpc":"create_instrument","label":"Add an instrument","description":"Add an instrument to the workspace. Needs the right to manage instruments.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_instrument_type","type":"text","required":false,"nullable":false},{"name":"p_model","type":"text","required":false,"nullable":true},{"name":"p_serial_number","type":"text","required":false,"nullable":true},{"name":"p_vendor","type":"text","required":false,"nullable":true},{"name":"p_location","type":"text","required":false,"nullable":true}]},{"operation":"set_instrument_retired","rpc":"set_instrument_retired","label":"Retire an instrument, or bring it back","description":"A retired instrument cannot be booked or used for new runs; its history stays.","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_retired","type":"boolean","required":true,"nullable":false}]},{"operation":"record_instrument_calibration","rpc":"record_instrument_calibration","label":"Record a calibration","description":"Record that an instrument was calibrated and when the next calibration is due.","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_performed_at","type":"timestamptz","required":true,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"set_instrument_qualification","rpc":"set_instrument_qualification","label":"Qualify a person on an instrument","description":"Say a person may use an instrument until a date. Needs the right to manage instruments.","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_valid_until","type":"timestamptz","required":true,"nullable":false},{"name":"p_qualified_for","type":"text","required":false,"nullable":true}]},{"operation":"revoke_instrument_qualification","rpc":"revoke_instrument_qualification","label":"Take away a qualification","description":"End a person’s qualification on an instrument.","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"create_booking","rpc":"create_booking","label":"Book an instrument","description":"Book an instrument or room for a time, as the person the pipeline runs as. Its booking rules and training checks apply.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_resource_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_starts_at","type":"timestamptz","required":true,"nullable":false},{"name":"p_ends_at","type":"timestamptz","required":true,"nullable":false},{"name":"p_timezone","type":"text","required":false,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_linked_experiment_record_id","type":"uuid","required":false,"nullable":true}]},{"operation":"cancel_booking","rpc":"cancel_booking","label":"Cancel a booking","description":"Cancel a booking; it stays on record.","arguments":[{"name":"p_booking_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":false,"nullable":true}]},{"operation":"create_instrument_run","rpc":"create_instrument_run","label":"Start recording an instrument run","description":"Record a new run on an instrument, waiting to start.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_run_identifier","type":"text","required":true,"nullable":false},{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_protocol_name","type":"text","required":false,"nullable":true},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_plate_format","type":"text","required":false,"nullable":false},{"name":"p_operator","type":"text","required":false,"nullable":true}]},{"operation":"start_instrument_run","rpc":"start_instrument_run","label":"Mark an instrument run as running","description":"Move a queued instrument run to running.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_run_id","type":"uuid","required":true,"nullable":false}]},{"operation":"complete_instrument_run","rpc":"complete_instrument_run","label":"Mark an instrument run as completed","description":"Finish an instrument run. Pipelines that start when a run completes will run.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_run_id","type":"uuid","required":true,"nullable":false}]},{"operation":"fail_instrument_run","rpc":"fail_instrument_run","label":"Mark an instrument run as failed","description":"End an instrument run as failed, with what went wrong.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_error_message","type":"text","required":false,"nullable":true}]},{"operation":"link_run_record","rpc":"link_run_record","label":"Link a run to an experiment","description":"Say which experiment or record an instrument run belongs to.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_run_id","type":"uuid","required":true,"nullable":false},{"name":"p_linked_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_link_type","type":"text","required":false,"nullable":false}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Retiring, bringing back, taking out of service and putting back.
CREATE FUNCTION internal.trg_change_event_instrument_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF (OLD.retired_at IS NULL) IS DISTINCT FROM (NEW.retired_at IS NULL) THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument_state', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('instrumentId', NEW.id, 'name', NEW.name,
        'effect', CASE WHEN NEW.retired_at IS NULL THEN 'reinstated' ELSE 'retired' END));
  END IF;
  IF (OLD.out_of_service_at IS NULL) IS DISTINCT FROM (NEW.out_of_service_at IS NULL) THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument_state', NEW.id, 'update', NULL, NULL,
      jsonb_build_object('instrumentId', NEW.id, 'name', NEW.name,
        'effect', CASE WHEN NEW.out_of_service_at IS NULL THEN 'back_in_service' ELSE 'out_of_service' END,
        'reason', NEW.out_of_service_reason, 'expectedBackOn', NEW.expected_back_on));
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_state() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_state AFTER UPDATE OF retired_at, out_of_service_at ON api.instruments
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument_state();
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_instrument_calibration() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument_calibration', NEW.id, 'create', NULL, NULL,
    jsonb_build_object('instrumentId', NEW.instrument_id, 'performedAt', NEW.performed_at, 'dueAt', NEW.due_at));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_calibration() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_calibrations AFTER INSERT ON api.instrument_calibrations
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument_calibration();
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_instrument_qualification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(
    COALESCE(NEW.workspace_id, OLD.workspace_id), 'instrument_qualification',
    COALESCE(NEW.id, OLD.id),
    CASE TG_OP WHEN 'DELETE' THEN 'delete' ELSE 'update' END, NULL, NULL,
    jsonb_build_object('instrumentId', COALESCE(NEW.instrument_id, OLD.instrument_id),
      'userId', COALESCE(NEW.user_id, OLD.user_id), 'validUntil', NEW.valid_until));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_qualification() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_qualifications AFTER INSERT OR UPDATE OR DELETE ON api.instrument_qualifications
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument_qualification();
--> statement-breakpoint

CREATE FUNCTION internal.trg_change_event_instrument_qualification_request() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(NEW.workspace_id, 'instrument_qualification_request', NEW.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END, NULL, NULL,
    jsonb_build_object('instrumentId', NEW.instrument_id, 'userId', NEW.user_id, 'status', NEW.status));
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_instrument_qualification_request() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_qualification_requests AFTER INSERT OR UPDATE OF status ON api.instrument_qualification_requests
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument_qualification_request();
