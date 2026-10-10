-- PORTAL-01 — the per-project client portal. `projects.auto_share_to_client`
-- (set through api.update_project_settings by an owner/admin) is the portal
-- switch: when it is on, the client of that project sees the project and its
-- approved records without an explicit per-record share. Explicit
-- client_portal_shares still work for projects whose portal is off.

CREATE OR REPLACE FUNCTION api.client_portal_projects()
RETURNS TABLE(
  project_id uuid, display_id text, title text, stage text,
  client_name text, client_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.display_id, p.title, p.stage, c.name, c.code
    FROM api.projects p
    JOIN api.clients c ON c.id = p.client_id
   WHERE c.id = api.current_client_id()
     AND c.workspace_id = api.current_workspace_id()
     AND p.auto_share_to_client
   ORDER BY p.title
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_projects() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_projects() TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.client_portal_records()
RETURNS TABLE(
  record_id uuid, identifier text, title text, kind text, status text,
  project_id uuid, shared_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.identifier, r.title, r.kind, r.status,
         coalesce(s.project_id, r.project_id),
         coalesce(s.shared_at, r.updated_at)
    FROM api.records r
    JOIN api.projects p ON p.id = r.project_id
    LEFT JOIN api.client_portal_shares s
      ON s.record_id = r.id AND s.client_id = api.current_client_id()
   WHERE p.client_id = api.current_client_id()
     AND p.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND r.status = 'approved'
     AND (s.id IS NOT NULL OR p.auto_share_to_client)
   ORDER BY coalesce(s.shared_at, r.updated_at) DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_records() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_records() TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
