-- Remember "Skip for now" on the lab setup dialog per person, not per browser.
--
-- Home offers a first-run "Set up your lab" dialog until an admin finishes
-- setup. Skipping it was remembered in localStorage, so the same person saw it
-- again on every other device and after clearing site data. The skip now lives
-- in their own api.user_preferences row, under preferences.labSetupSkipped,
-- keyed by workspace. The table stays read-only to the app role: this function
-- is the only writer, it writes only the caller's row, and only for a
-- workspace the caller belongs to.

CREATE FUNCTION api.skip_lab_setup(p_workspace_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'skip_lab_setup requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;

  INSERT INTO api.user_preferences
    (user_id, appearance, nav_collapsed, preferences, created_at, updated_at)
  VALUES
    (v_user_id, 'system', false,
     jsonb_build_object('labSetupSkipped', jsonb_build_object(p_workspace_id::text, true)),
     now(), now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    preferences = coalesce(api.user_preferences.preferences, '{}'::jsonb)
      || jsonb_build_object(
           'labSetupSkipped',
           coalesce(api.user_preferences.preferences->'labSetupSkipped', '{}'::jsonb)
             || jsonb_build_object(p_workspace_id::text, true)),
    updated_at = now();
END;
$$;

ALTER FUNCTION api.skip_lab_setup(p_workspace_id uuid) OWNER TO migrator;
REVOKE ALL ON FUNCTION api.skip_lab_setup(p_workspace_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION api.skip_lab_setup(p_workspace_id uuid) TO authenticated;

-- GOV-01 keeps an inventory of authenticated mutation RPCs that are gated only
-- by membership. A person's own state (favourites, saved searches, the active
-- workspace) is exempt by name; skip_lab_setup joins that list. The rest of the
-- inventory function is unchanged.
CREATE OR REPLACE FUNCTION internal.gov01_authenticated_mutation_rpc_violations()
 RETURNS TABLE(proname name, signature text, detail text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
       'set_active_workspace', 'certify_signature',
       'withdraw_signature_certification', 'mark_work_items_seen',
       -- A person's own saved searches, like favourites, are theirs to keep
       -- whatever their role; sharing one checks the role inside the function.
       'save_search', 'update_saved_search', 'delete_saved_search',
       'touch_saved_search',
       -- Skipping the lab setup dialog writes only the caller's own
       -- preferences row; the membership check only refuses a stranger's
       -- workspace id.
       'skip_lab_setup'
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
$function$;
