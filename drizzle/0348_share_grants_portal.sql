-- PORTAL-02 — sharing a record grants the client portal authority.
--
-- The portal readers require explicit `client_portal` authority for the project
-- (`internal.can_portal_project`), and an explicit record share is exactly that
-- authority for the project it belongs to — but `api.share_record_with_client`
-- only wrote the share row, so a client saw nothing unless a rule happened to
-- exist. Sharing now also grants the rule to the project client's active client
-- viewers, idempotently; the reader still decides per record between the share
-- and the project's portal switch.
DO $$ DECLARE definition text; anchor text; grant_block text;
BEGIN
  definition := pg_get_functiondef('api.share_record_with_client(uuid,uuid)'::regprocedure);
  anchor := E'  RETURN v;\nEND $function$';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'share_record_with_client anchor missing';
  END IF;
  grant_block := E'  INSERT INTO api.project_access(workspace_id, project_id, user_id, can_view, can_edit, can_review, client_portal, can_manage, granted_by_user_id)\n  SELECT v.workspace_id, v.project_id, m.user_id, false, false, false, true, false, api.current_user_id()\n    FROM api.workspace_memberships m\n   WHERE m.workspace_id = v.workspace_id\n     AND m.suspended_at IS NULL\n     AND m.role = ''client_viewer''\n     AND m.client_id = v.client_id\n  ON CONFLICT (workspace_id, project_id, user_id)\n  DO UPDATE SET client_portal = true, updated_at = now();\n';
  definition := replace(definition, anchor, grant_block || anchor);
  EXECUTE definition;
END $$;
--> statement-breakpoint

-- Portal authority is the explicit rule (granted by the portal switch, an
-- accepted client invitation or a record share); client identity alone is not
-- authority, and the reader still decides share-versus-switch per record.
CREATE OR REPLACE FUNCTION internal.can_portal_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(api.claim_probe()->>'role', '') = 'authenticated'
    AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
    AND coalesce((SELECT client_portal
      FROM internal.project_permissions_for(p_project_id, api.current_user_id())), false)
$$;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
