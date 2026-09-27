-- SHELL-02: appearance-only write so the theme switch never clobbers the
-- navigation state held in the same row.
CREATE OR REPLACE FUNCTION "api"."set_user_appearance"(
  p_appearance text
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
    RAISE EXCEPTION 'set_user_appearance requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_appearance NOT IN ('system', 'light', 'dark') THEN
    RAISE EXCEPTION 'unknown appearance value' USING ERRCODE = '22023';
  END IF;

  INSERT INTO "api"."user_preferences"
    (user_id, appearance, nav_collapsed, preferences, created_at, updated_at)
  VALUES
    (v_user_id, p_appearance, false, '{}'::jsonb, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET appearance = EXCLUDED.appearance, updated_at = now();
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."set_user_appearance"(text) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."set_user_appearance"(text) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
