-- Who can actually review a project's records. A review decision is refused
-- unless the reviewer holds review access on the record's project (the project
-- lead, or a person or group the lead granted Review), so the Submit dialog
-- must not offer anyone else as a reviewer: they would be assigned work they
-- cannot decide. Read-only, and limited to people who can see the project.
CREATE OR REPLACE FUNCTION api.project_review_candidates(p_project_id uuid)
RETURNS TABLE(user_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT membership.user_id
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = api.current_workspace_id()
     AND membership.suspended_at IS NULL
     AND internal.can_view_project(p_project_id)
     AND EXISTS (
       SELECT 1
         FROM internal.project_permissions_for(p_project_id, membership.user_id) permissions
        WHERE permissions.can_review
     )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.project_review_candidates(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.project_review_candidates(uuid) TO authenticated;
