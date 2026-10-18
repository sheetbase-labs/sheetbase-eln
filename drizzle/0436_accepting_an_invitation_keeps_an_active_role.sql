-- Accepting an invitation overwrote the accepter's existing membership with the invited role. An
-- owner who opened a Viewer invitation (their own, or one they were sent) became a Viewer, and the
-- last owner doing so left the workspace with nobody who can administer it. An active member now
-- keeps the role and client they already hold; the invitation is still consumed. A suspended member
-- is reinstated at the invited role, which is what an administrator re-inviting them means.
DO $$
DECLARE
  definition text;
  anchor text;
BEGIN
  definition := pg_get_functiondef('api.accept_invitation(text,text)'::regprocedure);
  anchor := 'SET role=EXCLUDED.role,client_id=EXCLUDED.client_id,suspended_at=NULL,updated_at=now();';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'accept_invitation conflict clause anchor missing; refusing to patch blindly';
  END IF;
  EXECUTE replace(
    definition,
    anchor,
    'SET role=CASE WHEN api.workspace_memberships.suspended_at IS NULL THEN api.workspace_memberships.role ELSE EXCLUDED.role END,'
    || 'client_id=CASE WHEN api.workspace_memberships.suspended_at IS NULL THEN api.workspace_memberships.client_id ELSE EXCLUDED.client_id END,'
    || 'suspended_at=NULL,updated_at=now();'
  );
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
