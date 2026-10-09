-- PORTAL-02 — accepting a client invitation reaches the portal-enabled projects.
--
-- `api.accept_invitation` created the client viewer's membership but no portal
-- rule, so a client invited into a project whose portal was already on still saw
-- nothing (the portal readers require an explicit `client_portal` rule). Accepting
-- a client invitation now grants that rule for every portal-enabled project of
-- the invitation's client.
DO $$ DECLARE definition text; anchor text; grant_block text;
BEGIN
  definition := pg_get_functiondef('api.accept_invitation(text,text)'::regprocedure);
  anchor := E'  UPDATE api.workspace_invitations SET status=''accepted''';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'accept_invitation anchor missing';
  END IF;
  grant_block := E'  IF v.role = ''client_viewer'' AND v.client_id IS NOT NULL THEN\n    INSERT INTO api.project_access(workspace_id, project_id, user_id, can_view, can_edit, can_review, client_portal, can_manage, granted_by_user_id)\n    SELECT p.workspace_id, p.id, p_user_id, false, false, false, true, false, p_user_id\n      FROM api.projects p\n     WHERE p.workspace_id = v.workspace_id\n       AND p.client_id = v.client_id\n       AND p.auto_share_to_client\n    ON CONFLICT (workspace_id, project_id, user_id)\n    DO UPDATE SET client_portal = true, updated_at = now();\n  END IF;\n';
  definition := replace(definition, anchor, grant_block || anchor);
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
