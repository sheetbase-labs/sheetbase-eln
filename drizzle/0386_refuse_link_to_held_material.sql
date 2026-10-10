-- LAB-04.2 — a usage record link cannot point at a lot that is held or expired.
--
-- The materials block refuses a quarantined or expired lot (drizzle/0376, 0385).
-- The other way an experiment cites a material is a record link: the registry's
-- Used in list is exactly the `link_type = 'reagent'` links. That path checked the
-- target's workspace but not its status, so a sheet or experiment could still
-- record a held lot as used. Other link types are untouched: linking a report or a
-- file to a held lot is legitimate.
--
-- The function is patched from its current definition, so anything else in it stays.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'api' AND p.proname = 'create_record_link';

  anchor := E'    IF v_target_ws <> "api"."current_workspace_id"() THEN\n'
    || E'      RAISE EXCEPTION ''record link crosses workspaces'' USING ERRCODE = ''SB002'';\n'
    || E'    END IF;';

  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_record_link anchor missing; refusing to patch blindly';
  END IF;
  IF strpos(definition, 'SB124') > 0 THEN
    RETURN;  -- already patched
  END IF;

  guard := anchor || E'\n\n'
    || E'    -- LAB-04.2: a reagent usage link records a material as used.\n'
    || E'    IF p_link_type = ''reagent'' THEN\n'
    || E'      IF EXISTS (SELECT 1 FROM api.records r\n'
    || E'                  WHERE r.id = p_target_record_id AND r.status = ''quarantined'') THEN\n'
    || E'        RAISE EXCEPTION ''material % is quarantined and cannot be referenced'', p_target_identifier\n'
    || E'          USING ERRCODE = ''SB120'';\n'
    || E'      END IF;\n'
    || E'      IF EXISTS (SELECT 1 FROM api.records r\n'
    || E'                  WHERE r.id = p_target_record_id AND r.status = ''expired'') THEN\n'
    || E'        RAISE EXCEPTION ''material % has expired and cannot be referenced'', p_target_identifier\n'
    || E'          USING ERRCODE = ''SB124'';\n'
    || E'      END IF;\n'
    || E'    END IF;';

  definition := replace(definition, anchor, guard);
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
