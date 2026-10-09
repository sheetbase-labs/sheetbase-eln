-- API-07 / SET-02 — project predicates are workspace-scoped for api_client.
--
-- The 0323 restrictive `<table>_live_read`/`_write` policies resolve a
-- project-scoped object through `internal.can_view_project` / `can_edit_project`,
-- which are derived from the calling user's explicit project rules. An
-- api_client credential has no user, so those predicates were false and a
-- workspace-scoped credential could not read or write any project-scoped
-- Record, Dataset or Sheet in its own workspace. For api_client these two
-- predicates now resolve from the credential's workspace claim; write scope is
-- still gated by the credential's scopes and the workspace check is unchanged.
--
-- Review and manage stay user-based: a credential must not be able to approve
-- records or change project access rules.
CREATE OR REPLACE FUNCTION internal.can_view_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
      EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
    ELSE coalesce((SELECT can_view AND coalesce(api.claim_probe()->>'role' = 'authenticated', false)
        AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
      FROM internal.project_permissions_for(p_project_id, api.current_user_id())), false)
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.can_edit_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
      EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
    ELSE coalesce((SELECT can_edit AND coalesce(api.claim_probe()->>'role' = 'authenticated', false)
        AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
      FROM internal.project_permissions_for(p_project_id, api.current_user_id())), false)
  END
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
