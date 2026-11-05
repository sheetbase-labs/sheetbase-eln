-- Web Push: alerts that reach a phone with the app closed.
--
-- A person turns alerts on from a tap on their device; the browser hands back a
-- subscription, kept here. Every bell notification for an event they have push
-- on for becomes a queued delivery, which the server's push worker sends to each
-- of their devices (quiet hours hold it, like email). The payload carries the
-- person's unread count so the app icon badge stays right with the app closed.
-- Booking reminders are a new bell event, written shortly before a booking starts.

-- One server key pair identifies this install to the push services. It is made
-- by the server on first start and never leaves the database except as the
-- public half the browser needs.
CREATE TABLE internal.push_vapid_keys (
    singleton boolean DEFAULT true NOT NULL,
    public_key text NOT NULL,
    private_jwk jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT push_vapid_keys_pkey PRIMARY KEY (singleton),
    CONSTRAINT chk_push_vapid_singleton CHECK (singleton)
);
--> statement-breakpoint
ALTER TABLE internal.push_vapid_keys OWNER TO migrator;
--> statement-breakpoint

-- One row per browser or phone that has alerts on.
CREATE TABLE internal.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    workspace_id uuid,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint),
    CONSTRAINT push_subscriptions_user_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_push_subscriptions_endpoint CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 2000)
);
--> statement-breakpoint
ALTER TABLE internal.push_subscriptions OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_push_subscriptions_user ON internal.push_subscriptions (user_id);
--> statement-breakpoint

-- The outbox: one row per message per device, retried a few times.
CREATE TABLE internal.push_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    subscription_id uuid NOT NULL,
    user_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    CONSTRAINT push_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT push_deliveries_subscription_fk FOREIGN KEY (subscription_id) REFERENCES internal.push_subscriptions(id) ON DELETE CASCADE,
    CONSTRAINT chk_push_deliveries_status CHECK (status IN ('pending', 'sending', 'sent', 'dead'))
);
--> statement-breakpoint
ALTER TABLE internal.push_deliveries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_push_deliveries_due ON internal.push_deliveries (next_attempt_at) WHERE status IN ('pending', 'sending');
--> statement-breakpoint

-- Push is a channel beside in-app, email and digest.
ALTER TABLE api.notification_events ADD COLUMN default_push boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE api.notification_preferences ADD COLUMN push boolean;
--> statement-breakpoint
-- Someone who already switched an event off everywhere meant it: phone alerts
-- do not come back on for it.
UPDATE api.notification_preferences SET push = false WHERE NOT in_app AND NOT email AND NOT digest;
--> statement-breakpoint

-- A notification can name the alert it replaces, so a page that already alerted
-- (a step timer) and the phone alert for the same thing show once.
ALTER TABLE internal.notifications ADD COLUMN dedupe_tag text;
--> statement-breakpoint

-- Time-sensitive events go to a phone unless the person turns them off.
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('booking_reminder', 'notification', ARRAY[]::text[], false, true);
--> statement-breakpoint
UPDATE api.notification_events SET default_push = true
 WHERE event_type IN ('step_timer', 'signature_requested', 'comment_or_mention', 'review_requested', 'instrument_booking');
--> statement-breakpoint

