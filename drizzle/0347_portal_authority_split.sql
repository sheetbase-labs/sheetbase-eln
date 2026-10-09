-- PORTAL-02 — client identity for record access, explicit authority for listing.
--
-- The portal readers separate two questions. `can_portal_project` answers "may
-- this caller see this project's client-facing records at all" — a client viewer
-- of the project's client, or anyone with an explicit `client_portal` rule —
-- and the reader then decides per record whether it is explicitly shared or the
-- project's portal switch is on. Listing a *project* additionally requires
-- explicit portal authority, so a project that merely names the client's id does
-- not appear until the lead turns its portal on (which grants the rule).
CREATE OR REPLACE FUNCTION internal.can_portal_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(api.claim_probe()->>'role', '') = 'authenticated'
    AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = api.current_workspace_id())
    AND (
      coalesce((SELECT client_portal
        FROM internal.project_permissions_for(p_project_id, api.current_user_id())), false)
      OR EXISTS (
        SELECT 1 FROM api.projects p
          JOIN api.workspace_memberships m
            ON m.workspace_id = p.workspace_id AND m.user_id = api.current_user_id()
        WHERE p.id = p_project_id
          AND m.suspended_at IS NULL
          AND m.role = 'client_viewer'
          AND m.client_id IS NOT NULL
          AND m.client_id = p.client_id
      )
    )
$$;
--> statement-breakpoint

-- Listing a project's portal needs explicit portal authority (the rule the
-- switch grants); a shared record does not.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition := pg_get_functiondef('api.client_portal_projects()'::regprocedure);
  anchor := '     AND p.auto_share_to_client';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'client_portal_projects anchor missing';
  END IF;
  definition := replace(
    definition,
    anchor,
    anchor || E'\n     AND EXISTS (SELECT 1 FROM api.project_access a\n       WHERE a.project_id = p.id AND a.client_portal\n         AND (a.user_id = api.current_user_id()\n              OR EXISTS (SELECT 1 FROM api.workspace_group_memberships g\n                   WHERE g.group_id = a.group_id AND g.user_id = api.current_user_id())))'
  );
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
