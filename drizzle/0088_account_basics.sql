-- Account and browser basics.
--
-- 1. Following. Records could already be followed (api.follow_record); this
--    adds projects, adds Inbox rows for followed projects, follows you onto a
--    record when you comment on it or are mentioned in it, and tells followers
--    about new comments.
-- 2. A lab logo, kept in object storage under a key that names the workspace,
--    set and cleared by workspace admins.
-- 3. Leaving a workspace yourself.
--
-- Changing an email address needs no schema: the confirmation link lives in
-- Better Auth's verification table.

-- ---------------------------------------------------------------------------
-- 1. Following
-- ---------------------------------------------------------------------------

CREATE TABLE api.project_follows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    project_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_follows_pkey PRIMARY KEY (id),
    CONSTRAINT uq_project_follows_user_project UNIQUE (user_id, project_id),
    CONSTRAINT project_follows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT project_follows_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT project_follows_project_id_fkey FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.project_follows OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_project_follows_user_created ON api.project_follows (user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.project_follows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_follows_select ON api.project_follows FOR SELECT TO authenticated
    USING (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.project_follows TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.follow_project(p_project_id uuid) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v_workspace_id uuid;
  v_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'follow_project requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('project', p_project_id, 'view');
  SELECT p.workspace_id INTO v_workspace_id FROM api.projects p WHERE p.id = p_project_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.project_follows (workspace_id, user_id, project_id)
  VALUES (v_workspace_id, v_user_id, p_project_id)
  ON CONFLICT (user_id, project_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id
  RETURNING created_at INTO v_created_at;
  RETURN v_created_at;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.unfollow_project(p_project_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'unfollow_project requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.project_follows
   WHERE user_id = api.current_user_id() AND project_id = p_project_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.follow_project(uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.unfollow_project(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.follow_project(uuid), api.unfollow_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.follow_project(uuid), api.unfollow_project(uuid) TO authenticated;
--> statement-breakpoint

-- Followed projects appear in the Inbox's Following tab, like followed records.
ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_pre_follows;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_pre_follows
UNION ALL
 SELECT 'project_following'::text AS kind,
        NULL::uuid AS record_id,
        coalesce(p.display_id, p.key) AS identifier,
        p.title,
        p.id AS project_id,
        'Following'::text AS reason,
        NULL::timestamp with time zone AS due_at,
        'following'::text AS state,
        pf.created_at,
        'project'::text AS source_type,
        p.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.project_follows pf
   JOIN api.projects p ON p.id = pf.project_id
  WHERE pf.user_id = api.current_user_id()
    AND pf.workspace_id = api.current_workspace_id()
    AND p.archived_at IS NULL;
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_pre_follows TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker='true') AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_all
  WHERE NOT internal.inbox_kind_muted(kind);
--> statement-breakpoint

-- Commenting on a record, or being mentioned in a comment, follows it.
CREATE FUNCTION internal.follow_record_on_comment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO api.work_item_follows (workspace_id, user_id, record_id)
  SELECT NEW.workspace_id, m.user_id, NEW.record_id
    FROM api.workspace_memberships m
   WHERE m.workspace_id = NEW.workspace_id
     AND m.suspended_at IS NULL
     AND m.user_id = ANY (coalesce(NEW.mentions, '{}'::text[]) || ARRAY[coalesce(NEW.author_user_id, '')])
  ON CONFLICT (user_id, record_id) DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.follow_record_on_comment() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER follow_record_on_comment AFTER INSERT ON api.comments
    FOR EACH ROW EXECUTE FUNCTION internal.follow_record_on_comment();
--> statement-breakpoint

-- Followers hear about new comments. The record's author and anyone named in
-- the comment are already told by the existing comment notifications.
CREATE FUNCTION internal.notify_followers_of_comment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_creator text;
  v_project uuid;
  recipient text;
BEGIN
  IF NEW.record_id IS NULL THEN RETURN NEW; END IF;
  SELECT r.created_by_user_id, r.project_id INTO v_creator, v_project
    FROM api.records r WHERE r.id = NEW.record_id;
  FOR recipient IN
    SELECT f.user_id FROM api.work_item_follows f
     WHERE f.record_id = NEW.record_id
       AND f.user_id IS DISTINCT FROM NEW.author_user_id
       AND f.user_id IS DISTINCT FROM v_creator
       AND NOT (f.user_id = ANY (coalesce(NEW.mentions, '{}'::text[])))
       AND EXISTS (SELECT 1 FROM api.workspace_memberships m
                    WHERE m.workspace_id = f.workspace_id AND m.user_id = f.user_id
                      AND m.suspended_at IS NULL)
  LOOP
    IF internal.notification_recipient_enabled(recipient, 'comment_or_mention') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, project_id)
      VALUES (NEW.workspace_id, recipient, 'comment_or_mention',
              'New comment on a record you follow', NULL, NEW.record_id, v_project);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_followers_of_comment() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER notify_followers_of_comment AFTER INSERT ON api.comments
    FOR EACH ROW EXECUTE FUNCTION internal.notify_followers_of_comment();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Lab logo
-- ---------------------------------------------------------------------------

ALTER TABLE api.workspaces
    ADD COLUMN logo_storage_key text,
    ADD COLUMN logo_media_type text,
    ADD COLUMN logo_updated_at timestamp with time zone,
    ADD CONSTRAINT chk_workspaces_logo_key CHECK (
        logo_storage_key IS NULL
        OR logo_storage_key = 'logos/' || id::text || '/' || substring(logo_storage_key from '/([0-9a-f]{32})$')
    ),
    ADD CONSTRAINT chk_workspaces_logo_type CHECK (
        logo_media_type IS NULL OR logo_media_type = ANY (ARRAY['image/png'::text, 'image/jpeg'::text])
    ),
    ADD CONSTRAINT chk_workspaces_logo_complete CHECK (
        (logo_storage_key IS NULL) = (logo_media_type IS NULL)
        AND (logo_storage_key IS NULL) = (logo_updated_at IS NULL)
    );
--> statement-breakpoint

-- Sets the logo and returns the key it replaced, so the server can remove the
-- old bytes. Only owners and admins may.
CREATE FUNCTION api.set_workspace_logo(p_workspace_id uuid, p_storage_key text, p_media_type text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_previous text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = api.current_user_id()
       AND m.suspended_at IS NULL AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  SELECT w.logo_storage_key INTO v_previous FROM api.workspaces w WHERE w.id = p_workspace_id FOR UPDATE;
  UPDATE api.workspaces
     SET logo_storage_key = p_storage_key, logo_media_type = p_media_type,
         logo_updated_at = now(), updated_at = now()
   WHERE id = p_workspace_id;
  RETURN v_previous;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.clear_workspace_logo(p_workspace_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_previous text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = api.current_user_id()
       AND m.suspended_at IS NULL AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  SELECT w.logo_storage_key INTO v_previous FROM api.workspaces w WHERE w.id = p_workspace_id FOR UPDATE;
  UPDATE api.workspaces
     SET logo_storage_key = NULL, logo_media_type = NULL, logo_updated_at = NULL, updated_at = now()
   WHERE id = p_workspace_id;
  RETURN v_previous;
END $$;
--> statement-breakpoint
-- The active workspace's logo for any of its members, with a version that
-- changes each time the logo does.
CREATE FUNCTION api.workspace_logo() RETURNS TABLE(storage_key text, media_type text, version text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT w.logo_storage_key, w.logo_media_type,
         (extract(epoch FROM w.logo_updated_at) * 1000)::bigint::text
    FROM api.workspaces w
   WHERE w.id = api.current_workspace_id()
     AND w.logo_storage_key IS NOT NULL
     AND api.is_workspace_member(w.id)
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_workspace_logo(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.clear_workspace_logo(uuid) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.workspace_logo() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_workspace_logo(uuid, text, text), api.clear_workspace_logo(uuid), api.workspace_logo() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_workspace_logo(uuid, text, text), api.clear_workspace_logo(uuid), api.workspace_logo() TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Leave a workspace
-- ---------------------------------------------------------------------------

-- You can leave a workspace you belong to, as long as you are not its last
-- owner and it is not your only workspace (you would have nowhere to land).
CREATE FUNCTION api.leave_workspace(p_workspace_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user text := api.current_user_id();
  v api.workspace_memberships;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'leaving a workspace requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.workspace_memberships
   WHERE workspace_id = p_workspace_id AND user_id = v_user FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'SB052';
  END IF;
  IF v.role = 'owner' AND v.suspended_at IS NULL
     AND (SELECT count(*) FROM api.workspace_memberships
           WHERE workspace_id = p_workspace_id AND role = 'owner' AND suspended_at IS NULL) = 1 THEN
    RAISE EXCEPTION 'cannot remove last owner' USING ERRCODE = 'SB051';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships
                  WHERE user_id = v_user AND workspace_id <> p_workspace_id AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'cannot leave your only workspace' USING ERRCODE = 'SB400';
  END IF;
  DELETE FROM api.project_follows WHERE user_id = v_user AND workspace_id = p_workspace_id;
  DELETE FROM api.work_item_follows WHERE user_id = v_user AND workspace_id = p_workspace_id;
  DELETE FROM api.workspace_memberships WHERE id = v.id;
  -- Land in another workspace next time.
  UPDATE api.user_preferences SET active_workspace_id = NULL, updated_at = now()
   WHERE user_id = v_user AND active_workspace_id = p_workspace_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.leave_workspace(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.leave_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.leave_workspace(uuid) TO authenticated;
