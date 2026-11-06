-- Directory sync (SCIM 2.0).
--
-- A lab that keeps its people in an identity provider (Okta, Entra ID, Google
-- Workspace, JumpCloud ...) can have that provider create, update and switch
-- off people here, and keep their groups, without anyone opening the members
-- page. The provider calls the SCIM endpoint with a per-workspace token:
--
--   api.scim_tokens             the tokens (metadata only; the secret is shown
--                               once and kept as a hash in
--                               internal.scim_token_secrets);
--   internal.scim_users         which members the provider manages (its own
--                               userName and externalId, and whether it has
--                               deleted them);
--   internal.scim_groups        the provider's groups, and their members;
--   internal.scim_*             the functions the endpoint calls.
--
-- It maps onto what already exists, and adds no second set of rules:
--   * groups -> roles uses the same "sign-in groups" mappings
--     (api.idp_group_mappings) and the same rule: the highest role among a
--     person's groups wins, and anyone in none becomes a viewer. Only
--     memberships whose role_source is 'idp' follow groups;
--   * switching a person off suspends their membership (the same state as
--     api.suspend_member). Their open work is counted into the change event so
--     a lead can hand it over (api.hand_over_member_work); nothing is deleted;
--   * owners and client accounts are never changed by the provider.

-- New kinds of change on the feed. Added to the constraint as it stands, so
-- this keeps working whatever other migrations have added to it.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conname = 'chk_change_events_entity_type'
     AND conrelid = 'api.change_events'::regclass;
  v_def := regexp_replace(
    v_def, '\]\)\)\)$',
    ', ''scim_token''::text, ''scim_user''::text, ''scim_group''::text])))');
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

