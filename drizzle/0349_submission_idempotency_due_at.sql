-- REV-002 — the idempotency guard binds an explicitly supplied due date.
--
-- 0340 taught the guard that an *omitted* due date is not a difference (the
-- project/workflow default resolves it, so the stored value is non-null while
-- the supplied value is null). The restored race-recovery handler in 0342 was
-- built from the pre-0340 body and dropped the comparison altogether, so
-- replaying a key with a changed due date looked idempotent. The conditional
-- comparison is restored: an explicit due date must match, an omitted one is
-- not compared.
DO $$ DECLARE definition text; anchor text; applied text;
BEGIN
  definition := pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text)'::regprocedure);
  anchor := E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR existing_submission.assigned_reviewer_user_ids';
  applied := E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR (p_due_at IS NOT NULL AND existing_submission.due_at IS DISTINCT FROM p_due_at)\n     OR existing_submission.assigned_reviewer_user_ids';
  IF strpos(definition, anchor) = 0 THEN
    IF strpos(definition, applied) > 0 THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'submission idempotency guard anchor missing';
  END IF;
  definition := replace(definition, anchor,
    E'     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR (p_due_at IS NOT NULL AND existing_submission.due_at IS DISTINCT FROM p_due_at)\n     OR existing_submission.assigned_reviewer_user_ids');
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
