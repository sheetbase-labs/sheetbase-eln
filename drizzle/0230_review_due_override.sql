-- WORK-01.1 — submit-time due-date override.
--
-- The insert trigger sets a submission's due date from the project's default
-- review period. The submit wrapper gains an optional explicit due date that
-- overrides it for a fresh (non-idempotent) submission.

DROP FUNCTION IF EXISTS api.submit_record_revision(uuid, text, text, integer, text[], boolean, text);
--> statement-breakpoint

CREATE FUNCTION api.submit_record_revision(
  p_record_id uuid,
  p_expected_source_digest text,
  p_workflow_definition_key text,
  p_workflow_definition_version integer,
  p_reviewer_user_ids text[],
  p_confirmed boolean,
  p_idempotency_key text,
  p_due_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  result := api.submit_record_revision_core067(
    p_record_id,
    p_expected_source_digest,
    p_workflow_definition_key,
    p_workflow_definition_version,
    p_reviewer_user_ids,
    p_confirmed,
    p_idempotency_key
  );
  IF coalesce(result->>'idempotent','false') <> 'true' THEN
    PERFORM internal.persist_revision_sheet_evidence((result->'revision'->>'id')::uuid);
    IF p_due_at IS NOT NULL THEN
      UPDATE api.review_submissions
         SET due_at = p_due_at,
             updated_at = now()
       WHERE id = (result->'submission'->>'id')::uuid
         AND state = 'submitted';
    END IF;
  END IF;
  RETURN result;
END
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
