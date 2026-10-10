-- LAB-06.3 — booking an instrument checks qualification and calibration.
--
-- A calendar resource that names an instrument in its metadata represents that
-- instrument, so the booking path refuses a booker who is not currently
-- qualified (LAB-06.2) and an instrument whose latest calibration is overdue.
-- The checks read the same predicate and calibration table the instrument page
-- shows, so the rule cannot drift from the UI.
DO $$ DECLARE definition text; anchor text; guard text;
BEGIN
  definition := pg_get_functiondef('api.create_booking(uuid,uuid,text,timestamptz,timestamptz,text,text,boolean,text,text,text,uuid,uuid,jsonb,jsonb)'::regprocedure);

  anchor := E'  IF v_resource.status = ''inactive'' THEN\n    RAISE EXCEPTION ''resource is inactive and cannot be booked'' USING ERRCODE = ''SB005'';\n  END IF;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_booking resource guard anchor missing';
  END IF;

  guard := anchor || E'\n'
    || E'  -- LAB-06.3: an instrument resource needs a qualified booker and current\n'
    || E'  -- calibration before it can be booked.\n'
    || E'  IF v_resource.metadata ? ''instrumentId'' THEN\n'
    || E'    SELECT * INTO v_instrument FROM api.instruments\n'
    || E'     WHERE id = nullif(v_resource.metadata->>''instrumentId'', '''')::uuid\n'
    || E'       AND workspace_id = v_ws_id;\n'
    || E'    IF v_instrument.id IS NULL THEN\n'
    || E'      RAISE EXCEPTION ''instrument not found in active workspace'' USING ERRCODE = ''SB021'';\n'
    || E'    END IF;\n'
    || E'    IF NOT internal.instrument_qualified(v_instrument.id, api.current_user_id()) THEN\n'
    || E'      RAISE EXCEPTION ''a current qualification is required to book this instrument'' USING ERRCODE = ''SB115'';\n'
    || E'    END IF;\n'
    || E'    IF EXISTS (SELECT 1 FROM api.instrument_calibrations c\n'
    || E'                WHERE c.instrument_id = v_instrument.id\n'
    || E'                  AND c.due_at IS NOT NULL AND c.due_at < now()) THEN\n'
    || E'      RAISE EXCEPTION ''the instrument calibration is overdue'' USING ERRCODE = ''SB116'';\n'
    || E'    END IF;\n'
    || E'  END IF;';

  definition := replace(definition, anchor, guard);

  -- The guard needs the instrument row in scope.
  anchor := E'  v_sample_rec "api"."records";';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_booking declaration anchor missing';
  END IF;
  definition := replace(definition, anchor, E'  v_sample_rec "api"."records";\n  v_instrument api.instruments;');

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
