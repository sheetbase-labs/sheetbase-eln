-- PROJ-03.1 — project_members returns the project role.
--
-- The members tab has always had a "Project role" column, but it rendered the workspace
-- membership role, which is a different thing. Now that api.project_access carries
-- project_role (0393), the RPC returns it so the column shows what the person does on
-- the project. The direct user row is used; a role set only through a group is not a
-- per-person project role, and groups arrive with DEC-06/SET-02.

DROP FUNCTION IF EXISTS api.project_members(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.project_members(p_project_id uuid)
RETURNS TABLE(
  user_id text,
  name text,
  access_level text,
  workspace_role text,
  project_role text,
  is_lead boolean,
  added_at timestamp with time zone,
  can_view boolean,
  can_edit boolean,
  can_review boolean,
  client_portal boolean,
  can_manage boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT m.user_id,u.name,
    CASE WHEN q.can_manage THEN 'owner' WHEN q.can_edit THEN 'editor' WHEN q.can_review THEN 'reviewer' ELSE 'viewer' END,
    m.role,
    (SELECT a.project_role FROM api.project_access a WHERE a.project_id=p.id AND a.user_id=m.user_id LIMIT 1),
    p.lead_user_id=m.user_id,
    (SELECT min(a.created_at) FROM api.project_access a WHERE a.project_id=p.id AND (a.user_id=m.user_id OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g WHERE g.group_id=a.group_id AND g.user_id=m.user_id))),
    q.can_view,q.can_edit,q.can_review,q.client_portal,q.can_manage
  FROM api.projects p JOIN api.workspace_memberships m ON m.workspace_id=p.workspace_id AND m.suspended_at IS NULL
  JOIN internal."user" u ON u.id=m.user_id CROSS JOIN LATERAL internal.project_permissions_for(p.id,m.user_id) q
  WHERE p.id=p_project_id AND internal.can_view_project(p.id) AND q.can_view
  ORDER BY (p.lead_user_id=m.user_id) DESC,u.name
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.project_members(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.project_members(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
