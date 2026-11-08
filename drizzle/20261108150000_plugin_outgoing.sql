-- Plugins that send data out.
--
-- Two more points join the others: publishers, which send a table to another
-- system (a repository, a LIMS, a chat message), and notification channels,
-- another way for a notification to reach a person (a Slack message, say).
-- Neither has a network of its own. The plugin's Python says which requests to
-- make and the app makes them, only to the hosts the plugin declared and only
-- over HTTPS (src/lib/extensions/data-runtime.server.ts).
--
-- This migration teaches the database's own manifest check the new shapes, so a
-- direct-SQL install is held to what the TypeScript check holds it to
-- (src/lib/extensions/data-points.ts). It also adds what an unattended send
-- needs:
--
--   * internal.extension_settings            what an administrator set for a
--                                            plugin's connection, secrets sealed
--   * internal.plugin_channel_subscriptions  who turned a channel on, and where
--                                            their notifications go
--   * internal.plugin_channel_deliveries     the outbox the channel worker reads,
--                                            filled by a trigger on notifications
--
-- Only the app reads and writes these (internal schema, granted to no one).

-- Per-point switches ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.extensions'::regclass AND conname = 'chk_extensions_disabled_points';
  IF v_def IS NULL OR position('''report-sections''::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_extensions_disabled_points';
  END IF;
  IF position('''publishers''' IN v_def) = 0 THEN
    EXECUTE 'ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points';
    EXECUTE 'ALTER TABLE api.extensions ADD CONSTRAINT chk_extensions_disabled_points '
      || replace(v_def, '''report-sections''::text]',
           '''report-sections''::text, ''publishers''::text, ''notification-channels''::text]');
  END IF;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'report-sections')$q$;
  v_new constant text := $q$'report-sections', 'publishers', 'notification-channels')$q$;
BEGIN
  IF position('''publishers''' IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'report-sections')$q$;
  v_new constant text := $q$'report-sections', 'publishers', 'notification-channels')$q$;
BEGIN
  IF position('''publishers''' IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END $$;
--> statement-breakpoint

-- Manifest validation ---------------------------------------------------------
DO $$
DECLARE
  v_def text := pg_get_functiondef('internal.validate_extension_runner_points(jsonb)'::regprocedure);
  v_loop_old constant text := $q$'sameness-keys', 'event-hooks', 'record-hooks'] LOOP$q$;
  v_loop_new constant text := $q$'sameness-keys', 'event-hooks', 'record-hooks', 'publishers', 'notification-channels'] LOOP$q$;
  v_called_old constant text := $q$IF v_point IN ('operations', 'calculators', 'pipeline-steps') THEN$q$;
  v_called_new constant text := $q$IF v_point IN ('operations', 'calculators', 'pipeline-steps', 'publishers') THEN$q$;
  v_conn_old constant text := $q$ELSIF v_point = 'connectors' THEN
        IF NOT internal.extension_strings_ok(v_entry->'hosts', c_host)
           OR NOT internal.extension_labelled_ok(v_entry->'settings', 'setting', 8, 0)
           OR NOT internal.extension_fields_ok(v_entry->'parameters')
           OR NOT internal.extension_runner_ok(v_entry->'parse') THEN
          RAISE EXCEPTION 'invalid extension connector' USING ERRCODE = 'SB034';
        END IF;$q$;
  v_conn_new constant text := $q$ELSIF v_point = 'connectors' THEN
        IF NOT internal.extension_strings_ok(v_entry->'hosts', c_host)
           OR NOT internal.extension_labelled_ok(v_entry->'settings', 'setting', 8, 0)
           OR NOT internal.extension_fields_ok(v_entry->'parameters')
           OR NOT internal.extension_runner_ok(v_entry->'parse') THEN
          RAISE EXCEPTION 'invalid extension connector' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'publishers' THEN
        IF NOT internal.extension_strings_ok(v_entry->'hosts', c_host)
           OR NOT internal.extension_labelled_ok(v_entry->'settings', 'setting', 8, 0)
           OR NOT internal.extension_fields_ok(v_entry->'parameters')
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_entry->'parameters') p
                       WHERE (p->>'name') IN ('rows', 'name'))
           OR NOT internal.extension_runner_ok(v_entry->'parse') THEN
          RAISE EXCEPTION 'invalid extension publisher' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'notification-channels' THEN
        IF NOT internal.extension_strings_ok(v_entry->'hosts', c_host)
           OR NOT internal.extension_labelled_ok(v_entry->'settings', 'setting', 8, 0)
           OR jsonb_typeof(v_entry->'destination') IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_entry->'destination'->'label') IS DISTINCT FROM 'string'
           OR length(btrim(v_entry->'destination'->>'label')) NOT BETWEEN 1 AND 80
           OR ((v_entry->'destination' ? 'hint')
               AND (jsonb_typeof(v_entry->'destination'->'hint') IS DISTINCT FROM 'string'
                    OR length(btrim(v_entry->'destination'->>'hint')) NOT BETWEEN 1 AND 120))
           OR ((v_entry ? 'parse') AND NOT internal.extension_runner_ok(v_entry->'parse')) THEN
          RAISE EXCEPTION 'invalid extension notification channel' USING ERRCODE = 'SB034';
        END IF;$q$;
BEGIN
  IF position('''publishers''' IN v_def) = 0 THEN
    IF position(v_loop_old IN v_def) = 0 OR position(v_called_old IN v_def) = 0
       OR position(v_conn_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.validate_extension_runner_points';
    END IF;
    EXECUTE replace(replace(replace(v_def, v_loop_old, v_loop_new), v_called_old, v_called_new), v_conn_old, v_conn_new);
  END IF;
END $$;
--> statement-breakpoint

-- What an administrator set for a plugin's connection ------------------------------
-- One row per setting a connector, publisher or notification channel declared.
-- `scope` names the declaration (`publishers:send-to-lims`). A secret is kept
-- sealed (AES-256-GCM, written by the app) and is never read back to a person.
CREATE TABLE internal.extension_settings (
    extension_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    scope text NOT NULL,
    name text NOT NULL,
    value text NOT NULL,
    secret boolean NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    CONSTRAINT extension_settings_pkey PRIMARY KEY (extension_id, scope, name),
    CONSTRAINT extension_settings_extension_fk FOREIGN KEY (workspace_id, extension_id)
        REFERENCES api.extensions (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_extension_settings_scope CHECK (scope ~ '^(connectors|publishers|notification-channels):[a-z][a-z0-9-]{0,48}$'),
    CONSTRAINT chk_extension_settings_name CHECK (name ~ '^[a-z][a-z0-9_]{0,47}$'),
    CONSTRAINT chk_extension_settings_size CHECK (length(value) <= 6000)
);
--> statement-breakpoint
ALTER TABLE internal.extension_settings OWNER TO migrator;
--> statement-breakpoint

-- Who turned a channel on ---------------------------------------------------------
-- `scope` is `phone` (the notifications that would alert their phone) or `all`
-- (every notification they get).
CREATE TABLE internal.plugin_channel_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    extension_id uuid NOT NULL,
    channel_id text NOT NULL,
    destination text NOT NULL,
    scope text DEFAULT 'phone' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    last_error text,
    last_error_at timestamp with time zone,
    CONSTRAINT plugin_channel_subscriptions_pkey PRIMARY KEY (id),
    CONSTRAINT uq_plugin_channel_subscriptions UNIQUE (user_id, extension_id, channel_id),
    CONSTRAINT plugin_channel_subscriptions_user_fk FOREIGN KEY (user_id)
        REFERENCES internal."user" (id) ON DELETE CASCADE,
    CONSTRAINT plugin_channel_subscriptions_extension_fk FOREIGN KEY (workspace_id, extension_id)
        REFERENCES api.extensions (workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT chk_plugin_channel_subscriptions_channel CHECK (channel_id ~ '^[a-z][a-z0-9-]{0,48}$'),
    CONSTRAINT chk_plugin_channel_subscriptions_scope CHECK (scope IN ('phone', 'all')),
    CONSTRAINT chk_plugin_channel_subscriptions_destination CHECK (length(btrim(destination)) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE internal.plugin_channel_subscriptions OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plugin_channel_subscriptions_user ON internal.plugin_channel_subscriptions (user_id, workspace_id);
--> statement-breakpoint

CREATE TABLE internal.plugin_channel_deliveries (
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
    CONSTRAINT plugin_channel_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_channel_deliveries_subscription_fk FOREIGN KEY (subscription_id)
        REFERENCES internal.plugin_channel_subscriptions (id) ON DELETE CASCADE,
    CONSTRAINT chk_plugin_channel_deliveries_status CHECK (status IN ('pending', 'sending', 'sent', 'dead'))
);
--> statement-breakpoint
ALTER TABLE internal.plugin_channel_deliveries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plugin_channel_deliveries_due ON internal.plugin_channel_deliveries (next_attempt_at)
    WHERE status IN ('pending', 'sending');
--> statement-breakpoint

-- Queue a message on every channel the person turned on for this notification.
-- Same rule as phone alerts: a notification is written when the person wants it
-- in the app, by email, in the digest or on their phone, and a channel follows
-- the row. `phone` follows the event's phone setting; `all` follows every row.
CREATE FUNCTION internal.queue_notification_channels() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_phone boolean;
  v_body text;
  v_link text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM internal.plugin_channel_subscriptions s
     WHERE s.user_id = NEW.user_id AND s.workspace_id = NEW.workspace_id
  ) THEN
    RETURN NULL;
  END IF;
  SELECT coalesce(
           (SELECT p.push FROM api.notification_preferences p
             WHERE p.user_id = NEW.user_id AND p.event_type = NEW.event_type),
           (SELECT e.default_push FROM api.notification_events e
             WHERE e.event_type = NEW.event_type),
           false)
    INTO v_phone;
  v_body := coalesce(
    NEW.body,
    (SELECT r.title FROM api.records r WHERE r.id = NEW.record_id),
    '');
  v_link := coalesce(
    NEW.link,
    CASE WHEN NEW.record_id IS NOT NULL THEN '/records/' || NEW.record_id::text ELSE '/' END);
  INSERT INTO internal.plugin_channel_deliveries (subscription_id, user_id, event_type, payload)
  SELECT s.id, NEW.user_id, NEW.event_type,
         jsonb_build_object(
           'event', NEW.event_type,
           'title', NEW.title,
           'body', left(v_body, 600),
           'link', v_link,
           'at', NEW.created_at)
    FROM internal.plugin_channel_subscriptions s
   WHERE s.user_id = NEW.user_id
     AND s.workspace_id = NEW.workspace_id
     AND (s.scope = 'all' OR v_phone);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A channel message is derived; it must never block the write it follows.
  RAISE WARNING 'notification channels failed for %: %', NEW.event_type, SQLERRM;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.queue_notification_channels() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER queue_notification_channels AFTER INSERT ON internal.notifications
    FOR EACH ROW EXECUTE FUNCTION internal.queue_notification_channels();
--> statement-breakpoint

-- Claim due messages for the channel worker. Quiet hours hold a message until
-- they end, as for phone alerts.
CREATE FUNCTION internal.claim_due_plugin_channel_deliveries(p_limit integer DEFAULT 50) RETURNS TABLE (
    id uuid, subscription_id uuid, workspace_id uuid, user_id text, extension_id uuid,
    channel_id text, destination text, event_type text, payload jsonb, attempt integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM internal.plugin_channel_deliveries d
     WHERE d.status IN ('pending', 'sending')
       AND d.next_attempt_at <= now()
       AND NOT internal.email_held_for_quiet_hours(d.user_id, d.event_type)
     ORDER BY d.next_attempt_at ASC
     LIMIT greatest(1, least(p_limit, 200))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE internal.plugin_channel_deliveries d
       SET status = 'sending', attempt = d.attempt + 1, next_attempt_at = now() + interval '2 minutes'
      FROM due WHERE d.id = due.id
    RETURNING d.id, d.subscription_id, d.user_id, d.event_type, d.payload, d.attempt
  )
  SELECT c.id, c.subscription_id, s.workspace_id, c.user_id, s.extension_id,
         s.channel_id, s.destination, c.event_type, c.payload, c.attempt
    FROM claimed c
    JOIN internal.plugin_channel_subscriptions s ON s.id = c.subscription_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.claim_due_plugin_channel_deliveries(p_limit integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_due_plugin_channel_deliveries(p_limit integer) FROM PUBLIC;
--> statement-breakpoint

-- Record the outcome. A failure tries again up to three times, then gives up;
-- either way the person's channel row shows what happened last.
CREATE FUNCTION internal.finish_plugin_channel_delivery(p_id uuid, p_ok boolean, p_error text DEFAULT NULL) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v internal.plugin_channel_deliveries;
BEGIN
  SELECT * INTO v FROM internal.plugin_channel_deliveries WHERE id = p_id FOR UPDATE;
  IF v.id IS NULL THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE internal.plugin_channel_deliveries SET status = 'sent', sent_at = now(), last_error = NULL WHERE id = p_id;
    UPDATE internal.plugin_channel_subscriptions
       SET last_sent_at = now(), last_error = NULL, last_error_at = NULL
     WHERE id = v.subscription_id;
  ELSIF v.attempt >= 3 THEN
    UPDATE internal.plugin_channel_deliveries SET status = 'dead', last_error = left(p_error, 500) WHERE id = p_id;
    UPDATE internal.plugin_channel_subscriptions
       SET last_error = left(p_error, 500), last_error_at = now()
     WHERE id = v.subscription_id;
  ELSE
    UPDATE internal.plugin_channel_deliveries
       SET status = 'pending', last_error = left(p_error, 500),
           next_attempt_at = now() + (v.attempt * interval '1 minute')
     WHERE id = p_id;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.finish_plugin_channel_delivery(p_id uuid, p_ok boolean, p_error text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.finish_plugin_channel_delivery(p_id uuid, p_ok boolean, p_error text) FROM PUBLIC;
--> statement-breakpoint

-- Old outcomes are not kept: sent and dead rows go after a week.
CREATE FUNCTION internal.prune_plugin_channel_deliveries() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM internal.plugin_channel_deliveries
   WHERE status IN ('sent', 'dead') AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.prune_plugin_channel_deliveries() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.prune_plugin_channel_deliveries() FROM PUBLIC;
