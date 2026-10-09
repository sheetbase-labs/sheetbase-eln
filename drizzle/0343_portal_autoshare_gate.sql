-- PORTAL-02 — the portal switch still gates a client's access.
--
-- The client-scoped branch added in 0341 resolved access from the project's
-- client alone, so turning the project's portal off (or removing the explicit
-- portal rule) no longer hid the project from its client viewers. The client
-- branch now also requires the project's own `auto_share_to_client` switch, so
-- the portal is on only while the lead has it on.
CREATE OR REPLACE FUNCTION internal.can_portal_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') <> 'authenticated' THEN false
    ELSE
      coalesce((SELECT client_portal
          AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
        FROM internal.project_permissions_for(p_project_id, api.current_user_id())), false)
      OR EXISTS (
        SELECT 1 FROM api.projects p
          JOIN api.workspace_memberships m
            ON m.workspace_id = p.workspace_id AND m.user_id = api.current_user_id()
        WHERE p.id = p_project_id
          AND p.workspace_id = api.current_workspace_id()
          AND p.auto_share_to_client
          AND m.suspended_at IS NULL
          AND m.role = 'client_viewer'
          AND m.client_id IS NOT NULL
          AND m.client_id = p.client_id
      )
  END
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