DROP FUNCTION api.save_notification_preference(text, boolean, boolean, boolean);
--> statement-breakpoint
CREATE FUNCTION api.save_notification_preference(p_event_type text, p_in_app boolean, p_email boolean, p_digest boolean, p_push boolean DEFAULT NULL) RETURNS api.notification_preferences
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
    (user_id, event_type, in_app, email, digest, push)
  VALUES
    (v_user_id, p_event_type, coalesce(p_in_app, true),
     coalesce(p_email, v_event.default_email), coalesce(p_digest, false),
     coalesce(p_push, v_event.default_push))
  ON CONFLICT (user_id, event_type) DO UPDATE
    SET in_app = EXCLUDED.in_app,
        email = EXCLUDED.email,
        digest = EXCLUDED.digest,
        push = coalesce(p_push, api.notification_preferences.push, v_event.default_push),
        updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.save_notification_preference(p_event_type text, p_in_app boolean, p_email boolean, p_digest boolean, p_push boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_notification_preference(p_event_type text, p_in_app boolean, p_email boolean, p_digest boolean, p_push boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_notification_preference(p_event_type text, p_in_app boolean, p_email boolean, p_digest boolean, p_push boolean) TO authenticated;
--> statement-breakpoint

-- A notification is written when the person wants it in the app, by email, in
-- the digest or on their phone.
CREATE OR REPLACE FUNCTION internal.notification_recipient_enabled(p_user_id text, p_event_type text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce((
    SELECT p.in_app OR p.email OR p.digest OR coalesce(p.push, e.default_push)
      FROM api.notification_preferences p
      JOIN api.notification_events e ON e.event_type = p.event_type
     WHERE p.user_id = p_user_id
       AND p.event_type = p_event_type
  ), true)
$$;
--> statement-breakpoint

-- Save this device for the signed-in person. A phone that changes hands moves
-- to whoever turns alerts on there.
CREATE FUNCTION api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'save_push_subscription requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_endpoint, '') !~ '^https://' OR char_length(p_endpoint) > 2000
     OR coalesce(p_p256dh, '') = '' OR coalesce(p_auth, '') = '' THEN
    RAISE EXCEPTION 'not a push subscription' USING ERRCODE = '22023';
  END IF;
  INSERT INTO internal.push_subscriptions (user_id, workspace_id, endpoint, p256dh, auth, user_agent)
  VALUES (v_user, api.current_workspace_id(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        workspace_id = EXCLUDED.workspace_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text) TO authenticated;
--> statement-breakpoint

-- Turn alerts off for a device. Only the owner's own device can be removed.
CREATE FUNCTION api.remove_push_subscription(p_endpoint text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM internal.push_subscriptions
   WHERE endpoint = p_endpoint AND user_id = api.current_user_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_push_subscription(p_endpoint text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_push_subscription(p_endpoint text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_push_subscription(p_endpoint text) TO authenticated;
--> statement-breakpoint

-- Which of the caller's devices have alerts on, so a device can show its own state.
CREATE FUNCTION api.my_push_devices() RETURNS TABLE (endpoint text, user_agent text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT s.endpoint, s.user_agent, s.created_at
    FROM internal.push_subscriptions s
   WHERE s.user_id = api.current_user_id()
   ORDER BY s.created_at DESC
$$;
--> statement-breakpoint
ALTER FUNCTION api.my_push_devices() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.my_push_devices() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.my_push_devices() TO authenticated;
--> statement-breakpoint

-- The public half of the server key, for the browser to subscribe with. Empty
-- until the server has made its key (a few seconds after first start).
CREATE FUNCTION api.get_push_public_key() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT public_key FROM internal.push_vapid_keys
   WHERE api.current_user_id() IS NOT NULL
$$;
--> statement-breakpoint
ALTER FUNCTION api.get_push_public_key() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.get_push_public_key() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.get_push_public_key() TO authenticated;
--> statement-breakpoint

-- Used by the push worker: make the key on first start; whichever server gets
-- there first wins and every other reads that one back.
CREATE FUNCTION internal.ensure_push_vapid_keys(p_public_key text, p_private_jwk jsonb) RETURNS internal.push_vapid_keys
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v internal.push_vapid_keys;
BEGIN
  INSERT INTO internal.push_vapid_keys (public_key, private_jwk)
  VALUES (p_public_key, p_private_jwk)
  ON CONFLICT (singleton) DO NOTHING;
  SELECT * INTO v FROM internal.push_vapid_keys;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ensure_push_vapid_keys(p_public_key text, p_private_jwk jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ensure_push_vapid_keys(p_public_key text, p_private_jwk jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Queue a phone alert for every device of the person a notification is for,
-- when they have push on for that event (the event's default until they choose).
CREATE FUNCTION internal.queue_notification_push() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_push boolean;
  v_unread integer;
  v_body text;
  v_url text;
BEGIN
  SELECT coalesce(
           (SELECT p.push FROM api.notification_preferences p
             WHERE p.user_id = NEW.user_id AND p.event_type = NEW.event_type),
           (SELECT e.default_push FROM api.notification_events e
             WHERE e.event_type = NEW.event_type),
           false)
    INTO v_push;
  IF NOT v_push OR NOT EXISTS (
    SELECT 1 FROM internal.push_subscriptions s WHERE s.user_id = NEW.user_id
  ) THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_unread FROM internal.notifications n
   WHERE n.user_id = NEW.user_id AND n.read_at IS NULL;
  v_body := coalesce(
    NEW.body,
    (SELECT r.title FROM api.records r WHERE r.id = NEW.record_id),
    '');
  v_url := CASE WHEN NEW.record_id IS NOT NULL THEN '/records/' || NEW.record_id::text ELSE '/' END;
  INSERT INTO internal.push_deliveries (subscription_id, user_id, event_type, payload)
  SELECT s.id, NEW.user_id, NEW.event_type,
         jsonb_build_object(
           'title', NEW.title,
           'body', left(v_body, 300),
           'url', v_url,
           'tag', coalesce(NEW.dedupe_tag, 'notification-' || NEW.id::text),
           'badge', v_unread)
    FROM internal.push_subscriptions s
   WHERE s.user_id = NEW.user_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A phone alert is derived; it must never block the write it follows.
  RAISE WARNING 'notification push failed for %: %', NEW.event_type, SQLERRM;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.queue_notification_push() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER queue_notification_push AFTER INSERT ON internal.notifications FOR EACH ROW EXECUTE FUNCTION internal.queue_notification_push();
--> statement-breakpoint

-- Claim due deliveries for the push worker, with each device's keys. Quiet hours
-- hold a message until they end.
CREATE FUNCTION internal.claim_due_push_deliveries(p_limit integer DEFAULT 50) RETURNS TABLE (
    id uuid, subscription_id uuid, endpoint text, p256dh text, auth text, payload jsonb, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM internal.push_deliveries d
     WHERE d.status IN ('pending', 'sending')
       AND d.next_attempt_at <= now()
       AND NOT internal.email_held_for_quiet_hours(d.user_id, d.event_type)
     ORDER BY d.next_attempt_at ASC
     LIMIT greatest(1, least(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE internal.push_deliveries d
       SET status = 'sending', attempt = d.attempt + 1, next_attempt_at = now() + interval '2 minutes'
      FROM due WHERE d.id = due.id
    RETURNING d.id, d.subscription_id, d.payload, d.attempt
  )
  SELECT c.id, c.subscription_id, s.endpoint, s.p256dh, s.auth, c.payload, c.attempt
    FROM claimed c
    JOIN internal.push_subscriptions s ON s.id = c.subscription_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.claim_due_push_deliveries(p_limit integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_due_push_deliveries(p_limit integer) FROM PUBLIC;
--> statement-breakpoint

-- Record the outcome. 'gone' means the push service says the device has
-- unsubscribed, so the device is forgotten; a failure retries up to 3 times.
CREATE FUNCTION internal.finish_push_delivery(p_id uuid, p_outcome text, p_error text DEFAULT NULL) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v internal.push_deliveries;
BEGIN
  SELECT * INTO v FROM internal.push_deliveries WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RETURN; END IF;
  IF p_outcome = 'sent' THEN
    UPDATE internal.push_deliveries SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = p_id;
    UPDATE internal.push_subscriptions SET last_sent_at = now() WHERE id = v.subscription_id;
  ELSIF p_outcome = 'gone' THEN
    DELETE FROM internal.push_subscriptions WHERE id = v.subscription_id;
  ELSIF v.attempt >= 3 THEN
    UPDATE internal.push_deliveries SET status = 'dead', last_error = left(p_error, 500) WHERE id = p_id;
  ELSE
    UPDATE internal.push_deliveries
       SET status = 'pending', last_error = left(p_error, 500),
           next_attempt_at = now() + (v.attempt * interval '1 minute')
     WHERE id = p_id;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.finish_push_delivery(p_id uuid, p_outcome text, p_error text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.finish_push_delivery(p_id uuid, p_outcome text, p_error text) FROM PUBLIC;
--> statement-breakpoint

-- Old outcomes are not kept: sent and dead rows go after a week.
CREATE FUNCTION internal.prune_push_deliveries() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM internal.push_deliveries
   WHERE status IN ('sent', 'dead') AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.prune_push_deliveries() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prune_push_deliveries() FROM PUBLIC;
--> statement-breakpoint

-- A step timer's bell entry names the alert the open page raises for it, so a
-- phone that is in use shows one alert, not two.
CREATE OR REPLACE FUNCTION internal.sweep_step_timers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_timer api.step_timers;
  v_count integer := 0;
BEGIN
  FOR v_timer IN
    SELECT * FROM api.step_timers
     WHERE status = 'running' AND notified_at IS NULL AND ends_at <= now()
     ORDER BY ends_at
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE api.step_timers SET notified_at = now() WHERE id = v_timer.id;
    IF internal.notification_recipient_enabled(v_timer.user_id, 'step_timer') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, dedupe_tag)
      VALUES (v_timer.workspace_id, v_timer.user_id, 'step_timer',
              'Timer finished', v_timer.label, v_timer.record_id,
              'step-timer-' || v_timer.id::text);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint

-- Booking reminders: 15 minutes before a booking starts, everyone on it hears
-- once. A booking made inside that window is reminded straight away.
CREATE TABLE internal.booking_reminders (
    booking_id uuid NOT NULL,
    user_id text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_reminders_pkey PRIMARY KEY (booking_id, user_id),
    CONSTRAINT booking_reminders_booking_fk FOREIGN KEY (booking_id) REFERENCES api.calendar_bookings(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.booking_reminders OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.sweep_booking_reminders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row record;
  v_count integer := 0;
  v_resource text;
BEGIN
  FOR v_row IN
    SELECT b.id, b.workspace_id, b.title, b.starts_at, b.resource_id, b.project_id,
           b.linked_experiment_record_id, p.user_id
      FROM api.calendar_bookings b
      JOIN api.calendar_booking_participants p ON p.booking_id = b.id
     WHERE b.status <> 'cancelled'
       AND p.user_id IS NOT NULL
       AND b.starts_at > now()
       AND b.starts_at <= now() + interval '15 minutes'
       AND NOT EXISTS (
         SELECT 1 FROM internal.booking_reminders r
          WHERE r.booking_id = b.id AND r.user_id = p.user_id)
       AND EXISTS (SELECT 1 FROM internal."user" u WHERE u.id = p.user_id)
     ORDER BY b.starts_at
     FOR UPDATE OF b SKIP LOCKED
  LOOP
    INSERT INTO internal.booking_reminders (booking_id, user_id)
    VALUES (v_row.id, v_row.user_id)
    ON CONFLICT DO NOTHING;
    IF internal.notification_recipient_enabled(v_row.user_id, 'booking_reminder') THEN
      SELECT name INTO v_resource FROM api.calendar_resources WHERE id = v_row.resource_id;
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, project_id, dedupe_tag)
      VALUES (v_row.workspace_id, v_row.user_id, 'booking_reminder',
              'Booking starts soon',
              concat_ws(' · ', v_row.title, v_resource),
              v_row.linked_experiment_record_id, v_row.project_id,
              'booking-' || v_row.id::text);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sweep_booking_reminders() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sweep_booking_reminders() FROM PUBLIC;
