-- Calendar feeds. A person can subscribe to the lab's bookings from the calendar
-- they already use (Outlook, Google, Apple): the Schedule gives them a private
-- link, and the booking times, instruments and titles follow what the Schedule
-- shows, as an ICS feed.
--
-- A feed covers one of three things: the person's own bookings, one instrument's
-- bookings, or every booking in the workspace. The link carries a secret that is
-- shown once and stored only as a hash; it stops working when the person revokes
-- it or leaves the workspace. A feed shows a booking only when the person could
-- see its project in the app.

CREATE TABLE api.calendar_feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    scope text NOT NULL,
    resource_id uuid,
    label text,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT calendar_feeds_pkey PRIMARY KEY (id),
    CONSTRAINT uq_calendar_feeds_token UNIQUE (token_hash),
    CONSTRAINT calendar_feeds_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT calendar_feeds_resource_fk FOREIGN KEY (resource_id) REFERENCES api.calendar_resources(id) ON DELETE CASCADE,
    CONSTRAINT chk_calendar_feeds_scope CHECK (scope IN ('mine', 'instrument', 'all')),
    CONSTRAINT chk_calendar_feeds_resource CHECK ((scope = 'instrument') = (resource_id IS NOT NULL)),
    CONSTRAINT chk_calendar_feeds_label CHECK (label IS NULL OR length(label) <= 120)
);
--> statement-breakpoint
ALTER TABLE api.calendar_feeds OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_calendar_feeds_user ON api.calendar_feeds (workspace_id, user_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
ALTER TABLE api.calendar_feeds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A person sees their own feeds, never the hash.
CREATE POLICY calendar_feeds_select ON api.calendar_feeds FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND user_id = api.current_user_id());
--> statement-breakpoint
GRANT SELECT (id, workspace_id, user_id, scope, resource_id, label, created_at, last_used_at, revoked_at)
    ON TABLE api.calendar_feeds TO authenticated;
--> statement-breakpoint

-- Make a feed. The secret comes back once and is not kept.
CREATE FUNCTION api.create_calendar_feed(p_scope text, p_resource_id uuid DEFAULT NULL, p_label text DEFAULT NULL)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('mine', 'instrument', 'all') THEN
    RAISE EXCEPTION 'a feed covers your bookings, one instrument or everything' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'instrument' AND NOT EXISTS (
       SELECT 1 FROM api.calendar_resources r WHERE r.id = p_resource_id AND r.workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB021';
  END IF;
  IF (SELECT count(*) FROM api.calendar_feeds
       WHERE workspace_id = v_workspace_id AND user_id = v_user AND revoked_at IS NULL) >= 20 THEN
    RAISE EXCEPTION 'revoke a feed you no longer use before making another' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.calendar_feeds (workspace_id, user_id, scope, resource_id, label, token_hash)
  VALUES (v_workspace_id, v_user, p_scope, CASE WHEN p_scope = 'instrument' THEN p_resource_id END,
          nullif(btrim(p_label), ''), encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'token', v_token);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_calendar_feed(p_scope text, p_resource_id uuid, p_label text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_calendar_feed(p_scope text, p_resource_id uuid, p_label text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_calendar_feed(p_scope text, p_resource_id uuid, p_label text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.revoke_calendar_feed(p_feed_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  UPDATE api.calendar_feeds
     SET revoked_at = now()
   WHERE id = p_feed_id AND workspace_id = v_workspace_id
     AND user_id = api.current_user_id() AND revoked_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'feed not found' USING ERRCODE = 'SB036';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.revoke_calendar_feed(p_feed_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.revoke_calendar_feed(p_feed_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.revoke_calendar_feed(p_feed_id uuid) TO authenticated;
--> statement-breakpoint

-- The feed behind a secret: its name and the bookings it shows, from a month
-- back to a year ahead. Called by the app's feed endpoint, never by a browser.
-- Null when the secret is unknown, revoked, or its owner has left.
CREATE FUNCTION internal.calendar_feed_by_token(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_feed api.calendar_feeds;
  v_name text;
  v_events jsonb;
BEGIN
  SELECT f.* INTO v_feed FROM api.calendar_feeds f
   WHERE f.token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
     AND f.revoked_at IS NULL
     AND EXISTS (SELECT 1 FROM api.workspace_memberships m
                  WHERE m.workspace_id = f.workspace_id AND m.user_id = f.user_id AND m.suspended_at IS NULL);
  IF v_feed.id IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE api.calendar_feeds SET last_used_at = now() WHERE id = v_feed.id;

  v_name := coalesce(nullif(v_feed.label, ''),
    CASE v_feed.scope
      WHEN 'mine' THEN 'My bookings'
      WHEN 'all' THEN 'All bookings'
      ELSE (SELECT r.name FROM api.calendar_resources r WHERE r.id = v_feed.resource_id)
    END);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'title', b.title,
           'resource', r.name,
           'starts_at', b.starts_at,
           'ends_at', b.ends_at,
           'all_day', b.all_day,
           'status', b.status,
           'location', coalesce(b.location, r.location),
           'notes', b.notes,
           'updated_at', b.updated_at) ORDER BY b.starts_at), '[]'::jsonb)
    INTO v_events
    FROM api.calendar_bookings b
    JOIN api.calendar_resources r ON r.id = b.resource_id
   WHERE b.workspace_id = v_feed.workspace_id
     AND b.ends_at > now() - interval '30 days'
     AND b.starts_at < now() + interval '365 days'
     AND (v_feed.scope = 'all'
          OR (v_feed.scope = 'instrument' AND b.resource_id = v_feed.resource_id)
          OR (v_feed.scope = 'mine' AND (b.created_by_user_id = v_feed.user_id
               OR EXISTS (SELECT 1 FROM api.calendar_booking_participants p
                           WHERE p.booking_id = b.id AND p.user_id = v_feed.user_id))))
     AND (b.project_id IS NULL
          OR coalesce((SELECT pp.can_view FROM internal.project_permissions_for(b.project_id, v_feed.user_id) pp), false));

  RETURN jsonb_build_object('name', v_name, 'events', v_events);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.calendar_feed_by_token(p_token text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.calendar_feed_by_token(p_token text) FROM PUBLIC;
