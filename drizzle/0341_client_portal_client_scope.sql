-- PORTAL-02 / SET-02 — a client viewer reaches their own client's portal.
--
-- The 0323 SQL-reader guard added `internal.can_portal_project(p.id)` to the
-- portal readers. That predicate is derived from the caller's explicit project
-- rules, so a client viewer saw nothing unless a per-user `client_portal` rule
-- had been granted — even though the design gates the portal by the project's
-- client (`projects.client_id` + `auto_share_to_client`), which is how a client
-- user is attached in the first place. A client viewer whose client is the
-- project's client, in their own workspace, now has portal access; explicit
-- rules still work and every other role is unchanged.
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
          AND m.suspended_at IS NULL
          AND m.role = 'client_viewer'
          AND m.client_id IS NOT NULL
          AND m.client_id = p.client_id
      )
  END
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
