-- SHELL-01.4: choose the active workspace.
--
-- The stored workspace is only honoured while the caller is still a member
-- (checked here and again at resolution time). It never broadens access: RLS
-- and RPCs keep their per-workspace predicates.
CREATE OR REPLACE FUNCTION "api"."set_active_workspace"(
  p_workspace_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = api, internal, public
AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_active_workspace requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR NOT "api"."is_workspace_member"(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of that workspace' USING ERRCODE = '42501';
  END IF;

  INSERT INTO "api"."user_preferences"
    (user_id, active_workspace_id, created_at, updated_at)
  VALUES
    (v_user_id, p_workspace_id, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now();
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."set_active_workspace"(uuid) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."set_active_workspace"(uuid) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
