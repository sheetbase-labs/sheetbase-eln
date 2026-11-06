-- Roles from single sign-on groups.
--
-- A lab that signs in through its identity provider already keeps its people
-- in groups there. A workspace can now say "this group is a scientist, that one
-- is an admin", and people's roles follow their groups each time they sign in:
--
--   api.idp_group_mappings   group name -> role, per workspace;
--   workspace_memberships.role_source
--                            'idp' when groups decide the person's role, and
--                            'manual' once an administrator has set it by hand.
--                            People who join by their email domain start with
--                            'idp'; everyone else starts 'manual' until an
--                            administrator chooses "Let groups decide";
--   internal.apply_idp_groups
--                            applies a person's groups from a sign-in.
--
-- The highest role among a person's mapped groups wins. Someone in no mapped
-- group becomes a viewer, which can read and nothing else. Owners and client
-- accounts are never changed by groups.

ALTER TABLE api.workspace_memberships
    ADD COLUMN role_source text DEFAULT 'manual' NOT NULL,
    ADD CONSTRAINT chk_workspace_memberships_role_source CHECK (role_source IN ('manual', 'idp'));
--> statement-breakpoint

-- Changing a role any other way than through groups pins it.
CREATE FUNCTION internal.pin_role_source() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND coalesce(current_setting('sheetbase.idp_sync', true), '') <> 'on' THEN
    NEW.role_source := 'manual';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.pin_role_source() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER pin_role_source BEFORE UPDATE OF role ON api.workspace_memberships
    FOR EACH ROW EXECUTE FUNCTION internal.pin_role_source();
--> statement-breakpoint

CREATE TABLE api.idp_group_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    group_name text NOT NULL,
    role text NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT idp_group_mappings_pkey PRIMARY KEY (id),
    CONSTRAINT chk_idp_group_mappings_name CHECK (length(btrim(group_name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_idp_group_mappings_role CHECK (role IN ('admin', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer')),
    CONSTRAINT idp_group_mappings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT idp_group_mappings_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE api.idp_group_mappings OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_idp_group_mappings_name ON api.idp_group_mappings (workspace_id, lower(btrim(group_name)));
--> statement-breakpoint
ALTER TABLE api.idp_group_mappings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idp_group_mappings_select ON api.idp_group_mappings FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'members', 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.idp_group_mappings TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_idp_group_mapping(p_workspace_id uuid, p_group_name text, p_role text)
    RETURNS api.idp_group_mappings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text := btrim(coalesce(p_group_name, ''));
  v_row api.idp_group_mappings;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF v_name = '' OR length(v_name) > 200 THEN
    RAISE EXCEPTION 'enter the group name as your identity provider spells it' USING ERRCODE = '22023';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer') THEN
    RAISE EXCEPTION 'a group can give admin, data steward, scientist, analyst, reviewer or viewer' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.idp_group_mappings (workspace_id, group_name, role, created_by_user_id)
  VALUES (p_workspace_id, v_name, p_role, api.current_user_id())
  ON CONFLICT (workspace_id, lower(btrim(group_name)))
  DO UPDATE SET role = EXCLUDED.role, group_name = EXCLUDED.group_name
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'idp_group_mapping', v_row.id, 'update', NULL, NULL,
    jsonb_build_object('action', 'group-mapped', 'group', v_row.group_name, 'role', v_row.role));
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_idp_group_mapping(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_idp_group_mapping(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_idp_group_mapping(uuid, text, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_idp_group_mapping(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.idp_group_mappings;
BEGIN
  SELECT * INTO v_row FROM api.idp_group_mappings WHERE id = p_id;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  DELETE FROM api.idp_group_mappings WHERE id = p_id;
  PERFORM internal.emit_change_event(
    v_row.workspace_id, 'idp_group_mapping', v_row.id, 'delete', NULL, NULL,
    jsonb_build_object('action', 'group-unmapped', 'group', v_row.group_name, 'role', v_row.role));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_idp_group_mapping(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_idp_group_mapping(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_idp_group_mapping(uuid) TO authenticated;
--> statement-breakpoint

-- Let groups decide the role of everyone already in the workspace, from their
-- next sign-in. Returns how many people it applies to.
CREATE FUNCTION api.adopt_group_roles(p_workspace_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  WITH adopted AS (
    UPDATE api.workspace_memberships
       SET role_source = 'idp'
     WHERE workspace_id = p_workspace_id
       AND role NOT IN ('owner', 'client_viewer')
       AND role_source <> 'idp'
    RETURNING 1)
  SELECT count(*) INTO v_count FROM adopted;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'idp_group_mapping', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('action', 'groups-decide-roles', 'people', v_count));
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.adopt_group_roles(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.adopt_group_roles(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.adopt_group_roles(uuid) TO authenticated;
--> statement-breakpoint

-- Apply a signed-in person's groups. Called by the app after a single sign-on
-- sign-in that carried a groups claim. Returns how many workspaces changed
-- the person's role.
CREATE FUNCTION internal.apply_idp_groups(p_user_id text, p_groups text[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_groups text[];
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
    SELECT g.role INTO v_want
      FROM api.idp_group_mappings g
     WHERE g.workspace_id = r.workspace_id
       AND lower(btrim(g.group_name)) = ANY (v_groups)
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
--> statement-breakpoint
ALTER FUNCTION internal.apply_idp_groups(text, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_idp_groups(text, text[]) FROM PUBLIC;
--> statement-breakpoint

-- Someone who joins through their email domain has not had a role chosen for
-- them by hand, so their groups may refine the domain's role.
CREATE OR REPLACE FUNCTION internal.join_workspace_by_email_domain(p_user_id text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_email text;
  v_verified boolean;
  v_join api.workspace_join_domains;
BEGIN
  SELECT u.email, u."emailVerified" INTO v_email, v_verified
    FROM internal."user" u WHERE u.id = p_user_id;
  IF v_email IS NULL OR v_verified IS NOT TRUE THEN RETURN NULL; END IF;
  SELECT * INTO v_join FROM api.workspace_join_domains
   WHERE domain = lower(split_part(v_email, '@', 2));
  IF v_join.domain IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspaces w WHERE w.id = v_join.workspace_id AND w.status = 'active') THEN
    RETURN NULL;
  END IF;
  INSERT INTO api.workspace_memberships (workspace_id, user_id, role, role_source)
  VALUES (v_join.workspace_id, p_user_id, v_join.role, 'idp')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN v_join.workspace_id;
END;
$$;
