-- AUTH-003: diagnostic probe proving JWT claims reach PostgreSQL session
-- settings (request.jwt.claims). Used by contract tests and by RLS work in
-- AUTH-004. Authenticated callers only ever see their own claims.
CREATE OR REPLACE FUNCTION "api"."claim_probe"()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::jsonb
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."claim_probe"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."claim_probe"() TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';