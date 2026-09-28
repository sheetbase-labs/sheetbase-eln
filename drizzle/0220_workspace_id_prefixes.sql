-- SET-01.2 — configure per-kind identifier prefixes (admin-only).

CREATE OR REPLACE FUNCTION api.update_workspace_id_prefixes(
  p_workspace_id uuid,
  p_prefixes jsonb
)
RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.workspace_settings;
  key text;
  value text;
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
  IF jsonb_typeof(coalesce(p_prefixes, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'id prefixes must be an object' USING ERRCODE = '22023';
  END IF;
  FOR key, value IN SELECT * FROM jsonb_each_text(coalesce(p_prefixes, '{}'::jsonb)) LOOP
    IF key !~ '^[a-z][a-z0-9_]{0,59}$'
       OR value !~ '^[A-Z][A-Z0-9]{0,9}$' THEN
      RAISE EXCEPTION 'invalid identifier prefix' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, id_prefixes)
  VALUES (p_workspace_id, api.current_user_id(), coalesce(p_prefixes, '{}'::jsonb))
  ON CONFLICT (workspace_id) DO UPDATE
    SET id_prefixes = EXCLUDED.id_prefixes, updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_workspace_id_prefixes(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_workspace_id_prefixes(uuid, jsonb) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
