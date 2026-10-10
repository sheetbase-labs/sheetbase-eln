-- SHELL-02: per-user appearance and navigation preferences.
--
-- `api.user_preferences` holds one row per user. The appearance choice
-- (System/Light/Dark) and the navigation collapsed state are written only
-- through the `set_user_preference` SECURITY DEFINER RPC, so the user id
-- always comes from request claims and never from a client payload. The
-- browser reads its own row under RLS to avoid a theme flash on load and to
-- restore the rail state.
--
-- The table DDL is the drizzle-generated delta in 0170; this migration adds
-- the access contract (RPC, grants, RLS), which drizzle does not model.

CREATE OR REPLACE FUNCTION "api"."set_user_preference"(
  p_appearance text,
  p_nav_collapsed boolean
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
    RAISE EXCEPTION 'set_user_preference requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_appearance NOT IN ('system', 'light', 'dark') THEN
    RAISE EXCEPTION 'unknown appearance value' USING ERRCODE = '22023';
  END IF;

  INSERT INTO "api"."user_preferences"
    (user_id, appearance, nav_collapsed, preferences, created_at, updated_at)
  VALUES
    (v_user_id, p_appearance, p_nav_collapsed, '{}'::jsonb, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    appearance = EXCLUDED.appearance,
    nav_collapsed = EXCLUDED.nav_collapsed,
    updated_at = now();
END;
$$;
--> statement-breakpoint

REVOKE ALL ON "api"."user_preferences" FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT SELECT ON "api"."user_preferences" TO authenticated;

--> statement-breakpoint

ALTER TABLE "api"."user_preferences" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint

CREATE POLICY user_preferences_select ON "api"."user_preferences"
  FOR SELECT TO authenticated
  USING (user_id = "api"."current_user_id"());

--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."set_user_preference"(text, boolean) FROM PUBLIC, anon, api_client;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION "api"."set_user_preference"(text, boolean) TO authenticated;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
