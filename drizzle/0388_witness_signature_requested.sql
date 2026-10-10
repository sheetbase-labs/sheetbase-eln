-- WORK-03.2 — signature_requested, derived from the witness request's own event.
--
-- api.request_signature_witness already emits a review_submission update whose
-- payload names the action and the witness, so the notification needs no new
-- producer: the trigger reads that payload and addresses the witness. This is the
-- second of the four design event types that had no notification.
--
-- The function is patched from its current definition, and the guard checks for the
-- branch rather than for a name the function mentions anyway.
DO $$ DECLARE definition text; anchor text; extra text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal' AND p.proname = 'notify_from_change_event';

  anchor := E'  ELSIF NEW.entity_type = ''calendar_booking'' AND NEW.operation = ''create'' THEN';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'notify_from_change_event anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'signature_requested') > 0 THEN
    RETURN;  -- already covers witness requests
  END IF;

  extra := E'  ELSIF NEW.entity_type = ''review_submission'' AND NEW.operation = ''update''\n'
    || E'        AND NEW.payload->>''action'' = ''witness-requested'' THEN\n'
    || E'    recipient := nullif(NEW.payload->>''witnessUserId'', '''');\n'
    || E'    IF recipient IS NOT NULL AND recipient IS DISTINCT FROM NEW.actor_user_id\n'
    || E'       AND internal.notification_recipient_enabled(recipient, ''signature_requested'') THEN\n'
    || E'      INSERT INTO internal.notifications\n'
    || E'        (workspace_id, user_id, event_type, title, body, record_id, project_id)\n'
    || E'      VALUES (NEW.workspace_id, recipient, ''signature_requested'',\n'
    || E'              ''Signature requested'', NULL, NEW.record_id, NEW.project_id);\n'
    || E'    END IF;\n'
    || anchor;

  EXECUTE replace(definition, anchor, extra);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
