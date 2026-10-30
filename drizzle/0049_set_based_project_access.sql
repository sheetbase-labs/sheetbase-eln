-- Project access, worked out once per query instead of once per row.
--
-- Row-level security used to call internal.can_view_project(project_id) for
-- every row a query touched. Counting 40,000 samples meant 40,000 function
-- calls, each reading the project, the membership and the access rules, which
-- took seconds. internal.viewable_project_ids() returns the same answer as a
-- set, and the policies ask for membership in it. PostgreSQL evaluates that
-- uncorrelated subquery once per statement and probes a hash table per row.
--
-- The rule itself is unchanged: a project is visible when it is in the current
-- workspace and the caller (an API client, or a signed-in member who is not a
-- client viewer) holds any access to it, directly or through a group.
CREATE FUNCTION internal.viewable_project_ids() RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.id
    FROM api.projects p
   WHERE p.workspace_id = api.current_workspace_id()
     AND coalesce(api.claim_probe()->>'role', '') = 'api_client'
  UNION ALL
  SELECT p.id
    FROM api.projects p
   WHERE p.workspace_id = api.current_workspace_id()
     AND coalesce(api.claim_probe()->>'role', '') = 'authenticated'
     AND EXISTS (
       SELECT 1
         FROM api.workspace_memberships m
         JOIN api.project_access a
           ON a.workspace_id = p.workspace_id AND a.project_id = p.id
          AND (a.user_id = m.user_id OR EXISTS (
                SELECT 1 FROM api.workspace_group_memberships g
                 WHERE g.workspace_id = p.workspace_id
                   AND g.group_id = a.group_id AND g.user_id = m.user_id))
        WHERE m.workspace_id = p.workspace_id
          AND m.user_id = api.current_user_id()
          AND m.suspended_at IS NULL
          AND m.role <> 'client_viewer'
          AND (a.can_view OR a.can_edit OR a.can_review OR a.can_manage))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.viewable_project_ids() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.viewable_project_ids() FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.viewable_project_ids() TO authenticated, api_client;
--> statement-breakpoint
ALTER POLICY records_live_read ON api.records
  USING ((project_id IS NULL) OR project_id IN (SELECT internal.viewable_project_ids()));
--> statement-breakpoint
ALTER POLICY projects_live_read ON api.projects
  USING (id IN (SELECT internal.viewable_project_ids()));
--> statement-breakpoint
ALTER POLICY project_access_live_read ON api.project_access
  USING (project_id IN (SELECT internal.viewable_project_ids()));
--> statement-breakpoint
-- Membership of the current workspace is the same answer for every row whose
-- workspace_id equals it, so ask once.
ALTER POLICY records_select ON api.records
  USING ((workspace_id = api.current_workspace_id())
         AND (SELECT api.is_workspace_member(api.current_workspace_id())));
