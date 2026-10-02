-- RM-116 follow-up: restore the Inbox's "your items" contract and register the
-- new own-row mutation RPC.
--
-- The Inbox shows the caller's assigned reviews, their failed pipeline runs and
-- their own data issues and expiring materials — not the whole workspace. The
-- earlier 0269/0270 broadening leaked another person's run, which the WORK-01
-- contract test caught.
CREATE OR REPLACE VIEW api.my_work_items
WITH (security_invoker = true)
AS
SELECT
  'review_requested'::text AS kind,
  r.id AS record_id,
  r.identifier AS identifier,
  r.title AS title,
  r.project_id AS project_id,
  'Review requested'::text AS reason,
  NULL::timestamptz AS due_at,
  'needs_action'::text AS state,
  rs.submitted_at AS created_at
FROM api.review_submissions rs
JOIN api.records r ON r.id = rs.record_id
WHERE rs.state = 'submitted'
  AND api.current_user_id() = ANY (rs.assigned_reviewer_user_ids)

UNION ALL

SELECT
  'run_failed'::text,
  NULL::uuid,
  pd.key,
  pd.name,
  NULL::uuid,
  coalesce(pr.error_message, 'Pipeline run failed'),
  NULL::timestamptz,
  'needs_action'::text,
  pr.finished_at
FROM api.pipeline_runs pr
JOIN api.pipeline_definition_versions pdv ON pdv.id = pr.definition_version_id
JOIN api.pipeline_definitions pd ON pd.id = pdv.definition_id
WHERE pr.status = 'failed'
  AND pd.created_by_user_id = api.current_user_id()

UNION ALL

SELECT
  'data_issue'::text,
  NULL::uuid,
  d.display_id,
  d.name,
  d.primary_project_id,
  'Flagged: ' || f.reason,
  NULL::timestamptz,
  'needs_action'::text,
  f.set_at
FROM api.dataset_value_flags f
JOIN api.datasets d ON d.id = f.dataset_id
WHERE f.cleared_at IS NULL
  AND d.created_by_user_id = api.current_user_id()

UNION ALL

SELECT
  'material_expiring'::text,
  r.id,
  r.identifier,
  r.title,
  r.project_id,
  'Expires ' || (r.properties ->> 'expiry'),
  (r.properties ->> 'expiry')::timestamptz,
  'needs_action'::text,
  r.created_at
FROM api.records r
WHERE r.kind = 'reagent'
  AND r.deleted_at IS NULL
  AND r.archived_at IS NULL
  AND r.created_by_user_id = api.current_user_id()
  AND r.properties ? 'expiry'
  AND (r.properties ->> 'expiry')::date <= (now() + interval '30 days')::date
  AND coalesce(r.properties ->> 'status', '') <> 'quarantined'

UNION ALL

SELECT
  'following'::text,
  r.id,
  r.identifier,
  r.title,
  r.project_id,
  'Following'::text,
  NULL::timestamptz,
  'following'::text,
  wf.created_at
FROM api.work_item_follows wf
JOIN api.records r ON r.id = wf.record_id
WHERE wf.user_id = api.current_user_id()
  AND NOT EXISTS (
    SELECT 1 FROM api.review_submissions rs
    WHERE rs.record_id = wf.record_id
      AND rs.state = 'submitted'
      AND api.current_user_id() = ANY (rs.assigned_reviewer_user_ids)
  );
--> statement-breakpoint
REVOKE ALL ON api.my_work_items FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.my_work_items TO authenticated;
--> statement-breakpoint
-- mark_work_items_seen writes only the caller's own rows behind a membership
-- check, so it joins the own-row-writer exemption alongside certify_signature.
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
       'set_active_workspace', 'certify_signature',
       'withdraw_signature_certification', 'mark_work_items_seen'
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
