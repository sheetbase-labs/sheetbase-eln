-- SET-01.1 — rename the workspace through an admin-only RPC.

CREATE OR REPLACE FUNCTION api.update_workspace_name(
  p_workspace_id uuid,
  p_name text
)
RETURNS api.workspaces
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.workspaces;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = api.current_user_id()
      AND m.suspended_at IS NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'workspace name must be 1–120 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE api.workspaces
     SET name = btrim(p_name), updated_at = now()
   WHERE id = p_workspace_id
   RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_workspace_name(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_workspace_name(uuid, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
