-- LAB-04 — a quarantined material cannot be referenced as used.
--
-- The materials block validated the target's kind, identifier and title but not
-- its status, so an experiment could record usage of a quarantined sample or
-- reagent. Quarantine is the QC gate that stops a lot being used, so the block
-- refuses it; the expiry-driven state is LAB-02's hold transition.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  definition := pg_get_functiondef('api.validate_scientific_block()'::regprocedure);

  anchor := E'          RAISE EXCEPTION ''invalid material target'' USING ERRCODE=''23514''; END IF;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'materials target guard anchor missing';
  END IF;
  guard := E'\n        IF target.status = ''quarantined'' THEN\n'
    || E'          RAISE EXCEPTION ''material % is quarantined and cannot be referenced'', target.identifier\n'
    || E'            USING ERRCODE = ''SB120'';\n'
    || E'        END IF;';
  definition := replace(definition, anchor, anchor || guard);

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
