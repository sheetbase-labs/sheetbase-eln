-- WORK-03.2 — material_expiring, the last of the eight design event types.
--
-- The other seven are derived from events the application already emits. Nothing
-- emitted anything for a lot approaching expiry, so this adds the producer: a
-- function that emits one event per reagent lot inside the warning window, and a
-- trigger branch that turns it into the design's "Material lot expiring in 7 days"
-- notification for the lot's creator.
--
-- The producer is idempotent per lot: a lot that already has a material_expiring
-- event is skipped, so a sweep every few hours does not repeat itself.
CREATE OR REPLACE FUNCTION internal.emit_reagent_expiry_events(p_window_days integer DEFAULT 7)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r record;
  v_emitted integer := 0;
  v_sequence bigint;
BEGIN
  FOR r IN
    SELECT rec.id, rec.workspace_id, rec.project_id, rec.identifier, rec.title,
           rec.properties->>'expiry' AS expiry
      FROM api.records rec
     WHERE rec.kind = 'reagent'
       AND rec.deleted_at IS NULL
       AND rec.archived_at IS NULL
       AND rec.status = 'available'
       AND rec.properties->>'expiry' ~ '^\d{4}-\d{2}-\d{2}$'
       AND (rec.properties->>'expiry')::date
             BETWEEN current_date AND current_date + (p_window_days || ' days')::interval
       AND NOT EXISTS (
             SELECT 1 FROM api.change_events e
              WHERE e.entity_type = 'reagent' AND e.entity_uuid = rec.id
                AND e.payload->>'action' = 'expiring')
     ORDER BY (rec.properties->>'expiry')::date, rec.id
  LOOP
    -- A scheduled sweep has no user claims, and internal.emit_change_event is a
    -- no-op without a claim probe, so the system event is written directly with no
    -- actor (the same shape the nightly audit job uses). The chain trigger fills the
    -- hashes.
    INSERT INTO api.workspace_change_seq(workspace_id, last_seq) VALUES(r.workspace_id, 1)
      ON CONFLICT (workspace_id) DO UPDATE
        SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
      RETURNING last_seq INTO v_sequence;
    INSERT INTO api.change_events
      (id, workspace_id, sequence, entity_type, entity_uuid, operation, project_id, payload)
    VALUES (gen_random_uuid(), r.workspace_id, v_sequence, 'reagent', r.id, 'update',
            r.project_id,
            jsonb_build_object('action', 'expiring', 'identifier', r.identifier,
                               'title', r.title, 'expiry', r.expiry));
    v_emitted := v_emitted + 1;
  END LOOP;
  RETURN v_emitted;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_reagent_expiry_events(integer)
  FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- 'reagent' joins the audit subject vocabulary: the expiry event is about a lot.
DO $$ DECLARE v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'chk_change_events_entity_type'
     AND conrelid = 'api.change_events'::regclass;
  IF strpos(v_def, '''reagent''') > 0 THEN
    RETURN;  -- already allowed
  END IF;
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '
       || replace(v_def, ']))', ', ''reagent''::text]))');
END $$;
--> statement-breakpoint

DO $$ DECLARE definition text; anchor text; extra text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'internal' AND p.proname = 'notify_from_change_event';

  anchor := E'  ELSIF NEW.entity_type = ''dataset'' AND NEW.operation = ''create''';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'notify_from_change_event anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'material_expiring') > 0 THEN
    RETURN;  -- already covers expiring lots
  END IF;

  extra := E'  ELSIF NEW.entity_type = ''reagent'' AND NEW.operation = ''update''\n'
    || E'        AND NEW.payload->>''action'' = ''expiring'' THEN\n'
    || E'    SELECT r.created_by_user_id INTO recipient FROM api.records r WHERE r.id = NEW.entity_uuid;\n'
    || E'    IF recipient IS NOT NULL AND recipient IS DISTINCT FROM NEW.actor_user_id\n'
    || E'       AND internal.notification_recipient_enabled(recipient, ''material_expiring'') THEN\n'
    || E'      INSERT INTO internal.notifications\n'
    || E'        (workspace_id, user_id, event_type, title, body, record_id, project_id)\n'
    || E'      VALUES (NEW.workspace_id, recipient, ''material_expiring'',\n'
    || E'              ''Material lot expiring in 7 days'', NEW.payload->>''identifier'',\n'
    || E'              NEW.entity_uuid, NEW.project_id);\n'
    || E'    END IF;\n'
    || anchor;

  EXECUTE replace(definition, anchor, extra);
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
