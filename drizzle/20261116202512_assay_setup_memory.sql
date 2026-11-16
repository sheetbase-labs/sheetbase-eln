-- Assay setup that remembers itself.
--
-- A plate assay is set up the same way every time: which columns are the
-- controls, how the wells are normalised, what counts as a hit, which curve is
-- fitted, how good a plate has to be. The plate design (the assay design the
-- plates already point at) now keeps that setup, so the next plate of the same
-- assay is read, analysed and shown with it and nothing is typed again.
--
--   * api.plate_designs.assay_setup: the remembered setup (json, null when none
--     has been saved).
--   * api.save_plate_design_assay_setup(design, setup, run): save the setup on
--     a design and, when a plate run is named, point that run at the design.
--     Sends plate_design.assay_setup_saved.

ALTER TABLE api.plate_designs ADD COLUMN assay_setup jsonb;
--> statement-breakpoint
ALTER TABLE api.plate_designs ADD CONSTRAINT chk_plate_designs_assay_setup
  CHECK (assay_setup IS NULL OR jsonb_typeof(assay_setup) = 'object');
--> statement-breakpoint

CREATE FUNCTION api.save_plate_design_assay_setup(
    p_design_id uuid,
    p_setup jsonb,
    p_plate_run_id uuid DEFAULT NULL)
RETURNS api.plate_designs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_design api.plate_designs;
  v_run api.plate_runs;
  v_setup jsonb;
BEGIN
  IF p_design_id IS NULL THEN
    RAISE EXCEPTION 'plate design not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('design', p_design_id, 'edit');
  SELECT * INTO v_design FROM api.plate_designs WHERE id = p_design_id FOR UPDATE;
  IF v_design.id IS NULL OR v_design.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'plate design not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  IF NOT api.is_workspace_writer(v_design.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_design.status = 'archived' THEN
    RAISE EXCEPTION 'cannot change an archived plate design' USING ERRCODE = 'SB004';
  END IF;

  IF jsonb_typeof(p_setup) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_setup -> 'config') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'an assay setup needs a config object' USING ERRCODE = 'SB005';
  END IF;
  IF length(p_setup::text) > 20000 THEN
    RAISE EXCEPTION 'assay setup is too large' USING ERRCODE = 'SB005';
  END IF;
  -- Only the keys the setup is made of are kept.
  v_setup := jsonb_strip_nulls(jsonb_build_object(
    'config', p_setup -> 'config',
    'negativeColumns', left(coalesce(p_setup ->> 'negativeColumns', ''), 100),
    'positiveColumns', left(coalesce(p_setup ->> 'positiveColumns', ''), 100)));

  IF p_plate_run_id IS NOT NULL THEN
    SELECT * INTO v_run FROM api.plate_runs WHERE id = p_plate_run_id FOR UPDATE;
    IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM v_design.workspace_id THEN
      RAISE EXCEPTION 'plate run not found' USING ERRCODE = 'SB015';
    END IF;
    IF v_run.project_id IS NOT NULL THEN
      PERFORM internal.assert_object_access('project', v_run.project_id, 'edit');
    END IF;
    IF v_run.status = 'archived' THEN
      RAISE EXCEPTION 'cannot change an archived plate run' USING ERRCODE = 'SB004';
    END IF;
    IF v_run.design_id IS DISTINCT FROM v_design.id THEN
      UPDATE api.plate_runs SET
          design_id = v_design.id,
          metadata_version = metadata_version + 1, updated_at = now()
        WHERE id = v_run.id;
    END IF;
  END IF;

  UPDATE api.plate_designs SET
      assay_setup = v_setup,
      metadata_version = metadata_version + 1,
      updated_at = now(),
      updated_by_user_id = api.current_user_id()
    WHERE id = v_design.id
    RETURNING * INTO v_design;

  PERFORM internal.emit_change_event(v_design.workspace_id, 'plate_design', v_design.id, 'update',
    NULL, v_design.project_id,
    jsonb_build_object('change', 'assay_setup_saved',
                       'plateDesignId', v_design.id,
                       'name', v_design.name,
                       'plateRunId', p_plate_run_id,
                       'normalisation', v_setup #>> '{config,normalisation}',
                       'curveModel', v_setup #>> '{config,curveModel}'));
  RETURN v_design;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_plate_design_assay_setup(p_design_id uuid, p_setup jsonb, p_plate_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_plate_design_assay_setup(p_design_id uuid, p_setup jsonb, p_plate_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_plate_design_assay_setup(p_design_id uuid, p_setup jsonb, p_plate_run_id uuid) TO authenticated;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('plate_design.assay_setup_saved')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A pipeline may start on the event, so the trigger picker's list and the
-- database agree (tests/db/pipeline-trigger-events.test.ts).
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('plate_design.assay_setup_saved')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