-- The sign-in library's single sign-on plugin expects a table of identity
-- providers. Ours are set in configuration and the routes that would add rows
-- are closed, so it stays empty; it exists so the plugin starts.
CREATE TABLE internal."ssoProvider" (
    id text NOT NULL,
    issuer text NOT NULL,
    "oidcConfig" text,
    "samlConfig" text,
    "userId" text,
    "providerId" text NOT NULL,
    "organizationId" text,
    domain text NOT NULL,
    "domainVerified" boolean,
    CONSTRAINT "ssoProvider_pkey" PRIMARY KEY (id),
    CONSTRAINT "ssoProvider_providerId_key" UNIQUE ("providerId"),
    CONSTRAINT "ssoProvider_userId_fkey" FOREIGN KEY ("userId") REFERENCES internal."user"(id) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE internal."ssoProvider" OWNER TO migrator;
--> statement-breakpoint

CREATE TABLE api.scim_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    label text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT scim_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT chk_scim_tokens_label CHECK (length(btrim(label)) BETWEEN 1 AND 100),
    CONSTRAINT scim_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT scim_tokens_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE api.scim_tokens OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_scim_tokens_workspace ON api.scim_tokens (workspace_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.scim_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scim_tokens_select ON api.scim_tokens FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'members', 'manage'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.scim_tokens TO authenticated;
--> statement-breakpoint

CREATE TABLE internal.scim_token_secrets (
    token_id uuid NOT NULL,
    secret_hash text NOT NULL,
    CONSTRAINT scim_token_secrets_pkey PRIMARY KEY (token_id),
    CONSTRAINT scim_token_secrets_hash_key UNIQUE (secret_hash),
    CONSTRAINT chk_scim_token_secrets_hash CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scim_token_secrets_token_id_fkey FOREIGN KEY (token_id) REFERENCES api.scim_tokens(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.scim_token_secrets OWNER TO migrator;
--> statement-breakpoint

-- Members the provider manages. id is the SCIM id the provider sees.
CREATE TABLE internal.scim_users (
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    user_name text NOT NULL,
    external_id text,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scim_users_pkey PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT scim_users_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT scim_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.scim_users OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_scim_users_external ON internal.scim_users (workspace_id, external_id) WHERE external_id IS NOT NULL;
--> statement-breakpoint

CREATE TABLE api.scim_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    display_name text NOT NULL,
    external_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scim_groups_pkey PRIMARY KEY (id),
    CONSTRAINT chk_scim_groups_name CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
    CONSTRAINT scim_groups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.scim_groups OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_scim_groups_name ON api.scim_groups (workspace_id, lower(btrim(display_name)));
--> statement-breakpoint
ALTER TABLE api.scim_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scim_groups_select ON api.scim_groups FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'members', 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.scim_groups TO authenticated;
--> statement-breakpoint

CREATE TABLE api.scim_group_members (
    group_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT scim_group_members_pkey PRIMARY KEY (group_id, user_id),
    CONSTRAINT scim_group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES api.scim_groups(id) ON DELETE CASCADE,
    CONSTRAINT scim_group_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT scim_group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.scim_group_members OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_scim_group_members_user ON api.scim_group_members (workspace_id, user_id);
--> statement-breakpoint
ALTER TABLE api.scim_group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scim_group_members_select ON api.scim_group_members FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'members', 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.scim_group_members TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Tokens (managed by people with members access)
-- ---------------------------------------------------------------------------

-- Makes a token and returns the secret once. Only a hash is kept.
CREATE FUNCTION api.create_scim_token(p_workspace_id uuid, p_label text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_label text := btrim(coalesce(p_label, ''));
  v_secret text;
  v_row api.scim_tokens;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF v_label = '' OR length(v_label) > 100 THEN
    RAISE EXCEPTION 'name the token after the identity provider that will use it' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM api.scim_tokens WHERE workspace_id = p_workspace_id AND revoked_at IS NULL) >= 5 THEN
    RAISE EXCEPTION 'revoke a token you no longer use before making another' USING ERRCODE = '22023';
  END IF;
  v_secret := 'sbscim_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO api.scim_tokens (workspace_id, label, created_by_user_id)
  VALUES (p_workspace_id, v_label, api.current_user_id())
  RETURNING * INTO v_row;
  INSERT INTO internal.scim_token_secrets (token_id, secret_hash)
  VALUES (v_row.id, encode(sha256(convert_to(v_secret, 'UTF8')), 'hex'));
  PERFORM internal.emit_change_event(
    p_workspace_id, 'scim_token', v_row.id, 'create', NULL, NULL,
    jsonb_build_object('action', 'scim-token-created', 'label', v_row.label));
  RETURN jsonb_build_object('token', to_jsonb(v_row), 'secret', v_secret);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_scim_token(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_scim_token(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_scim_token(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.revoke_scim_token(p_id uuid) RETURNS api.scim_tokens
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.scim_tokens;
BEGIN
  SELECT * INTO v_row FROM api.scim_tokens WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF v_row.revoked_at IS NULL THEN
    UPDATE api.scim_tokens SET revoked_at = now() WHERE id = p_id RETURNING * INTO v_row;
    PERFORM internal.emit_change_event(
      v_row.workspace_id, 'scim_token', v_row.id, 'revoke', NULL, NULL,
      jsonb_build_object('action', 'scim-token-revoked', 'label', v_row.label));
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.revoke_scim_token(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.revoke_scim_token(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.revoke_scim_token(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- What the endpoint calls (internal; the app connects with its own role)
-- ---------------------------------------------------------------------------

-- Finds the workspace a presented token belongs to.
CREATE FUNCTION internal.scim_authenticate(p_secret_hash text)
    RETURNS TABLE(token_id uuid, workspace_id uuid, actor_user_id text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_token api.scim_tokens;
BEGIN
  SELECT t.* INTO v_token
    FROM internal.scim_token_secrets s
    JOIN api.scim_tokens t ON t.id = s.token_id
    JOIN api.workspaces w ON w.id = t.workspace_id
   WHERE s.secret_hash = p_secret_hash
     AND t.revoked_at IS NULL
     AND w.status = 'active';
  IF v_token.id IS NULL THEN RETURN; END IF;
  IF v_token.last_used_at IS NULL OR v_token.last_used_at < now() - interval '1 minute' THEN
    UPDATE api.scim_tokens SET last_used_at = now() WHERE id = v_token.id;
  END IF;
  RETURN QUERY SELECT v_token.id, v_token.workspace_id, v_token.created_by_user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_authenticate(text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_authenticate(text) FROM PUBLIC;
--> statement-breakpoint

-- Puts a change on the feed as the person who made the token.
CREATE FUNCTION internal.scim_emit(p_actor text, p_workspace_id uuid, p_entity_type text, p_entity_uuid uuid, p_operation text, p_payload jsonb)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_actor IS NULL THEN RETURN; END IF;
  PERFORM internal.emit_change_event_as_actor(
    p_actor, p_workspace_id, p_entity_type, p_entity_uuid, p_operation, NULL, NULL,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('via', 'scim'));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_emit(text, uuid, text, uuid, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_emit(text, uuid, text, uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- One member as the endpoint shapes it.
CREATE FUNCTION internal.scim_user_doc(p_workspace_id uuid, p_membership_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'id', m.id,
    'user_name', coalesce(s.user_name, u.email),
    'external_id', s.external_id,
    'email', u.email,
    'display_name', u.name,
    'active', m.suspended_at IS NULL,
    'role', m.role,
    'created', m.created_at,
    'updated', greatest(m.updated_at, coalesce(s.updated_at, m.updated_at)),
    'groups', coalesce((
      SELECT jsonb_agg(jsonb_build_object('value', g.id, 'display', g.display_name) ORDER BY g.display_name)
        FROM api.scim_group_members gm
        JOIN api.scim_groups g ON g.id = gm.group_id
       WHERE gm.workspace_id = m.workspace_id AND gm.user_id = m.user_id), '[]'::jsonb))
    FROM api.workspace_memberships m
    JOIN internal."user" u ON u.id = m.user_id
    LEFT JOIN internal.scim_users s ON s.workspace_id = m.workspace_id AND s.user_id = m.user_id
   WHERE m.workspace_id = p_workspace_id
     AND m.id = p_membership_id
     AND m.role <> 'client_viewer'
     AND s.deleted_at IS NULL
$$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_user_doc(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_user_doc(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.scim_list_users(p_workspace_id uuid, p_user_name text, p_external_id text, p_start integer, p_count integer)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_total integer;
  v_rows jsonb;
BEGIN
  SELECT count(*) INTO v_total
    FROM api.workspace_memberships m
    JOIN internal."user" u ON u.id = m.user_id
    LEFT JOIN internal.scim_users s ON s.workspace_id = m.workspace_id AND s.user_id = m.user_id
   WHERE m.workspace_id = p_workspace_id
     AND m.role <> 'client_viewer'
     AND s.deleted_at IS NULL
     AND (p_user_name IS NULL OR lower(coalesce(s.user_name, u.email)) = lower(p_user_name) OR lower(u.email) = lower(p_user_name))
     AND (p_external_id IS NULL OR s.external_id = p_external_id);
  SELECT coalesce(jsonb_agg(internal.scim_user_doc(p_workspace_id, page.id) ORDER BY page.ord), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT m.id, row_number() OVER (ORDER BY u.email, m.id) AS ord
        FROM api.workspace_memberships m
        JOIN internal."user" u ON u.id = m.user_id
        LEFT JOIN internal.scim_users s ON s.workspace_id = m.workspace_id AND s.user_id = m.user_id
       WHERE m.workspace_id = p_workspace_id
         AND m.role <> 'client_viewer'
         AND s.deleted_at IS NULL
         AND (p_user_name IS NULL OR lower(coalesce(s.user_name, u.email)) = lower(p_user_name) OR lower(u.email) = lower(p_user_name))
         AND (p_external_id IS NULL OR s.external_id = p_external_id)
    ) page
   WHERE page.ord >= greatest(p_start, 1) AND page.ord < greatest(p_start, 1) + greatest(p_count, 0);
  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_list_users(uuid, text, text, integer, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_list_users(uuid, text, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint

-- Recomputes roles from the provider's groups for some people. Same rule as
-- sign-in groups: highest mapped role wins; none mapped means viewer. A
-- workspace with no mappings leaves roles alone.
CREATE FUNCTION internal.scim_apply_roles(p_workspace_id uuid, p_actor text, p_user_ids text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_changed integer := 0;
  v_want text;
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.idp_group_mappings WHERE workspace_id = p_workspace_id) THEN
    RETURN 0;
  END IF;
  PERFORM set_config('sheetbase.idp_sync', 'on', true);
  FOR r IN
    SELECT m.id, m.user_id, m.role
      FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.user_id = ANY (p_user_ids)
       AND m.role_source = 'idp'
       AND m.suspended_at IS NULL
       AND m.role NOT IN ('owner', 'client_viewer')
  LOOP
    SELECT g.role INTO v_want
      FROM api.idp_group_mappings g
     WHERE g.workspace_id = p_workspace_id
       AND lower(btrim(g.group_name)) IN (
         SELECT lower(btrim(sg.display_name))
           FROM api.scim_group_members gm
           JOIN api.scim_groups sg ON sg.id = gm.group_id
          WHERE gm.workspace_id = p_workspace_id AND gm.user_id = r.user_id)
     ORDER BY CASE g.role WHEN 'admin' THEN 1 WHEN 'steward' THEN 2 WHEN 'scientist' THEN 3
                          WHEN 'analyst' THEN 4 WHEN 'reviewer' THEN 5 ELSE 6 END
     LIMIT 1;
    v_want := coalesce(v_want, 'viewer');
    IF v_want <> r.role THEN
      UPDATE api.workspace_memberships SET role = v_want, updated_at = now() WHERE id = r.id;
      PERFORM internal.scim_emit(p_actor, p_workspace_id, 'idp_group_mapping', r.id, 'update',
        jsonb_build_object('action', 'role-from-groups', 'userId', r.user_id, 'from', r.role, 'to', v_want));
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RETURN v_changed;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_apply_roles(uuid, text, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_apply_roles(uuid, text, text[]) FROM PUBLIC;
--> statement-breakpoint

-- Create (or take over) a member. A person already in the workspace is linked
-- to the provider without changing their role; a new person starts as a
-- viewer unless their groups say otherwise. The provider vouches for the
-- address, so a new account starts with it verified; that is what lets the
-- person's first single sign-on sign-in attach to the account rather than be
-- refused as a stranger.
CREATE FUNCTION internal.scim_provision_user(p_workspace_id uuid, p_actor text, p_changes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_name text := btrim(coalesce(p_changes->>'userName', ''));
  v_email text := lower(btrim(coalesce(nullif(p_changes->>'email', ''), p_changes->>'userName', '')));
  v_external text := nullif(btrim(coalesce(p_changes->>'externalId', '')), '');
  v_display text := nullif(btrim(coalesce(p_changes->>'displayName', '')), '');
  v_active boolean := coalesce((p_changes->>'active')::boolean, true);
  v_user_id text;
  v_member api.workspace_memberships;
  v_linked internal.scim_users;
  v_created boolean := false;
BEGIN
  IF v_user_name = '' THEN
    RAISE EXCEPTION 'userName is required' USING ERRCODE = '22023';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'userName or the primary email must be an email address' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO v_user_id FROM internal."user" WHERE lower(email) = v_email;
  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid()::text;
    INSERT INTO internal."user" (id, name, email, "emailVerified")
    VALUES (v_user_id, coalesce(v_display, split_part(v_email, '@', 1)), v_email, true);
  END IF;
  SELECT * INTO v_member FROM api.workspace_memberships
   WHERE workspace_id = p_workspace_id AND user_id = v_user_id FOR UPDATE;
  SELECT * INTO v_linked FROM internal.scim_users
   WHERE workspace_id = p_workspace_id AND user_id = v_user_id;
  IF v_member.id IS NOT NULL AND v_member.role = 'client_viewer' THEN
    RAISE EXCEPTION 'this address belongs to a client account' USING ERRCODE = 'SB052';
  END IF;
  IF v_member.id IS NOT NULL AND v_linked.user_id IS NOT NULL AND v_linked.deleted_at IS NULL THEN
    RAISE EXCEPTION 'a user with this userName already exists' USING ERRCODE = '23505';
  END IF;
  IF v_external IS NOT NULL AND EXISTS (
       SELECT 1 FROM internal.scim_users
        WHERE workspace_id = p_workspace_id AND external_id = v_external AND user_id <> v_user_id) THEN
    RAISE EXCEPTION 'a user with this externalId already exists' USING ERRCODE = '23505';
  END IF;
  IF v_member.id IS NULL THEN
    INSERT INTO api.workspace_memberships (workspace_id, user_id, role, role_source, suspended_at)
    VALUES (p_workspace_id, v_user_id, 'viewer', 'idp', CASE WHEN v_active THEN NULL ELSE now() END)
    RETURNING * INTO v_member;
    v_created := true;
  ELSIF v_member.role <> 'owner' THEN
    UPDATE api.workspace_memberships
       SET suspended_at = CASE WHEN v_active THEN NULL ELSE coalesce(suspended_at, now()) END,
           updated_at = now()
     WHERE id = v_member.id
    RETURNING * INTO v_member;
  END IF;
  INSERT INTO internal.scim_users (workspace_id, user_id, user_name, external_id)
  VALUES (p_workspace_id, v_user_id, v_user_name, v_external)
  ON CONFLICT (workspace_id, user_id)
  DO UPDATE SET user_name = EXCLUDED.user_name, external_id = EXCLUDED.external_id,
                deleted_at = NULL, updated_at = now();
  PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_user', v_member.id, 'create',
    jsonb_build_object('action', 'scim-user-provisioned', 'email', v_email,
                       'created', v_created, 'active', v_member.suspended_at IS NULL));
  PERFORM internal.scim_apply_roles(p_workspace_id, p_actor, ARRAY[v_user_id]);
  RETURN internal.scim_user_doc(p_workspace_id, v_member.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_provision_user(uuid, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_provision_user(uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Change a managed member. Keys present in p_changes are applied:
-- userName, externalId (null clears it), displayName, active.
CREATE FUNCTION internal.scim_update_user(p_workspace_id uuid, p_actor text, p_id uuid, p_changes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_member api.workspace_memberships;
  v_open integer;
  v_external text;
  v_active boolean;
BEGIN
  SELECT * INTO v_member FROM api.workspace_memberships
   WHERE id = p_id AND workspace_id = p_workspace_id AND role <> 'client_viewer' FOR UPDATE;
  IF v_member.id IS NULL OR internal.scim_user_doc(p_workspace_id, p_id) IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'workspace owners are managed in Sheetbase, not by the identity provider' USING ERRCODE = 'SB052';
  END IF;
  IF p_changes ? 'externalId' THEN
    v_external := nullif(btrim(coalesce(p_changes->>'externalId', '')), '');
    IF v_external IS NOT NULL AND EXISTS (
         SELECT 1 FROM internal.scim_users
          WHERE workspace_id = p_workspace_id AND external_id = v_external AND user_id <> v_member.user_id) THEN
      RAISE EXCEPTION 'a user with this externalId already exists' USING ERRCODE = '23505';
    END IF;
  END IF;
  INSERT INTO internal.scim_users (workspace_id, user_id, user_name)
  VALUES (p_workspace_id, v_member.user_id, (SELECT email FROM internal."user" WHERE id = v_member.user_id))
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  UPDATE internal.scim_users
     SET user_name = CASE WHEN nullif(btrim(coalesce(p_changes->>'userName', '')), '') IS NOT NULL
                          THEN btrim(p_changes->>'userName') ELSE user_name END,
         external_id = CASE WHEN p_changes ? 'externalId' THEN v_external ELSE external_id END,
         updated_at = now()
   WHERE workspace_id = p_workspace_id AND user_id = v_member.user_id;
  IF nullif(btrim(coalesce(p_changes->>'displayName', '')), '') IS NOT NULL THEN
    UPDATE internal."user" SET name = btrim(p_changes->>'displayName'), "updatedAt" = now()
     WHERE id = v_member.user_id;
  END IF;
  IF p_changes ? 'active' THEN
    v_active := (p_changes->>'active')::boolean;
    IF v_active AND v_member.suspended_at IS NOT NULL THEN
      UPDATE api.workspace_memberships SET suspended_at = NULL, updated_at = now() WHERE id = v_member.id;
      PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_user', v_member.id, 'update',
        jsonb_build_object('action', 'scim-user-reactivated', 'userId', v_member.user_id));
    ELSIF NOT v_active AND v_member.suspended_at IS NULL THEN
      UPDATE api.workspace_memberships SET suspended_at = now(), updated_at = now() WHERE id = v_member.id;
      SELECT coalesce(sum(n), 0)::integer INTO v_open
        FROM internal.member_handover_items(p_workspace_id, v_member.user_id);
      PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_user', v_member.id, 'suspend',
        jsonb_build_object('action', 'scim-user-deprovisioned', 'userId', v_member.user_id, 'openWork', v_open));
    END IF;
  END IF;
  IF p_changes ?| ARRAY['userName', 'externalId', 'displayName'] THEN
    PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_user', v_member.id, 'update',
      jsonb_build_object('action', 'scim-user-updated', 'userId', v_member.user_id));
  END IF;
  PERFORM internal.scim_apply_roles(p_workspace_id, p_actor, ARRAY[v_member.user_id]);
  RETURN internal.scim_user_doc(p_workspace_id, v_member.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_update_user(uuid, text, uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_update_user(uuid, text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- DELETE /Users: switch the person off and forget the link. Their account,
-- their work and their history stay.
CREATE FUNCTION internal.scim_delete_user(p_workspace_id uuid, p_actor text, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_member api.workspace_memberships;
  v_open integer;
BEGIN
  SELECT * INTO v_member FROM api.workspace_memberships
   WHERE id = p_id AND workspace_id = p_workspace_id AND role <> 'client_viewer' FOR UPDATE;
  IF v_member.id IS NULL OR internal.scim_user_doc(p_workspace_id, p_id) IS NULL THEN
    RAISE EXCEPTION 'user not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'workspace owners are managed in Sheetbase, not by the identity provider' USING ERRCODE = 'SB052';
  END IF;
  IF v_member.suspended_at IS NULL THEN
    UPDATE api.workspace_memberships SET suspended_at = now(), updated_at = now() WHERE id = v_member.id;
    SELECT coalesce(sum(n), 0)::integer INTO v_open
      FROM internal.member_handover_items(p_workspace_id, v_member.user_id);
    PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_user', v_member.id, 'suspend',
      jsonb_build_object('action', 'scim-user-deprovisioned', 'userId', v_member.user_id, 'openWork', v_open));
  END IF;
  INSERT INTO internal.scim_users (workspace_id, user_id, user_name, deleted_at)
  VALUES (p_workspace_id, v_member.user_id, (SELECT email FROM internal."user" WHERE id = v_member.user_id), now())
  ON CONFLICT (workspace_id, user_id) DO UPDATE SET deleted_at = now(), external_id = NULL, updated_at = now();
  DELETE FROM api.scim_group_members WHERE workspace_id = p_workspace_id AND user_id = v_member.user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_delete_user(uuid, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_delete_user(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

CREATE FUNCTION internal.scim_group_doc(p_workspace_id uuid, p_group_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT jsonb_build_object(
    'id', g.id,
    'display_name', g.display_name,
    'external_id', g.external_id,
    'created', g.created_at,
    'updated', g.updated_at,
    'members', coalesce((
      SELECT jsonb_agg(jsonb_build_object('value', m.id, 'display', u.email) ORDER BY u.email)
        FROM api.scim_group_members gm
        JOIN api.workspace_memberships m ON m.workspace_id = gm.workspace_id AND m.user_id = gm.user_id
        JOIN internal."user" u ON u.id = gm.user_id
       WHERE gm.group_id = g.id), '[]'::jsonb))
    FROM api.scim_groups g
   WHERE g.workspace_id = p_workspace_id AND g.id = p_group_id
$$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_group_doc(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_group_doc(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.scim_list_groups(p_workspace_id uuid, p_display_name text, p_start integer, p_count integer) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_total integer;
  v_rows jsonb;
BEGIN
  SELECT count(*) INTO v_total FROM api.scim_groups g
   WHERE g.workspace_id = p_workspace_id
     AND (p_display_name IS NULL OR lower(btrim(g.display_name)) = lower(btrim(p_display_name)));
  SELECT coalesce(jsonb_agg(internal.scim_group_doc(p_workspace_id, page.id) ORDER BY page.ord), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT g.id, row_number() OVER (ORDER BY lower(g.display_name), g.id) AS ord
        FROM api.scim_groups g
       WHERE g.workspace_id = p_workspace_id
         AND (p_display_name IS NULL OR lower(btrim(g.display_name)) = lower(btrim(p_display_name)))
    ) page
   WHERE page.ord >= greatest(p_start, 1) AND page.ord < greatest(p_start, 1) + greatest(p_count, 0);
  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_list_groups(uuid, text, integer, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_list_groups(uuid, text, integer, integer) FROM PUBLIC;
--> statement-breakpoint

-- Create (p_id null) or change a group. p_changes keys: displayName,
-- externalId, members (array of member ids; replaces the list when present).
CREATE FUNCTION internal.scim_set_group(p_workspace_id uuid, p_actor text, p_id uuid, p_changes jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_group api.scim_groups;
  v_name text := nullif(btrim(coalesce(p_changes->>'displayName', '')), '');
  v_wanted text[];
  v_before text[];
  v_touched text[];
  v_ids uuid[];
  v_creating boolean := p_id IS NULL;
BEGIN
  IF v_creating THEN
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'displayName is required' USING ERRCODE = '22023';
    END IF;
    IF length(v_name) > 200 THEN
      RAISE EXCEPTION 'displayName is too long' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM api.scim_groups WHERE workspace_id = p_workspace_id AND lower(btrim(display_name)) = lower(v_name)) THEN
      RAISE EXCEPTION 'a group with this displayName already exists' USING ERRCODE = '23505';
    END IF;
    INSERT INTO api.scim_groups (workspace_id, display_name, external_id)
    VALUES (p_workspace_id, v_name, nullif(btrim(coalesce(p_changes->>'externalId', '')), ''))
    RETURNING * INTO v_group;
  ELSE
    SELECT * INTO v_group FROM api.scim_groups WHERE id = p_id AND workspace_id = p_workspace_id FOR UPDATE;
    IF v_group.id IS NULL THEN
      RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_name IS NOT NULL AND lower(v_name) <> lower(btrim(v_group.display_name)) AND EXISTS (
         SELECT 1 FROM api.scim_groups
          WHERE workspace_id = p_workspace_id AND lower(btrim(display_name)) = lower(v_name) AND id <> v_group.id) THEN
      RAISE EXCEPTION 'a group with this displayName already exists' USING ERRCODE = '23505';
    END IF;
    UPDATE api.scim_groups
       SET display_name = coalesce(v_name, display_name),
           external_id = CASE WHEN p_changes ? 'externalId'
                              THEN nullif(btrim(coalesce(p_changes->>'externalId', '')), '') ELSE external_id END,
           updated_at = now()
     WHERE id = v_group.id RETURNING * INTO v_group;
  END IF;

  SELECT coalesce(array_agg(user_id), '{}') INTO v_before
    FROM api.scim_group_members WHERE group_id = v_group.id;
  v_touched := v_before;
  IF p_changes ? 'members' THEN
    SELECT coalesce(array_agg(DISTINCT m.id), '{}') INTO v_ids
      FROM jsonb_array_elements_text(coalesce(p_changes->'members', '[]'::jsonb)) AS e(value)
      JOIN api.workspace_memberships m ON m.id::text = e.value
     WHERE m.workspace_id = p_workspace_id AND m.role <> 'client_viewer';
    IF (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(coalesce(p_changes->'members', '[]'::jsonb))) <>
       coalesce(cardinality(v_ids), 0) THEN
      RAISE EXCEPTION 'every member must be a user of this workspace' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(m.user_id), '{}') INTO v_wanted
      FROM api.workspace_memberships m WHERE m.id = ANY (v_ids);
    DELETE FROM api.scim_group_members WHERE group_id = v_group.id AND NOT (user_id = ANY (v_wanted));
    INSERT INTO api.scim_group_members (group_id, workspace_id, user_id)
    SELECT v_group.id, p_workspace_id, u FROM unnest(v_wanted) AS u
    ON CONFLICT DO NOTHING;
    v_touched := v_before || v_wanted;
  END IF;

  PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_group', v_group.id,
    CASE WHEN v_creating THEN 'create' ELSE 'update' END,
    jsonb_build_object('action', CASE WHEN v_creating THEN 'scim-group-created' ELSE 'scim-group-updated' END,
                       'group', v_group.display_name,
                       'members', (SELECT count(*) FROM api.scim_group_members WHERE group_id = v_group.id)));
  PERFORM internal.scim_apply_roles(p_workspace_id, p_actor, v_touched);
  RETURN internal.scim_group_doc(p_workspace_id, v_group.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_set_group(uuid, text, uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_set_group(uuid, text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.scim_delete_group(p_workspace_id uuid, p_actor text, p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_group api.scim_groups;
  v_users text[];
BEGIN
  SELECT * INTO v_group FROM api.scim_groups WHERE id = p_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'group not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT coalesce(array_agg(user_id), '{}') INTO v_users FROM api.scim_group_members WHERE group_id = v_group.id;
  DELETE FROM api.scim_groups WHERE id = v_group.id;
  PERFORM internal.scim_emit(p_actor, p_workspace_id, 'scim_group', v_group.id, 'delete',
    jsonb_build_object('action', 'scim-group-deleted', 'group', v_group.display_name));
  PERFORM internal.scim_apply_roles(p_workspace_id, p_actor, v_users);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scim_delete_group(uuid, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scim_delete_group(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint

-- Sign-in groups and the provider's groups count together: a person who signs
-- in with a groups claim is also in the groups the provider has pushed.
CREATE OR REPLACE FUNCTION internal.apply_idp_groups(p_user_id text, p_groups text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_groups text[];
  v_all text[];
  v_changed integer := 0;
  v_want text;
  r record;
BEGIN
  SELECT coalesce(array_agg(DISTINCT lower(btrim(regexp_replace(g, '^/+', '')))), '{}'::text[])
    INTO v_groups FROM unnest(coalesce(p_groups, '{}'::text[])) AS g;
  PERFORM set_config('sheetbase.idp_sync', 'on', true);
  FOR r IN
    SELECT m.id, m.workspace_id, m.role
      FROM api.workspace_memberships m
     WHERE m.user_id = p_user_id
       AND m.role_source = 'idp'
       AND m.suspended_at IS NULL
       AND m.role NOT IN ('owner', 'client_viewer')
       AND EXISTS (SELECT 1 FROM api.idp_group_mappings g WHERE g.workspace_id = m.workspace_id)
  LOOP
    v_all := v_groups || coalesce((
      SELECT array_agg(lower(btrim(sg.display_name)))
        FROM api.scim_group_members gm
        JOIN api.scim_groups sg ON sg.id = gm.group_id
       WHERE gm.workspace_id = r.workspace_id AND gm.user_id = p_user_id), '{}'::text[]);
    SELECT g.role INTO v_want
      FROM api.idp_group_mappings g
     WHERE g.workspace_id = r.workspace_id
       AND lower(btrim(g.group_name)) = ANY (v_all)
     ORDER BY CASE g.role WHEN 'admin' THEN 1 WHEN 'steward' THEN 2 WHEN 'scientist' THEN 3
                          WHEN 'analyst' THEN 4 WHEN 'reviewer' THEN 5 ELSE 6 END
     LIMIT 1;
    v_want := coalesce(v_want, 'viewer');
    IF v_want <> r.role THEN
      UPDATE api.workspace_memberships SET role = v_want, updated_at = now() WHERE id = r.id;
      PERFORM internal.emit_change_event_as_actor(
        p_user_id, r.workspace_id, 'idp_group_mapping', r.id, 'update', NULL, NULL,
        jsonb_build_object('action', 'role-from-groups', 'userId', p_user_id,
                           'from', r.role, 'to', v_want));
      v_changed := v_changed + 1;
    END IF;
  END LOOP;
  RETURN v_changed;
END $$;
