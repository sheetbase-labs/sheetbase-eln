-- API-07 / SET-02 — project-less objects stay reachable for api_client.
--
-- `internal.can_access_object` resolves an object's project and, when it is
-- NULL (a workspace-scoped Dataset, Record, Sheet Instance or similar), grants
-- access from workspace membership alone. That fallback required the calling
-- role to be `authenticated`, so an `api_client` credential with the right
-- scope could not write a project-less Dataset, Sheet Instance or Record even
-- though `api.is_workspace_writer` (record.create) authorises it. The fallback
-- now accepts both request roles; the project-scoped branches are unchanged.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('internal.can_access_object(text,uuid,text)'::regprocedure);

  IF strpos(definition, 'IF project IS NULL THEN
    RETURN api.claim_probe()->>''role''=''authenticated'' AND
      CASE WHEN p_permission=''view'' THEN api.is_workspace_member(workspace) ELSE api.is_workspace_writer(workspace) END;
  END IF;') = 0 THEN
    RAISE EXCEPTION 'can_access_object project-null anchor missing';
  END IF;

  definition := replace(
    definition,
    'IF project IS NULL THEN
    RETURN api.claim_probe()->>''role''=''authenticated'' AND
      CASE WHEN p_permission=''view'' THEN api.is_workspace_member(workspace) ELSE api.is_workspace_writer(workspace) END;
  END IF;',
    'IF project IS NULL THEN
    RETURN coalesce(api.claim_probe()->>''role'','''') IN (''authenticated'',''api_client'') AND
      CASE WHEN p_permission=''view'' THEN api.is_workspace_member(workspace) ELSE api.is_workspace_writer(workspace) END;
  END IF;'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
