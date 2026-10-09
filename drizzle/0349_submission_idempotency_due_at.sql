-- REV-002 — the idempotency guard binds the review's due date too.
--
-- The recovered `unique_violation` branch compared the record, workflow and
-- reviewers but not `due_at`, so replaying the same idempotency key with a
-- changed due date returned the earlier submission as if it were idempotent.
-- The due date is an effective argument of the submission, so a mismatch now
-- raises the canonical "used for a different submission" outcome.
DO $$ DECLARE definition text; anchor text; applied text;
BEGIN
  definition := pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text)'::regprocedure);
  anchor := E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR existing_submission.assigned_reviewer_user_ids';
  applied := E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR existing_submission.due_at IS DISTINCT FROM p_due_at\n     OR existing_submission.assigned_reviewer_user_ids';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'submission idempotency guard anchor missing';
  END IF;
  IF strpos(definition, applied) > 0 THEN
    RETURN;
  END IF;
  definition := replace(definition, anchor,
    E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR existing_submission.due_at IS DISTINCT FROM p_due_at\n     OR existing_submission.assigned_reviewer_user_ids');
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
