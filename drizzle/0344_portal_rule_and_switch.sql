-- PORTAL-02 / SET-02 — portal access needs an explicit rule and the switch.
--
-- Three suites encode one model: a client reaches a project's portal when the
-- project has an explicit `client_portal` rule for them *and* the project's
-- portal switch (`auto_share_to_client`) is on. The client-scoped shortcut added
-- in 0341 bypassed both, and the earlier predicate ignored the switch. This
-- restores the rule requirement (client-scoped shortcut removed) and requires
-- the switch for every principal; enabling the switch grants the client's
-- active client viewers an explicit portal rule (0345), which is how "turn the
-- portal on" reaches the client.
CREATE OR REPLACE FUNCTION internal.can_portal_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT client_portal
      AND (SELECT auto_share_to_client FROM api.projects WHERE id = p_project_id)
      AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
    FROM internal.project_permissions_for(p_project_id, api.current_user_id())
  ), false)
  AND coalesce(api.claim_probe()->>'role', '') = 'authenticated'
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
