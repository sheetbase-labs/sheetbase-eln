-- Experiments reviewed before the status started following the review still
-- say In progress. Bring them in line with their latest review submission, the
-- same way the trigger would have: submitted is In review, approved is
-- Approved, returned is Returned, withdrawn or rejected is In progress.
-- Locked records and experiments that have not started are left alone, and
-- updated_at is kept so existing dates do not move.

UPDATE api.records r
SET status = m.next,
    metadata_version = r.metadata_version + 1
FROM (
  SELECT DISTINCT ON (record_id) record_id,
         CASE state
           WHEN 'submitted' THEN 'in_review'
           WHEN 'approved' THEN 'approved'
           WHEN 'returned' THEN 'returned'
           ELSE 'in_progress'
         END AS next
  FROM api.review_submissions
  ORDER BY record_id, submitted_at DESC
) m
WHERE r.id = m.record_id
  AND r.kind = 'experiment'
  AND r.locked_at IS NULL
  AND r.status IN ('in_progress', 'in_review', 'returned', 'approved')
  AND r.status IS DISTINCT FROM m.next;
