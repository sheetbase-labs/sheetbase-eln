-- One list of events behind the Inbox, notification preferences, email and
-- webhooks.
--
-- Before this, the Inbox (about 30 derived work-item kinds), notifications
-- (8 kinds with in-app, email and digest choices) and webhooks (a third list)
-- did not line up: most Inbox items could not be muted or emailed, protocol
-- training notices used a ninth kind that preferences did not know, the Email
-- column was never read (nothing queued an email when a notification arrived)
-- and the Daily digest column was never read either.
--
-- api.notification_events names every event a person can mute or email, and
-- the Inbox kinds each one covers. Preferences point at it. Muting an event
-- hides its Inbox items and its bell notifications; Email sends it.

CREATE TABLE api.notification_events (
    event_type text NOT NULL,
    -- 'notification': a notification row is written when it happens, so email
    -- follows the row. 'inbox': the item only exists as a derived Inbox row, so
    -- a sweep emails it.
    source text NOT NULL,
    inbox_kinds text[] DEFAULT '{}'::text[] NOT NULL,
    default_email boolean DEFAULT true NOT NULL,
    CONSTRAINT notification_events_pkey PRIMARY KEY (event_type),
    CONSTRAINT chk_notification_events_source CHECK ((source = ANY (ARRAY['notification'::text, 'inbox'::text])))
);
--> statement-breakpoint
ALTER TABLE api.notification_events OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.notification_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_events_read ON api.notification_events FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
GRANT SELECT ON TABLE api.notification_events TO authenticated;
--> statement-breakpoint
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email) VALUES
  ('review_requested', 'notification', ARRAY['review_requested'], true),
  ('review_returned_or_signed', 'notification', ARRAY['review_returned', 'witness_signed'], true),
  ('signature_requested', 'notification', ARRAY['witness_requested', 'approval_unsigned'], true),
  ('validation_error', 'notification', ARRAY['data_issue'], true),
  ('comment_or_mention', 'notification', ARRAY[]::text[], true),
  ('instrument_booking', 'notification', ARRAY[]::text[], true),
  ('material_expiring', 'notification', ARRAY['material_expiring'], true),
  ('protocol_new_version', 'notification', ARRAY[]::text[], true),
  ('protocol_training_required', 'notification', ARRAY[]::text[], true),
  ('approval_requested', 'inbox', ARRAY['approval_requested'], false),
  ('cell_conflict', 'inbox', ARRAY['cell_conflict'], false),
  ('run_failed', 'inbox', ARRAY['run_failed'], false),
  ('run_waiting', 'inbox', ARRAY['run_waiting'], false),
  ('sample_awaiting_release', 'inbox', ARRAY['sample_awaiting_release'], false),
  ('sample_hold_exceeded', 'inbox', ARRAY['sample_hold_exceeded'], false),
  ('calibration_overdue', 'inbox', ARRAY['calibration_overdue'], false),
  ('qualification_requested', 'inbox', ARRAY['qualification_requested'], false),
  ('qualification_granted', 'inbox', ARRAY['qualification_granted'], false),
  ('access_requested', 'inbox', ARRAY['access_requested'], false),
  ('access_decided', 'inbox', ARRAY['access_decided'], false),
  ('invitation_accepted', 'inbox', ARRAY['invitation_accepted'], false),
  ('verification_requested', 'inbox', ARRAY['verification_requested'], false),
  ('verification_granted', 'inbox', ARRAY['verification_granted'], false),
  ('agent_proposal', 'inbox', ARRAY['agent_proposal'], false);
--> statement-breakpoint
ALTER TABLE api.notification_preferences DROP CONSTRAINT chk_notification_preferences_event;
--> statement-breakpoint
ALTER TABLE api.notification_preferences
    ADD CONSTRAINT notification_preferences_event_fk FOREIGN KEY (event_type)
    REFERENCES api.notification_events(event_type) ON UPDATE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.save_notification_preference(p_event_type text, p_in_app boolean, p_email boolean, p_digest boolean) RETURNS api.notification_preferences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v_event api.notification_events;
  v api.notification_preferences;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'save_notification_preference requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM api.notification_events WHERE event_type = p_event_type;
  IF v_event.event_type IS NULL THEN
    RAISE EXCEPTION 'unknown notification event type' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.notification_preferences
    (user_id, event_type, in_app, email, digest)
  VALUES
    (v_user_id, p_event_type, coalesce(p_in_app, true),
     coalesce(p_email, v_event.default_email), coalesce(p_digest, false))
  ON CONFLICT (user_id, event_type) DO UPDATE
    SET in_app = EXCLUDED.in_app,
        email = EXCLUDED.email,
        digest = EXCLUDED.digest,
        updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
