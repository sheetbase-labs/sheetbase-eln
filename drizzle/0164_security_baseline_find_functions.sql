-- ---------------------------------------------------------------------------
-- Security baseline: pin empty search_path on user-scoped DEFINER RPCs and
-- exempt them from the shared-mutation inventory.
--
-- record_recent_view / set_record_favourite are authenticated-executable by
-- design (per-user recents/favourites, caller-scoped rows, membership
-- checked). Their bodies reference only schema-qualified objects, so an
-- empty search_path changes nothing at runtime and satisfies the PLAT-03
-- invariant. The GOV-01 inventory exempts exactly these two (see #167);
-- it still fails closed on any other leftover authenticated mutation RPC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."record_recent_view"(
  p_object_kind text,
  p_object_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_viewed_at timestamptz;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'record_recent_view requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind NOT IN ('record', 'dataset', 'sheet', 'project', 'notebook_template') THEN
    RAISE EXCEPTION 'unknown recent-object kind' USING ERRCODE = '22023';
  END IF;

  v_workspace_id := CASE p_object_kind
    WHEN 'record' THEN (
      SELECT r.workspace_id FROM api.records r
      WHERE r.id = p_object_id AND r.deleted_at IS NULL
    )
    WHEN 'dataset' THEN (
      SELECT d.workspace_id FROM api.datasets d WHERE d.id = p_object_id
    )
    WHEN 'sheet' THEN (
      SELECT s.workspace_id FROM api.sheet_instances s WHERE s.id = p_object_id
    )
    WHEN 'project' THEN (
      SELECT p.workspace_id FROM api.projects p WHERE p.id = p_object_id
    )
    WHEN 'notebook_template' THEN (
      SELECT t.workspace_id FROM api.notebook_templates t WHERE t.id = p_object_id
    )
  END;

  -- Unknown objects and objects whose workspace the caller can no longer see
  -- are ignored rather than erroring: view tracking is best-effort.
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "api"."recently_viewed"
    (workspace_id, user_id, object_kind, object_id, viewed_at)
  VALUES
    (v_workspace_id, v_user_id, p_object_kind, p_object_id, now())
  ON CONFLICT (user_id, object_kind, object_id)
  DO UPDATE SET viewed_at = EXCLUDED.viewed_at, workspace_id = EXCLUDED.workspace_id
  RETURNING viewed_at INTO v_viewed_at;

  -- Keep the table thin: retain only the most recent 200 objects per user.
  DELETE FROM "api"."recently_viewed"
  WHERE user_id = v_user_id
    AND (object_kind, object_id) NOT IN (
      SELECT object_kind, object_id
      FROM api.recently_viewed
      WHERE user_id = v_user_id
      ORDER BY viewed_at DESC, object_kind ASC, object_id ASC
      LIMIT 200
    );

  RETURN v_viewed_at;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."set_record_favourite"(
  p_object_kind text,
  p_object_id uuid,
  p_favourite boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_created_at timestamptz;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_record_favourite requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind NOT IN ('record', 'dataset', 'sheet', 'project', 'notebook_template') THEN
    RAISE EXCEPTION 'unknown favourite-object kind' USING ERRCODE = '22023';
  END IF;

  -- Unfavouriting (p_favourite = false) removes the CALLER-OWNED pin before
  -- any object-resolution or membership check: an object that has since been
  -- deleted (no canonical row) or whose workspace the caller left must still
  -- be unfavouritable. The user_id predicate makes this caller-scoped only;
  -- no other user's favourite can be touched.
  IF NOT p_favourite THEN
    DELETE FROM "api"."user_favourites"
    WHERE user_id = v_user_id
      AND object_kind = p_object_kind
      AND object_id = p_object_id;
    RETURN NULL;
  END IF;

  v_workspace_id := CASE p_object_kind
    WHEN 'record' THEN (
      SELECT r.workspace_id FROM api.records r
      WHERE r.id = p_object_id AND r.deleted_at IS NULL
    )
    WHEN 'dataset' THEN (
      SELECT d.workspace_id FROM api.datasets d WHERE d.id = p_object_id
    )
    WHEN 'sheet' THEN (
      SELECT s.workspace_id FROM api.sheet_instances s WHERE s.id = p_object_id
    )
    WHEN 'project' THEN (
      SELECT p.workspace_id FROM api.projects p WHERE p.id = p_object_id
    )
    WHEN 'notebook_template' THEN (
      SELECT t.workspace_id FROM api.notebook_templates t WHERE t.id = p_object_id
    )
  END;

  -- Unknown objects and objects whose workspace the caller can no longer see
  -- are ignored rather than erroring: favourites must never disturb the page.
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN NULL;
  END IF;

  IF p_favourite THEN
    INSERT INTO "api"."user_favourites"
      (workspace_id, user_id, object_kind, object_id, created_at)
    VALUES
      (v_workspace_id, v_user_id, p_object_kind, p_object_id, now())
    -- created_at is preserved on conflict: re-starring an existing favourite
    -- must not move it to the top of the home surface.
    ON CONFLICT (user_id, object_kind, object_id)
    DO UPDATE SET workspace_id = EXCLUDED.workspace_id
    RETURNING created_at INTO v_created_at;
    RETURN v_created_at;
  END IF;

  RETURN NULL;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.gov01_authenticated_mutation_rpc_violations()
RETURNS TABLE(proname name, signature text, detail text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT p.proname,
         p.oid::regprocedure::text,
         CASE
           WHEN pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
             OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
             THEN 'membership write gate'
           WHEN pg_get_functiondef(p.oid) ~ 'storage_member_using\('
             THEN 'storage_member_using write gate'
           ELSE '1-arg membership in mutator'
         END
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   -- Explicit quarantine (issue #167): record_recent_view and
  -- set_record_favourite are authenticated-executable BY DESIGN — they write
  -- only the caller's own rows (user_id = current_user_id) behind a
  -- membership check, with no shared-state mutation. A writer/capability
  -- gate would break per-user recents/favourites for ordinary members, so
  -- the inventory exempts exactly these two instead of demanding one.
  WHERE n.nspname = 'api'
     AND p.proname NOT IN ('record_recent_view', 'set_record_favourite')
     AND p.prokind = 'f'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_get_functiondef(p.oid) ~* 'INSERT[[:space:]]+INTO|UPDATE[[:space:]]+"api"|UPDATE[[:space:]]+api\.|DELETE[[:space:]]+FROM'
     AND (
       pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
       OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
       OR (
         pg_get_functiondef(p.oid) ~ 'storage_member_using\('
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
       OR (
         pg_get_functiondef(p.oid) ~ 'is_workspace_member\([A-Za-z0-9_."]+\)'
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
     )
$$;
--> statement-breakpoint
