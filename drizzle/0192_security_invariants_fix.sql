-- PLAT-03 — restore the database security invariants.
--
-- 1. The user-preference RPCs were created with a non-empty search_path. Pin
--    it empty; every reference is already schema-qualified.
-- 2. The new internal-only tables carry RLS with no policies (no grant to any
--    request role), matching every other api table.

ALTER TABLE api.dataset_version_keeps ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.dataset_version_prunes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_user_preference(
  p_appearance text,
  p_nav_collapsed boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_user_preference requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_appearance NOT IN ('system', 'light', 'dark') THEN
    RAISE EXCEPTION 'unknown appearance value' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.user_preferences
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
REVOKE EXECUTE ON FUNCTION api.set_user_preference(text, boolean) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_user_preference(text, boolean) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_user_appearance(p_appearance text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_user_appearance requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_appearance NOT IN ('system', 'light', 'dark') THEN
    RAISE EXCEPTION 'unknown appearance value' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.user_preferences
    (user_id, appearance, nav_collapsed, preferences, created_at, updated_at)
  VALUES
    (v_user_id, p_appearance, false, '{}'::jsonb, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET appearance = EXCLUDED.appearance, updated_at = now();
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.set_user_appearance(text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_user_appearance(text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_active_workspace(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_active_workspace requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of that workspace' USING ERRCODE = '42501';
  END IF;

  INSERT INTO api.user_preferences
    (user_id, active_workspace_id, created_at, updated_at)
  VALUES
    (v_user_id, p_workspace_id, now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET active_workspace_id = EXCLUDED.active_workspace_id, updated_at = now();
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.set_active_workspace(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_active_workspace(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';

--> statement-breakpoint

-- follow_record is authenticated-executable by design, like favourites and
-- recents: it writes only the caller's own row (user_id = current_user_id)
-- behind a membership check, so a writer/capability gate would wrongly stop
-- ordinary members following a record. Exempt it from the mutation inventory.
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
  WHERE n.nspname = 'api'
     AND p.proname NOT IN ('record_recent_view', 'set_record_favourite', 'follow_record')
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

-- Archiving/restoring a dataset mutates shared state, so it requires a
-- workspace writer (previously only a membership check).
CREATE OR REPLACE FUNCTION api.archive_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_writer(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'active' THEN RAISE EXCEPTION 'Dataset is already archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'archived', archived_at = now(), revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.restore_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_writer(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'archived' THEN RAISE EXCEPTION 'Dataset is not archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'active', archived_at = NULL, revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;
--> statement-breakpoint

-- set_active_workspace and the appearance RPCs write only the caller's own
-- user_preferences row behind a membership check, like favourites/recents.
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
  WHERE n.nspname = 'api'
     AND p.proname NOT IN (
       'record_recent_view', 'set_record_favourite', 'follow_record',
       'set_active_workspace', 'set_user_preference', 'set_user_appearance'
     )
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