-- A notification is written when the person wants it in the app, by email or
-- in the digest, so turning the app off no longer swallows the email.
CREATE OR REPLACE FUNCTION internal.notification_recipient_enabled(p_user_id text, p_event_type text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((
    SELECT p.in_app OR p.email OR p.digest FROM api.notification_preferences p
     WHERE p.user_id = p_user_id
       AND p.event_type = p_event_type
  ), true)
$$;
--> statement-breakpoint
-- True when the signed-in person has switched this event off in the app.
CREATE FUNCTION internal.event_muted_in_app(p_event_type text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((
    SELECT NOT p.in_app FROM api.notification_preferences p
     WHERE p.user_id = api.current_user_id()
       AND p.event_type = p_event_type
  ), false)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.event_muted_in_app(p_event_type text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.event_muted_in_app(p_event_type text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.event_muted_in_app(p_event_type text) TO authenticated;
--> statement-breakpoint
-- True when the signed-in person has muted every event that covers this Inbox kind.
CREATE FUNCTION internal.inbox_kind_muted(p_kind text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (
    SELECT 1
      FROM api.notification_events e
      JOIN api.notification_preferences p
        ON p.event_type = e.event_type AND p.user_id = api.current_user_id()
     WHERE p_kind = ANY (e.inbox_kinds)
       AND NOT p.in_app
  )
$$;
--> statement-breakpoint
ALTER FUNCTION internal.inbox_kind_muted(p_kind text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.inbox_kind_muted(p_kind text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.inbox_kind_muted(p_kind text) TO authenticated;
--> statement-breakpoint
-- The bell leaves out events the person has muted.
CREATE OR REPLACE VIEW api.my_notifications AS
 SELECT id,
    workspace_id,
    user_id,
    event_type,
    title,
    body,
    record_id,
    project_id,
    created_at,
    read_at
   FROM internal.notifications
  WHERE ((user_id = api.current_user_id()) AND (workspace_id = api.current_workspace_id()) AND ((project_id IS NULL) OR internal.can_view_project(project_id)) AND ((record_id IS NULL) OR internal.can_access_object('record'::text, record_id, 'view'::text)) AND (NOT internal.event_muted_in_app(event_type)));
--> statement-breakpoint
-- The Inbox leaves out muted kinds everywhere it is read (the list, the
-- counts, Home), so the filter sits on the one view they all start from.
ALTER VIEW api.my_work_items SET SCHEMA internal;
--> statement-breakpoint
ALTER VIEW internal.my_work_items RENAME TO my_work_items_all;
--> statement-breakpoint
CREATE VIEW api.my_work_items WITH (security_invoker='true') AS
 SELECT kind,
    record_id,
    identifier,
    title,
    project_id,
    reason,
    due_at,
    state,
    created_at,
    source_type,
    source_id,
    parser_version_id,
    connector_id,
    revision_id,
    dataset_id,
    row_id,
    field_id
   FROM internal.my_work_items_all
  WHERE NOT internal.inbox_kind_muted(kind);
--> statement-breakpoint
ALTER VIEW api.my_work_items OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE api.my_work_items TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker='true') AS
 SELECT kind,
    record_id,
    identifier,
    title,
    project_id,
    reason,
    due_at,
    state,
    created_at,
    source_type,
    source_id,
    parser_version_id,
    connector_id,
    revision_id,
    dataset_id,
    row_id,
    field_id,
    ((kind || ':'::text) || COALESCE((source_id)::text, (record_id)::text, identifier, title, 'Untitled'::text)) AS item_key,
        CASE
            WHEN ((state = 'following'::text) OR (kind = 'following'::text)) THEN 'following'::text
            WHEN ((state = 'done_today'::text) OR (EXISTS ( SELECT 1
               FROM api.work_item_views v
              WHERE ((v.item_key = ((i.kind || ':'::text) || COALESCE((i.source_id)::text, (i.record_id)::text, i.identifier, i.title, 'Untitled'::text))) AND (v.workspace_id = api.current_workspace_id()) AND (v.user_id = api.current_user_id()))))) THEN 'done-today'::text
            ELSE 'needs-action'::text
        END AS inbox_tab,
        CASE
            WHEN (kind = ANY (ARRAY['review_requested'::text, 'witness_requested'::text, 'review_returned'::text, 'approval_unsigned'::text, 'witness_signed'::text])) THEN 'reviews'::text
            WHEN (kind = ANY (ARRAY['data_issue'::text, 'cell_conflict'::text])) THEN 'data'::text
            WHEN (kind = ANY (ARRAY['run_failed'::text, 'run_waiting'::text])) THEN 'runs'::text
            WHEN (kind = 'material_expiring'::text) THEN 'materials'::text
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = 'agent_proposal'::text) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));
--> statement-breakpoint
-- Email follows the notification. When the person has email on for the event
-- (it defaults on), a notification becomes a queued email; the outbox already
-- holds it through quiet hours and retries it.
CREATE FUNCTION internal.queue_notification_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_email boolean;
BEGIN
  SELECT coalesce(
           (SELECT p.email FROM api.notification_preferences p
             WHERE p.user_id = NEW.user_id AND p.event_type = NEW.event_type),
           (SELECT e.default_email FROM api.notification_events e
             WHERE e.event_type = NEW.event_type),
           false)
    INTO v_email;
  IF v_email THEN
    PERFORM internal.enqueue_email_delivery(
      NEW.workspace_id, NEW.user_id, NEW.event_type, NEW.title,
      concat_ws(E'\n', NEW.title, NEW.body));
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Email is derived; it must never block the write it follows.
  RAISE WARNING 'notification email failed for %: %', NEW.event_type, SQLERRM;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.queue_notification_email() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER queue_notification_email AFTER INSERT ON internal.notifications FOR EACH ROW EXECUTE FUNCTION internal.queue_notification_email();
--> statement-breakpoint
-- The daily digest lists the events the person ticked for it.
CREATE OR REPLACE FUNCTION internal.enqueue_daily_digests() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  u record;
  v_titles text;
  v_workspace uuid;
  v_sent integer := 0;
BEGIN
  FOR u IN
    SELECT p.user_id, p.digest_time,
           (now() AT TIME ZONE coalesce(
              internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'))::date AS local_day
      FROM api.user_preferences p
     WHERE p.digest_time IS NOT NULL
       AND p.digest_time = to_char(
             now() AT TIME ZONE coalesce(
               internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'),
             'HH24:MI')
       AND (p.digest_last_sent_on IS NULL
            OR p.digest_last_sent_on < (now() AT TIME ZONE coalesce(
                 internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'))::date)
  LOOP
    SELECT string_agg(n.title, E'\n'), (array_agg(n.workspace_id))[1]
      INTO v_titles, v_workspace
      FROM internal.notifications n
      JOIN api.notification_preferences np
        ON np.user_id = n.user_id AND np.event_type = n.event_type AND np.digest
     WHERE n.user_id = u.user_id
       AND n.read_at IS NULL
       AND n.created_at >= now() - interval '1 day';
    CONTINUE WHEN v_titles IS NULL OR v_workspace IS NULL;
    PERFORM internal.enqueue_email_delivery(
      v_workspace, u.user_id, 'digest', 'Daily digest', v_titles
    );
    UPDATE api.user_preferences
       SET digest_last_sent_on = u.local_day, updated_at = now()
     WHERE user_id = u.user_id;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
--> statement-breakpoint
-- A queued email nobody could send for days is not worth sending late: the
-- first send after SMTP is set up would otherwise flood people with old mail.
CREATE OR REPLACE FUNCTION internal.claim_due_email_deliveries(p_limit integer DEFAULT 20) RETURNS SETOF internal.email_deliveries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  UPDATE internal.email_deliveries d
     SET status = 'dead', last_error = 'expired before it could be sent', updated_at = now()
   WHERE d.status = 'pending'
     AND d.created_at < now() - interval '3 days';
  RETURN QUERY
  UPDATE internal.email_deliveries d
     SET status = 'sending', attempt = d.attempt + 1, updated_at = now()
   WHERE d.id IN (
     SELECT id FROM internal.email_deliveries d2
      WHERE d2.status IN ('pending', 'sending')
        AND d2.next_attempt_at <= now()
        AND NOT internal.email_held_for_quiet_hours(d2.user_id, d2.event_type)
      ORDER BY d2.next_attempt_at ASC
      LIMIT greatest(1, least(p_limit, 200))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;
--> statement-breakpoint
-- Inbox-only events (nothing writes a notification row for them) are emailed by
-- a sweep that reads each subscriber's own Inbox. The log keeps one email per
-- item; the state row marks the first sweep, which only records what is already
-- waiting so turning Email on does not send a backlog.
CREATE TABLE internal.inbox_email_state (
    user_id text NOT NULL,
    event_type text NOT NULL,
    primed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbox_email_state_pkey PRIMARY KEY (user_id, event_type),
    CONSTRAINT inbox_email_state_user_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.inbox_email_state OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE internal.inbox_email_log (
    user_id text NOT NULL,
    item_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbox_email_log_pkey PRIMARY KEY (user_id, item_key),
    CONSTRAINT inbox_email_log_user_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.inbox_email_log OWNER TO migrator;
--> statement-breakpoint
-- Who has email on for an inbox-only event, in which workspace, and whether the
-- first sweep has run.
CREATE FUNCTION internal.inbox_email_subscribers() RETURNS TABLE(user_id text, workspace_id uuid, event_type text, inbox_kinds text[], primed boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.user_id,
         coalesce(up.active_workspace_id,
                  (SELECT m.workspace_id FROM api.workspace_memberships m
                    WHERE m.user_id = p.user_id AND m.suspended_at IS NULL
                    ORDER BY m.created_at LIMIT 1)),
         p.event_type,
         e.inbox_kinds,
         EXISTS (SELECT 1 FROM internal.inbox_email_state s
                  WHERE s.user_id = p.user_id AND s.event_type = p.event_type)
    FROM api.notification_preferences p
    JOIN api.notification_events e ON e.event_type = p.event_type
    LEFT JOIN api.user_preferences up ON up.user_id = p.user_id
   WHERE e.source = 'inbox' AND p.email
$$;
--> statement-breakpoint
ALTER FUNCTION internal.inbox_email_subscribers() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.inbox_email_subscribers() FROM PUBLIC;
--> statement-breakpoint
-- Record one waiting item. The first call for an item queues the email unless
-- the person's first sweep is still priming; it returns whether one was queued.
CREATE FUNCTION internal.queue_inbox_email(p_user_id text, p_workspace_id uuid, p_event_type text, p_item_key text, p_subject text, p_body text, p_prime boolean DEFAULT false) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_new integer;
BEGIN
  INSERT INTO internal.inbox_email_log (user_id, item_key)
  VALUES (p_user_id, p_item_key)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  IF v_new = 0 OR p_prime THEN
    RETURN false;
  END IF;
  PERFORM internal.enqueue_email_delivery(
    p_workspace_id, p_user_id, p_event_type, p_subject, p_body);
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.queue_inbox_email(p_user_id text, p_workspace_id uuid, p_event_type text, p_item_key text, p_subject text, p_body text, p_prime boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.queue_inbox_email(p_user_id text, p_workspace_id uuid, p_event_type text, p_item_key text, p_subject text, p_body text, p_prime boolean) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION internal.mark_inbox_email_primed(p_user_id text, p_event_type text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  INSERT INTO internal.inbox_email_state (user_id, event_type)
  VALUES (p_user_id, p_event_type)
  ON CONFLICT DO NOTHING
$$;
--> statement-breakpoint
ALTER FUNCTION internal.mark_inbox_email_primed(p_user_id text, p_event_type text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.mark_inbox_email_primed(p_user_id text, p_event_type text) FROM PUBLIC;
--> statement-breakpoint
