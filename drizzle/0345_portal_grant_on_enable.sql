-- PORTAL-02 — turning the portal on reaches the client.
--
-- `api.update_project_settings(..., p_auto_share_to_client := true)` only flipped
-- the project switch; the portal readers additionally require an explicit
-- `client_portal` rule, so the client still saw nothing. Enabling the switch now
-- grants that rule to the project client's active client viewers (the project's
-- own client members), which is the explicit portal authority the readers check.
-- Disabling the switch leaves the rules in place: access is gated by the switch.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition := pg_get_functiondef('api.update_project_settings(uuid,boolean,boolean,boolean)'::regprocedure);

  anchor := E'    RETURNING * INTO v;\n  RETURN v;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'update_project_settings anchor missing';
  END IF;

  definition := replace(
    definition,
    anchor,
    E'    RETURNING * INTO v;\n  IF p_auto_share_to_client IS TRUE AND v.client_id IS NOT NULL THEN\n    INSERT INTO api.project_access(workspace_id, project_id, user_id, can_view, can_edit, can_review, client_portal, can_manage, granted_by_user_id)\n    SELECT v.workspace_id, v.id, m.user_id, false, false, false, true, false, api.current_user_id()\n      FROM api.workspace_memberships m\n     WHERE m.workspace_id = v.workspace_id\n       AND m.suspended_at IS NULL\n       AND m.role = ''client_viewer''\n       AND m.client_id = v.client_id\n    ON CONFLICT (workspace_id, project_id, user_id)\n    DO UPDATE SET client_portal = true, updated_at = now();\n  END IF;\n  RETURN v;'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
