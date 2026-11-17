-- Plates read by a standard curve, and results that reach their samples.
--
--   * A well can be a `standard`: a known concentration the plate's curve is
--     fitted to. The four places that list the roles a well may have learn it:
--     a plate design's wells, a plate run's wells, the plate map block and the
--     check on plate design wells.
--   * A sample measurement remembers the plate run that wrote it, so a run can
--     be published again (its earlier numbers are replaced, nobody else's are
--     touched) and a measurement can say where it came from.
--   * api.publish_plate_run_measurements writes what a quantified run read for
--     each sample to that sample, so a titre shows on the sample page.

-- A well may be a standard ---------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'api.save_plate_design(uuid,jsonb,jsonb,integer)',
    'api.validate_scientific_block()',
    'internal.check_plate_run_wells(jsonb,integer,integer,uuid)'
  ] LOOP
    SELECT pg_get_functiondef(v_fn::regprocedure) INTO v_def;
    IF position('''blank'',''empty''' IN v_def) = 0 AND position('''blank'', ''empty''' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for %', v_fn;
    END IF;
    IF position('''standard''' IN v_def) = 0 THEN
      v_def := replace(v_def, '''blank'',''empty''', '''blank'',''standard'',''empty''');
      v_def := replace(v_def, '''blank'', ''empty''', '''blank'', ''standard'', ''empty''');
      EXECUTE v_def;
    END IF;
  END LOOP;

  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.plate_wells'::regclass AND conname = 'chk_plate_wells_role';
  IF v_def IS NULL OR position('''blank''::text, ''empty''::text' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_plate_wells_role';
  END IF;
  IF position('''standard''' IN v_def) = 0 THEN
    v_def := replace(v_def, '''blank''::text, ''empty''::text', '''blank''::text, ''standard''::text, ''empty''::text');
    EXECUTE 'ALTER TABLE api.plate_wells DROP CONSTRAINT chk_plate_wells_role';
    EXECUTE 'ALTER TABLE api.plate_wells ADD CONSTRAINT chk_plate_wells_role ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

-- Which plate run wrote a measurement ------------------------------------------------
ALTER TABLE api.sample_measurements
  ADD COLUMN plate_run_id uuid REFERENCES api.plate_runs(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_sample_measurements_plate_run
  ON api.sample_measurements (plate_run_id) WHERE plate_run_id IS NOT NULL;
--> statement-breakpoint

-- Give a plate run's results to its samples -------------------------------------------
CREATE FUNCTION api.publish_plate_run_measurements(p_plate_run_id uuid, p_name text DEFAULT NULL)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.plate_runs;
  v_name text;
  v_unit text;
  v_item jsonb;
  v_sample uuid;
  v_value numeric;
  v_dilution numeric;
  v_published integer := 0;
  v_skipped integer := 0;
  v_reference text;
BEGIN
  SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_run.workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_run.project_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('project', v_run.project_id, 'edit');
  END IF;
  IF v_run.results IS NULL OR jsonb_typeof(v_run.results #> '{quantify,samples}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'this plate run has not been read by a standard curve' USING ERRCODE = 'SB005';
  END IF;

  v_reference := 'PLR-' || lpad(v_run.number::text, 4, '0');
  v_unit := nullif(btrim(coalesce(v_run.results #>> '{quantify,curve,unit}', '')), '');
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    SELECT d.name INTO v_name FROM api.plate_designs d WHERE d.id = v_run.design_id;
  END IF;
  v_name := left(coalesce(v_name, v_run.name), 200);

  -- What this run wrote before is replaced, so reading the plate again never
  -- leaves two answers for one sample.
  DELETE FROM api.sample_measurements WHERE plate_run_id = v_run.id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_run.results #> '{quantify,samples}') LOOP
    BEGIN
      v_sample := nullif(v_item ->> 'sampleId', '')::uuid;
      v_value := nullif(v_item ->> 'result', '')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      v_sample := NULL;
      v_value := NULL;
    END;
    IF v_sample IS NULL OR v_value IS NULL OR coalesce(v_item ->> 'status', '') <> 'ok'
       OR NOT EXISTS (SELECT 1 FROM api.records r
                       WHERE r.id = v_sample AND r.kind = 'sample' AND r.deleted_at IS NULL
                         AND r.workspace_id = v_run.workspace_id) THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    PERFORM internal.assert_object_access('record', v_sample, 'edit');
    v_dilution := coalesce(nullif(v_item ->> 'dilution', '')::numeric, 1);
    INSERT INTO api.sample_measurements (
      workspace_id, sample_record_id, name, value, unit, method, measured_at,
      notes, created_by_user_id, plate_run_id
    ) VALUES (
      v_run.workspace_id, v_sample, v_name, v_value, v_unit,
      v_reference || ' · standard curve',
      coalesce(v_run.analysed_at, now()),
      CASE WHEN v_dilution <> 1
           THEN 'Read off the standard curve, diluted ' || trim(trailing '.' from trim(trailing '0' from v_dilution::text)) || '-fold, mean of ' || coalesce(v_item ->> 'n', '1') || ' well(s).'
           ELSE 'Read off the standard curve, mean of ' || coalesce(v_item ->> 'n', '1') || ' well(s).' END,
      api.current_user_id(), v_run.id);
    v_published := v_published + 1;
  END LOOP;

  PERFORM internal.emit_change_event(v_run.workspace_id, 'plate_run', v_run.id, 'update',
    v_run.record_id, v_run.project_id,
    jsonb_build_object('change', 'measurements_published',
                       'plateRunId', v_run.id,
                       'reference', v_reference,
                       'name', v_run.name,
                       'recordId', v_run.record_id,
                       'published', v_published,
                       'skipped', v_skipped));

  RETURN jsonb_build_object('published', v_published, 'skipped', v_skipped);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.publish_plate_run_measurements(p_plate_run_id uuid, p_name text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.publish_plate_run_measurements(p_plate_run_id uuid, p_name text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.publish_plate_run_measurements(p_plate_run_id uuid, p_name text) TO authenticated;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES ('plate_run.measurements_published')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_trigger_events (name) VALUES ('plate_run.measurements_published')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('add_step_plate_run', $json${"operation": "add_step_plate_run", "rpc": "add_step_plate_run", "label": "Put a plate run in a protocol step", "description": "Puts a plate run in the protocol step it was run for. The run joins the step’s experiment, its plate run block goes straight after the step (or after the step’s last piece of data), and the step reads in progress. A block the notebook already had for the run is moved into the step. Finish the step with `set_step_done` once its last plate is in. Returns `{ block_id, step_block_id, record_id, plate_run_id, already_there }`. Sends `step_result` with `resultType` `plate_run`.", "arguments": [{"name": "p_block_id", "type": "uuid", "required": true, "nullable": false}, {"name": "p_plate_run_id", "type": "uuid", "required": true, "nullable": false}]}$json$::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('publish_plate_run_measurements', $json${"operation": "publish_plate_run_measurements", "rpc": "publish_plate_run_measurements", "label": "Give a plate run’s results to its samples", "description": "Writes what a quantified plate run read for each sample (its concentration, dilution already applied) to that sample as a measurement, so the result shows on the sample page. Only samples that read inside the standard curve get one. Running it again replaces the measurements this run wrote earlier; measurements from anywhere else are left alone. Returns `{ published, skipped }`. Sends `plate_run.measurements_published`.", "arguments": [{"name": "p_plate_run_id", "type": "uuid", "required": true, "nullable": false}, {"name": "p_name", "type": "text", "required": false, "nullable": true}]}$json$::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
