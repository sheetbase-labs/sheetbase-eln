-- WORK-03.2 — give instrument bookings a producer, so the instrument_booking
-- notification can be derived like the other design event types.
--
-- The eight design event types are derived from api.change_events, but four of them
-- had no producer: nothing emitted a change event for a booking, a check result, a
-- witness request or a hold transition. This adds the booking one — create, edit and
-- cancel — and extends the notification trigger to address the booking's participants.
--
-- Both functions are patched from their current definitions, so nothing already in
-- them is lost.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = 'create_booking';

  anchor := E'  RETURN v_booking;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_booking anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'calendar_booking') > 0 THEN
    RETURN;  -- already emits
  END IF;

  guard := E'  PERFORM internal.emit_change_event(\n'
    || E'    v_booking.workspace_id, ''calendar_booking'', v_booking.id, ''create'',\n'
    || E'    v_booking.linked_experiment_record_id, v_booking.project_id,\n'
    || E'    jsonb_build_object(''title'', v_booking.title, ''displayId'', v_booking.display_id,\n'
    || E'      ''startsAt'', v_booking.starts_at, ''endsAt'', v_booking.ends_at));\n\n'
    || anchor;

  EXECUTE replace(definition, anchor, guard);
END $$;
--> statement-breakpoint

-- The notification trigger learns the booking type: the participants are told, the
-- person who made the booking is not.
DO $$ DECLARE definition text; anchor text; extra text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal' AND p.proname = 'notify_from_change_event';

  anchor := E'  ELSIF NEW.entity_type = ''comment'' AND NEW.operation = ''create'' THEN';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'notify_from_change_event anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'instrument_booking') > 0 THEN
    RETURN;  -- already covers bookings
  END IF;

  extra := E'  ELSIF NEW.entity_type = ''calendar_booking'' AND NEW.operation = ''create'' THEN\n'
    || E'    FOR recipient IN\n'
    || E'      SELECT p.user_id FROM api.calendar_booking_participants p\n'
    || E'       WHERE p.booking_id = NEW.entity_uuid\n'
    || E'         AND p.user_id IS DISTINCT FROM NEW.actor_user_id\n'
    || E'    LOOP\n'
    || E'      IF internal.notification_recipient_enabled(recipient, ''instrument_booking'') THEN\n'
    || E'        INSERT INTO internal.notifications\n'
    || E'          (workspace_id, user_id, event_type, title, body, record_id, project_id)\n'
    || E'        VALUES (NEW.workspace_id, recipient, ''instrument_booking'',\n'
    || E'                ''Instrument booking'', NULL, NEW.record_id, NEW.project_id);\n'
    || E'      END IF;\n'
    || E'    END LOOP;\n'
    || anchor;

  EXECUTE replace(definition, anchor, extra);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
