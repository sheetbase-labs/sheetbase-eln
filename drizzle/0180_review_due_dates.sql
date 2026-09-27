-- WORK-01.1 — review due dates.
--
-- A submission's due date is set from the project's default review period
-- (falling back to 7 days) when the insert omits one; an explicit due_at is
-- kept as the override. The Inbox work-items view exposes it.

CREATE OR REPLACE FUNCTION internal.set_review_submission_due()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.due_at IS NULL THEN
    SELECT p.default_review_period_days INTO v_days
      FROM api.records r
      JOIN api.projects p ON p.id = r.project_id
      WHERE r.id = NEW.record_id;
    NEW.due_at := NEW.submitted_at + make_interval(days => coalesce(v_days, 7));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER set_review_submission_due
BEFORE INSERT ON api.review_submissions
FOR EACH ROW EXECUTE FUNCTION internal.set_review_submission_due();
--> statement-breakpoint

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
  rs.due_at AS due_at,
  CASE
    WHEN rs.due_at IS NOT NULL AND rs.due_at < now() THEN 'overdue'
    ELSE 'needs_action'
  END::text AS state,
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
