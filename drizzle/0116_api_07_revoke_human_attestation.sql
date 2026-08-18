-- API-07: human attestation stays off the credential path.
-- 0114 granted api_client EXECUTE on submit_record_revision and
-- run_revision_checks. Those RPCs require an authenticated human session
-- and must not look callable with a service credential.
-- preview_submission_digest remains granted (digest preview only).

DO $api07_revoke$
DECLARE
  names text[] := ARRAY[
    'submit_record_revision',
    'run_revision_checks'
  ];
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname = ANY (names)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM api_client', r.sig);
  END LOOP;
END
$api07_revoke$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
