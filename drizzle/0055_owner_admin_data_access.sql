-- Owners and admins always have data access (the technical view and a personal
-- read-only SQL login). The workspace's data_access_roles list now only decides
-- which other roles get it, so an owner can no longer lock themselves out.
CREATE OR REPLACE FUNCTION api.has_data_access(p_workspace_id uuid DEFAULT NULL) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(api.claim_probe()->>'role', '') = 'authenticated'
     AND EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = api.current_workspace_id()
          AND m.workspace_id = coalesce(p_workspace_id, m.workspace_id)
          AND m.user_id = api.current_user_id()
          AND m.suspended_at IS NULL
          AND (m.role IN ('owner', 'admin')
               OR m.role = ANY (internal.data_access_roles(m.workspace_id))))
$$;
--> statement-breakpoint
COMMENT ON FUNCTION api.has_data_access(uuid) IS 'True for owners and admins, and for any other role listed in workspace_settings.data_access_roles.';
