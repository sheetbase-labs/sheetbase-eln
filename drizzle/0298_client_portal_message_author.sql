-- PORTAL-02.3 — the portal thread shows who wrote each message. The client has
-- no read access to the internal user table, so the SECURITY DEFINER read
-- resolves the author's display name server-side.

DROP FUNCTION IF EXISTS api.client_portal_messages(uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.client_portal_messages(p_client_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, client_id uuid, project_id uuid, author_kind text,
  author_user_id text, author_name text, body text, created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_client uuid;
BEGIN
  IF api.current_client_id() IS NOT NULL THEN
    v_client := api.current_client_id();
  ELSE
    IF p_client_id IS NULL THEN
      -- An internal member with no client named sees nothing (not an error).
      RETURN;
    END IF;
    IF NOT api.is_workspace_member(api.current_workspace_id()) THEN
      RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
    END IF;
    v_client := p_client_id;
  END IF;
  RETURN QUERY
    SELECT m.id, m.client_id, m.project_id, m.author_kind,
           m.author_user_id, u.name, m.body, m.created_at
      FROM api.client_portal_messages m
      LEFT JOIN internal."user" u ON u.id = m.author_user_id
     WHERE m.client_id = v_client
       AND m.workspace_id = api.current_workspace_id()
     ORDER BY m.created_at ASC;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_messages(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_messages(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
