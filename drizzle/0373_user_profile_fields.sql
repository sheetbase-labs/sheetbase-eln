-- SET-03.1 — profile fields: initials, job title and time zone.
--
-- The SettingsProfile board shows the fields that identify the person (the full
-- name Better Auth holds is what signatures print, captured at signing), so the
-- rest live beside the appearance preference. Initials are derived from the name
-- when unset and the time zone must be a zone this database knows.
CREATE OR REPLACE FUNCTION internal.validate_user_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.initials IS NOT NULL THEN
    NEW.initials := upper(btrim(NEW.initials));
    IF NEW.initials !~ '^[A-Z]{1,4}$' THEN
      RAISE EXCEPTION 'initials must be one to four letters' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.job_title IS NOT NULL THEN
    NEW.job_title := nullif(btrim(NEW.job_title), '');
    IF length(coalesce(NEW.job_title, '')) > 120 THEN
      RAISE EXCEPTION 'job title is too long' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NEW.timezone IS NOT NULL THEN
    NEW.timezone := btrim(NEW.timezone);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name = NEW.timezone) THEN
      RAISE EXCEPTION 'unknown time zone' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.validate_user_profile() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS validate_user_profile ON api.user_preferences;
--> statement-breakpoint
CREATE TRIGGER validate_user_profile BEFORE INSERT OR UPDATE ON api.user_preferences
  FOR EACH ROW EXECUTE FUNCTION internal.validate_user_profile();
--> statement-breakpoint

-- Initials for a name, so a person who has not set them still has an avatar.
CREATE OR REPLACE FUNCTION internal.derived_initials(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce(nullif(upper(left(regexp_replace(coalesce(p_name, ''), '[^A-Za-z ]', '', 'g'), 1)), ''), '?')
    || coalesce(
         nullif(upper(substr(regexp_replace(coalesce(p_name, ''), '^[^ ]* ', ''), 1, 1)), ''),
         '')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.derived_initials(text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.derived_initials(text) TO authenticated;
--> statement-breakpoint

-- The signed-in person's profile, with the workspace and appearance beside it.
CREATE OR REPLACE FUNCTION api.my_profile()
RETURNS TABLE(
  user_id text,
  name text,
  email text,
  initials text,
  job_title text,
  timezone text,
  appearance text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT u.id, u.name, u.email,
         coalesce(p.initials, internal.derived_initials(u.name)),
         p.job_title,
         coalesce(p.timezone, s.timezone),
         coalesce(p.appearance, 'system')
    FROM internal."user" u
    LEFT JOIN api.user_preferences p ON p.user_id = u.id
    LEFT JOIN api.workspace_settings s ON s.workspace_id = api.current_workspace_id()
   WHERE u.id = api.current_user_id()
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.my_profile() FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.my_profile() TO authenticated;
--> statement-breakpoint

-- A person edits their own profile; nobody edits another's.
CREATE OR REPLACE FUNCTION api.set_user_profile(
  p_initials text DEFAULT NULL,
  p_job_title text DEFAULT NULL,
  p_timezone text DEFAULT NULL
) RETURNS TABLE(
  user_id text,
  name text,
  email text,
  initials text,
  job_title text,
  timezone text,
  appearance text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE v_actor text := api.current_user_id();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'profile changes require an authenticated user' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.user_preferences(user_id, initials, job_title, timezone)
  VALUES (v_actor, p_initials, p_job_title, p_timezone)
  ON CONFLICT (user_id) DO UPDATE SET
    initials = coalesce(p_initials, api.user_preferences.initials),
    job_title = coalesce(p_job_title, api.user_preferences.job_title),
    timezone = coalesce(p_timezone, api.user_preferences.timezone),
    updated_at = now();
  RETURN QUERY SELECT * FROM api.my_profile();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_user_profile(text,text,text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_user_profile(text,text,text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
