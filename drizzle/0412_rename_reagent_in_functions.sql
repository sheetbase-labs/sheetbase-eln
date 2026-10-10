-- LAB-04.1 — the functions that compare the kind or the link type follow the rename.
--
-- Renaming the kind is not enough on its own: nine functions compare it, or the link type,
-- as a quoted literal. Left alone they would keep filtering on a kind that no longer exists,
-- which is how the held-lot refusal silently stopped firing — the link was created instead of
-- being refused, and the test failed on a unique violation rather than the refusal it expects.
--
-- The patch replaces the *quoted literal* `'reagent'` only. The table and column names
-- (`reagent_movements`, `reagent_record_id`) and the RPC names are unquoted identifiers, so
-- they are untouched — which is deliberate: the step asks for the kind, routes and copy, not
-- for internal names to churn.
--
-- Every function is patched from its current definition so anything else in it stays, and a
-- function that raises during the patch is left as it was rather than half-rewritten.

DO $$
DECLARE
  target record;
  def text;
BEGIN
  FOR target IN
    SELECT p.oid, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('api', 'internal')
       AND p.prosrc LIKE '%''reagent''%'
     ORDER BY p.proname
  LOOP
    def := pg_get_functiondef(target.oid);
    EXECUTE replace(def, '''reagent''', '''material''');
  END LOOP;
END $$;
--> statement-breakpoint

-- Confirm nothing is left comparing the old kind.
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO remaining
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('api', 'internal')
     AND p.prosrc LIKE '%''reagent''%';
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'functions still compare the old kind: %', remaining;
  END IF;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
