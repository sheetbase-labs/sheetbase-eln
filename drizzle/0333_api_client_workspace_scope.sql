-- API-07 / SET-02 — an api_client credential is workspace-scoped.
--
-- `internal.can_access_object` resolved project-scoped objects through
-- `internal.can_*_project`, which is derived from the calling *user's* explicit
-- project rules. An api_client credential has no user, so it could not read or
-- write any project-scoped object in its own workspace. A credential's scope is
-- its workspace (PGRST claims) plus its granted scopes, so an api_client now
-- resolves project-scoped objects from workspace membership/writer, exactly
-- like the project-less fallback. The workspace check above is unchanged, so a
-- credential still cannot reach another workspace.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('internal.can_access_object(text,uuid,text)'::regprocedure);

  IF strpos(definition, 'IF project IS NULL THEN') = 0 THEN
    RAISE EXCEPTION 'can_access_object project anchor missing';
  END IF;

  definition := replace(
    definition,
    'IF project IS NULL THEN',
    'IF coalesce(api.claim_probe()->>''role'','''') = ''api_client'' THEN
    RETURN CASE WHEN p_permission=''view'' THEN api.is_workspace_member(workspace) ELSE api.is_workspace_writer(workspace) END;
  END IF;
  IF project IS NULL THEN'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
