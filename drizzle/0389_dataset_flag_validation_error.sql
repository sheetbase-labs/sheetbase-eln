-- WORK-03.2 — validation_error, from a dataset value being flagged.
--
-- Nothing emitted a change event when a value was flagged, so the design's
-- "Validation error in your data" notification had no producer. api.flag_dataset_value
-- now emits one against the dataset, and the notification trigger addresses the
-- dataset's creator ("your data"), skipping whoever set the flag.
--
-- Both functions are patched from their current definitions, and each guard checks for
-- the text it adds rather than for a name the function mentions anyway.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = 'flag_dataset_value';

  anchor := E'  RETURN v;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'flag_dataset_value anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'emit_change_event') > 0 THEN
    RETURN;  -- already emits
  END IF;

  guard := E'  PERFORM internal.emit_change_event(\n'
    || E'    d.workspace_id, ''dataset'', d.id, ''create'', NULL, d.primary_project_id,\n'
    || E'    jsonb_build_object(''action'', ''value-flagged'', ''flagId'', v.id, ''kind'', v.kind));\n\n'
    || anchor;

  EXECUTE replace(definition, anchor, guard);
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text; extra text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal' AND p.proname = 'notify_from_change_event';

  anchor := E'  ELSIF NEW.entity_type = ''review_submission'' AND NEW.operation = ''update''';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'notify_from_change_event anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'validation_error') > 0 THEN
    RETURN;  -- already covers flagged values
  END IF;

  extra := E'  ELSIF NEW.entity_type = ''dataset'' AND NEW.operation = ''create''\n'
    || E'        AND NEW.payload->>''action'' = ''value-flagged'' THEN\n'
    || E'    SELECT d.created_by_user_id INTO recipient FROM api.datasets d WHERE d.id = NEW.entity_uuid;\n'
    || E'    IF recipient IS NOT NULL AND recipient IS DISTINCT FROM NEW.actor_user_id\n'
    || E'       AND internal.notification_recipient_enabled(recipient, ''validation_error'') THEN\n'
    || E'      INSERT INTO internal.notifications\n'
    || E'        (workspace_id, user_id, event_type, title, body, record_id, project_id)\n'
    || E'      VALUES (NEW.workspace_id, recipient, ''validation_error'',\n'
    || E'              ''Validation error in your data'', NULL, NEW.record_id, NEW.project_id);\n'
    || E'    END IF;\n'
    || anchor;

  EXECUTE replace(definition, anchor, extra);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
