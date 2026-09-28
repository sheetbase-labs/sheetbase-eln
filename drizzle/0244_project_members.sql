-- UI port — project membership read and management.
--
-- project_access holds the permission; workspace_memberships holds the role.
-- Names live in internal.user, so the readers are SECURITY DEFINER and gated on
-- workspace membership; the writers additionally require the project lead or a
-- workspace admin.

CREATE OR REPLACE FUNCTION api.workspace_members_list()
RETURNS TABLE(user_id text, name text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT m.user_id, u.name, m.role
  FROM api.workspace_memberships m
  JOIN internal."user" u ON u.id = m.user_id
  WHERE m.workspace_id = api.current_workspace_id()
    AND m.suspended_at IS NULL
    AND api.is_workspace_member(m.workspace_id)
  ORDER BY u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.workspace_members_list() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.workspace_members_list() TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM api.projects p
    WHERE p.id = p_project_id
      AND p.workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(p.workspace_id)
      AND (
        p.lead_user_id = api.current_user_id()
        OR EXISTS (
          SELECT 1 FROM api.workspace_memberships m
          WHERE m.workspace_id = p.workspace_id
            AND m.user_id = api.current_user_id()
            AND m.role IN ('owner', 'admin')
        )
      )
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.project_members(p_project_id uuid)
RETURNS TABLE(
  user_id text, name text, access_level text, workspace_role text,
  is_lead boolean, added_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH ids AS (
    SELECT pa.user_id FROM api.project_access pa WHERE pa.project_id = p_project_id
    UNION
    SELECT p.lead_user_id FROM api.projects p
    WHERE p.id = p_project_id AND p.lead_user_id IS NOT NULL
  )
  SELECT i.user_id, u.name,
         coalesce(pa.access_level, 'owner'),
         m.role,
         (p.lead_user_id = i.user_id),
         coalesce(pa.created_at, p.created_at)
  FROM ids i
  JOIN api.projects p ON p.id = p_project_id
  JOIN internal."user" u ON u.id = i.user_id
  LEFT JOIN api.project_access pa
    ON pa.project_id = p_project_id AND pa.user_id = i.user_id
  LEFT JOIN api.workspace_memberships m
    ON m.workspace_id = p.workspace_id AND m.user_id = i.user_id
  WHERE p.workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(p.workspace_id)
  ORDER BY (p.lead_user_id = i.user_id) DESC, u.name
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.project_members(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.project_members(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_project_member(
  p_project_id uuid,
  p_user_id text,
  p_access_level text
)
RETURNS api.project_access
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.project_access;
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.projects WHERE id = p_project_id;
  IF v_workspace IS NULL OR NOT internal.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'project lead or admin required' USING ERRCODE = '42501';
  END IF;
  IF p_access_level NOT IN ('owner', 'editor', 'viewer') THEN
    RAISE EXCEPTION 'unknown access level' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v_workspace AND m.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'person is not a workspace member' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.project_access
    (workspace_id, project_id, user_id, access_level, granted_by_user_id)
  VALUES (v_workspace, p_project_id, p_user_id, p_access_level, api.current_user_id())
  ON CONFLICT (workspace_id, project_id, user_id)
  DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_project_member(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_project_member(uuid, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.remove_project_member(p_project_id uuid, p_user_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NOT internal.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'project lead or admin required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.project_access
  WHERE project_id = p_project_id AND user_id = p_user_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_project_member(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.remove_project_member(uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
