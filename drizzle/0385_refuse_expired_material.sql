-- LAB-04.2 — a lot past its expiry cannot be referenced as used.
--
-- drizzle/0376 stopped a quarantined lot being recorded as used; the same rule
-- covers expiry, which is the other half of "refusing references to expired or
-- quarantined lots from experiments". The status is what the lifecycle guard
-- sets, so this reads the target's status rather than recomputing the date.
--
-- The guard is patched from the function's current definition, so the quarantine
-- check and anything else already in it stay in place.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = 'validate_scientific_block';

  anchor := E'        IF target.status = ''quarantined'' THEN';

  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'quarantine guard missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'SB124') > 0 THEN
    RETURN;  -- already patched
  END IF;

  guard := E'        IF target.status = ''expired'' THEN\n'
    || E'          RAISE EXCEPTION ''material % has expired and cannot be referenced'', target.identifier\n'
    || E'            USING ERRCODE = ''SB124'';\n'
    || E'        END IF;\n';

  definition := replace(definition, anchor, guard || anchor);
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
