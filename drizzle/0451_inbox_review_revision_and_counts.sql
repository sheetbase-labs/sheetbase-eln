-- Phase 4 — review items open the review, and the Reviews count includes the
-- new review kinds.
--
-- 1. A `review_requested` item carried no revision, so the Inbox could only open
--    the live record. The review lives at /review/$revisionId; the item now
--    names the revision under review (the record's open submission), the same
--    way a witness request names its frozen revision.
-- 2. `api.inbox_needs_action_counts().reviews` counts the kinds the Inbox's
--    Reviews filter shows. A returned review, an unsigned approval and a
--    witness signature belong to that filter (src/lib/work-items/predicate.ts),
--    so the count states them too and Home's "to review" chip cannot disagree
--    with the list it opens.

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.kind,old.record_id,old.identifier,old.title,old.project_id,old.reason,
      old.due_at,old.state,old.created_at,old.source_type,old.source_id,
      old.parser_version_id,old.connector_id,
      CASE WHEN old.kind=''review_requested'' AND old.revision_id IS NULL THEN
        (SELECT rs.revision_id FROM api.review_submissions rs
          WHERE rs.record_id=old.record_id AND rs.state=''submitted''
            AND api.current_user_id()=ANY(rs.assigned_reviewer_user_ids)
          ORDER BY rs.submitted_at DESC LIMIT 1)
        ELSE old.revision_id END AS revision_id
    FROM ('||previous||') old';
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.inbox_needs_action_counts()
RETURNS TABLE (total integer, reviews integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH unseen AS (
    SELECT i.kind
      FROM api.my_work_items i
     WHERE i.state = ANY (ARRAY['needs_action', 'overdue']::text[])
       AND NOT EXISTS (
         SELECT 1
           FROM api.work_item_views v
          WHERE v.item_key = i.kind || ':' ||
                coalesce(i.source_id::text, i.record_id::text, i.identifier,
                         i.title, 'Untitled')
            AND v.user_id = api.current_user_id()
            AND v.workspace_id = api.current_workspace_id()
       )
  )
  SELECT count(*)::int AS total,
         count(*) FILTER (
           WHERE kind IN ('review_requested', 'witness_requested',
                          'review_returned', 'approval_unsigned',
                          'witness_signed')
         )::int AS reviews
    FROM unseen
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
