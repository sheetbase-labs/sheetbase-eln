-- WORK-01.2 — the caller's Inbox work items.
--
-- A security-invoker view, so every underlying table's RLS applies as the
-- caller (records, review_submissions, pipeline runs, follows). It unions the
-- sources that exist today: reviews assigned to the caller, failed runs of
-- pipelines the caller created, and records the caller follows that have no
-- open review of their own. Data-issue and expiring-material kinds arrive with
-- their owning tasks (DSET-01, LAB). `due_at` is filled by WORK-01.1.

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
NOTIFY pgrst, 'reload schema';
