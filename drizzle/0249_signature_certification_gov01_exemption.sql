-- SIGN-003 — exempt signature certification from the GOV-01 mutation-RPC
-- inventory.
--
-- certify_signature and withdraw_signature_certification write only the
-- caller's own row (user_id = current_user_id) behind a membership check, with
-- no shared-state mutation: certifying your own electronic signature is a
-- per-user attestation, and a writer/capability gate would wrongly stop
-- ordinary members and viewers from certifying. The inventory therefore
-- exempts exactly these two alongside the other own-row writers.

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
   -- Explicit quarantine: these are authenticated-executable BY DESIGN — they
   -- write only the caller's own rows (user_id = current_user_id) behind a
   -- membership check, with no shared-state mutation. A writer/capability gate
   -- would break them for ordinary members, so the inventory exempts exactly
   -- these instead of demanding one.
  WHERE n.nspname = 'api'
     AND p.proname NOT IN (
       'record_recent_view', 'set_record_favourite', 'follow_record',
       'set_active_workspace', 'certify_signature',
       'withdraw_signature_certification'
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
