-- REV-002 / WORK-01.1 — an idempotent retry is not a different submission.
--
-- The retry guard compared the caller's supplied due date against the *resolved*
-- stored due date. A caller that omits `p_due_at` (the common case) lets the
-- project/workflow default resolve it, so the stored value is non-null while
-- the supplied value is null — and every retry was rejected as "used for a
-- different submission" even though nothing differed. An explicitly supplied
-- due date is still compared; an omitted one is not.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text)'::regprocedure);

  IF strpos(definition, 'OR existing_submission.due_at IS DISTINCT FROM p_due_at THEN') = 0 THEN
    RAISE EXCEPTION 'submit_record_revision due_at anchor missing';
  END IF;

  definition := replace(
    definition,
    'OR existing_submission.due_at IS DISTINCT FROM p_due_at THEN',
    'OR (p_due_at IS NOT NULL AND existing_submission.due_at IS DISTINCT FROM p_due_at) THEN'
  );

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
