-- Profile photos.
--
-- A person can give themselves a photo; it replaces their initials wherever
-- their avatar is shown. The bytes live in object storage (the same storage
-- layer as files) under a key that names the owner, so a row can only ever
-- point at its own owner's photo. Co-members of a workspace can see each
-- other's photos.

ALTER TABLE api.user_preferences
    ADD COLUMN photo_storage_key text,
    ADD COLUMN photo_media_type text,
    ADD COLUMN photo_updated_at timestamp with time zone,
    ADD CONSTRAINT chk_user_preferences_photo_key CHECK (
        photo_storage_key IS NULL
        OR (
            substring(photo_storage_key from '/([0-9a-f]{32})$') IS NOT NULL
            AND photo_storage_key = 'avatars/' || user_id || '/' || substring(photo_storage_key from '/([0-9a-f]{32})$')
        )
    ),
    ADD CONSTRAINT chk_user_preferences_photo_type CHECK (
        photo_media_type IS NULL
        OR photo_media_type = ANY (ARRAY['image/webp'::text, 'image/jpeg'::text, 'image/png'::text])
    ),
    ADD CONSTRAINT chk_user_preferences_photo_complete CHECK (
        (photo_storage_key IS NULL) = (photo_media_type IS NULL)
        AND (photo_storage_key IS NULL) = (photo_updated_at IS NULL)
    );
--> statement-breakpoint

-- Sets the caller's photo and returns the key it replaced, so the server can
-- remove the old bytes.
CREATE FUNCTION api.set_my_photo(p_storage_key text, p_media_type text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_previous text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'profile changes require an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT p.photo_storage_key INTO v_previous
    FROM api.user_preferences p WHERE p.user_id = v_actor FOR UPDATE;
  INSERT INTO api.user_preferences (user_id, photo_storage_key, photo_media_type, photo_updated_at)
  VALUES (v_actor, p_storage_key, p_media_type, now())
  ON CONFLICT (user_id) DO UPDATE SET
    photo_storage_key = excluded.photo_storage_key,
    photo_media_type = excluded.photo_media_type,
    photo_updated_at = excluded.photo_updated_at,
    updated_at = now();
  RETURN v_previous;
END $$;
--> statement-breakpoint

-- Removes the caller's photo and returns the key it held.
CREATE FUNCTION api.clear_my_photo() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_previous text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'profile changes require an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT p.photo_storage_key INTO v_previous
    FROM api.user_preferences p WHERE p.user_id = v_actor FOR UPDATE;
  UPDATE api.user_preferences p
     SET photo_storage_key = NULL, photo_media_type = NULL, photo_updated_at = NULL,
         updated_at = now()
   WHERE p.user_id = v_actor;
  RETURN v_previous;
END $$;
--> statement-breakpoint

-- Who in the current workspace has a photo, with a version that changes each
-- time the photo does. The caller is always included.
CREATE FUNCTION api.workspace_member_photos() RETURNS TABLE(user_id text, photo_version text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.user_id,
         (extract(epoch FROM p.photo_updated_at) * 1000)::bigint::text
    FROM api.user_preferences p
   WHERE p.photo_storage_key IS NOT NULL
     AND (
       p.user_id = api.current_user_id()
       OR (
         api.current_workspace_id() IS NOT NULL
         AND api.is_workspace_member(api.current_workspace_id())
         AND EXISTS (
           SELECT 1 FROM api.workspace_memberships m
            WHERE m.workspace_id = api.current_workspace_id()
              AND m.user_id = p.user_id
         )
       )
     )
$$;
--> statement-breakpoint

-- Where one person's photo is kept, when the caller may see it.
CREATE FUNCTION api.member_photo(p_user_id text) RETURNS TABLE(storage_key text, media_type text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p.photo_storage_key, p.photo_media_type
    FROM api.user_preferences p
   WHERE p.user_id = p_user_id
     AND p.photo_storage_key IS NOT NULL
     AND (
       p.user_id = api.current_user_id()
       OR (
         api.current_workspace_id() IS NOT NULL
         AND api.is_workspace_member(api.current_workspace_id())
         AND EXISTS (
           SELECT 1 FROM api.workspace_memberships m
            WHERE m.workspace_id = api.current_workspace_id()
              AND m.user_id = p.user_id
         )
       )
     )
$$;
--> statement-breakpoint

ALTER FUNCTION api.set_my_photo(text, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.clear_my_photo() OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.workspace_member_photos() OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.member_photo(text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_my_photo(text, text), api.clear_my_photo(), api.workspace_member_photos(), api.member_photo(text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_my_photo(text, text), api.clear_my_photo(), api.workspace_member_photos(), api.member_photo(text) TO authenticated;
