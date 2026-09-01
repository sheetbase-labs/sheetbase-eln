-- AUTH-003: make api.claim_probe defensive. Missing, empty or malformed
-- request.jwt.claims must yield NULL (no workspace context), never an error
-- that leaks structure — the foundation AUTH-004 RLS policies rely on. See
-- docs/development/database-access.md.
CREATE OR REPLACE FUNCTION "api"."claim_probe"()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  raw text;
  parsed jsonb;
BEGIN
  raw := current_setting('request.jwt.claims', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    parsed := raw::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  RETURN parsed;
END;
$$;--> statement-breakpoint

-- CREATE OR REPLACE preserves existing grants; re-assert them explicitly so
-- the function stays closed to PUBLIC and open only to authenticated.
REVOKE EXECUTE ON FUNCTION "api"."claim_probe"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."claim_probe"() TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
