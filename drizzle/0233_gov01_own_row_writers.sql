-- GOV-01 — own-row preference writers stay member-gated; file text is a write.
--
-- set_active_workspace writes only the caller's own user_preferences row behind
-- a membership check, like favourites, recents and follow_record, so it is
-- exempt from the writer-gate inventory. api.record_file_text writes a file
-- object and requires a workspace writer.

CREATE OR REPLACE FUNCTION api.record_file_text(
  p_file_id uuid,
  p_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
    FROM api.file_objects WHERE id = p_file_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'unknown file' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the workspace' USING ERRCODE = '42501';
  END IF;
  IF p_text IS NOT NULL AND length(p_text) > 2000000 THEN
    RAISE EXCEPTION 'extracted text exceeds the limit' USING ERRCODE = '22023';
  END IF;
  UPDATE api.file_objects
     SET extracted_text = p_text,
         extracted_at = CASE WHEN p_text IS NULL THEN NULL ELSE now() END,
         updated_at = now()
   WHERE id = p_file_id;
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
  WHERE n.nspname = 'api'
     AND p.proname NOT IN (
       'record_recent_view', 'set_record_favourite', 'follow_record',
       'set_active_workspace'
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
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
