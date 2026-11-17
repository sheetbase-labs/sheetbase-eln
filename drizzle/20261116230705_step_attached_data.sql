-- A plate run belongs in the step it was run for.
--
-- A result recorded against a protocol step is a block that names the step in
-- `stepBlockId`. Until now only a number (`metric`) could, so a plate run added
-- to an experiment landed at the end of the notebook and its step did not move.
-- This lets a `plate_run` block name a step too, counts it as work done on the
-- step, and adds api.add_step_plate_run: put a run in a step in one call, in
-- the right place, from the app, the assistant, the API, MCP and pipelines.
--
--   * api.record_steps counts every block that names the step, not only
--     numbers, so a step with a plate in it reads "in progress".
--   * the plate run block's guard refuses a stepBlockId that is not a protocol
--     step of the same notebook.
--   * `step_result` is sent when a plate run lands in a step, as it is for a
--     number.
--   * api.add_step_plate_run attaches the run to the step's experiment, puts its
--     block straight after the step (or after the step's last piece of data),
--     and moves a block the notebook already had for that run into the step.

-- Steps count any data placed in them ------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.record_steps(uuid)'::regprocedure) INTO v_def;
  IF position('r.type = ''metric''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.record_steps';
  END IF;
  v_def := replace(v_def, 'r.type = ''metric''', 'r.type IN (''metric'', ''plate_run'')');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- The plate run guard also checks the step ---------------------------------------
CREATE OR REPLACE FUNCTION internal.blocks_plate_run_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid;
  v_run api.plate_runs;
  v_run_id uuid;
  v_step_id uuid;
BEGIN
  IF NEW.type IS DISTINCT FROM 'plate_run' THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'a plate run block needs an object payload' USING ERRCODE = '23514';
  END IF;
  -- The pin is the database's to write, never the caller's.
  NEW.payload := NEW.payload - 'pinned';
  -- The step the run was done for, when there is one.
  IF NEW.payload ? 'stepBlockId' AND jsonb_typeof(NEW.payload -> 'stepBlockId') <> 'null' THEN
    BEGIN
      v_step_id := (NEW.payload ->> 'stepBlockId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'stepBlockId must be a protocol step id' USING ERRCODE = '23514';
    END;
    IF NOT EXISTS (SELECT 1 FROM api.blocks s
                    WHERE s.id = v_step_id AND s.record_id = NEW.record_id
                      AND s.type = 'procedure_step') THEN
      RAISE EXCEPTION 'that step is not in this notebook' USING ERRCODE = '23503';
    END IF;
  ELSE
    NEW.payload := NEW.payload - 'stepBlockId';
  END IF;
  IF NEW.payload ->> 'runId' IS NULL THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_run_id := (NEW.payload ->> 'runId')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'runId must be a plate run id' USING ERRCODE = '23514';
  END;
  SELECT workspace_id INTO v_workspace_id FROM api.records WHERE id = NEW.record_id;
  SELECT * INTO v_run FROM api.plate_runs WHERE id = v_run_id;
  IF v_run.id IS NULL OR v_run.workspace_id IS DISTINCT FROM v_workspace_id THEN
    RAISE EXCEPTION 'plate run not found in this workspace' USING ERRCODE = '23503';
  END IF;
  NEW.payload := jsonb_set(NEW.payload, '{pinned}', internal.plate_run_pin(v_run));
  RETURN NEW;
END $$;
--> statement-breakpoint

-- step_result for a plate run, as for a number ---------------------------------
CREATE OR REPLACE FUNCTION internal.trg_change_event_step_result() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_step api.blocks;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = NEW.record_id;
  SELECT * INTO v_step FROM api.blocks WHERE id = (NEW.payload->>'stepBlockId')::uuid;
  IF v_record.id IS NULL OR v_step.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'step_result', NEW.id, 'create',
    NEW.record_id, v_record.project_id,
    jsonb_build_object('change', 'result_added',
                       'blockId', v_step.id, 'recordId', NEW.record_id,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'stepNumber', v_step.payload->'stepNumber',
                       'step', left(coalesce(v_step.payload->>'text', ''), 200),
                       'resultBlockId', NEW.id,
                       'resultType', NEW.type,
                       'label', coalesce(NEW.payload->>'label', NEW.payload #>> '{pinned,name}'),
                       'plateRunId', NEW.payload->>'runId'));
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER change_event_step_result ON api.blocks;
--> statement-breakpoint
CREATE TRIGGER change_event_step_result AFTER INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type IN ('metric', 'plate_run')
    AND NEW.payload ? 'stepBlockId'
    AND (NEW.payload->>'stepBlockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  EXECUTE FUNCTION internal.trg_change_event_step_result();
--> statement-breakpoint

-- Put a plate run in a step ------------------------------------------------------
CREATE FUNCTION api.add_step_plate_run(p_block_id uuid, p_plate_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_step api.blocks;
  v_run api.plate_runs;
  v_existing api.blocks;
  v_after uuid;
  v_before uuid;
  v_structure integer;
  v_inserted jsonb;
  v_block_id uuid;
BEGIN
  SELECT * INTO v_step FROM api.blocks WHERE id = p_block_id;
  IF v_step.id IS NULL THEN
    RAISE EXCEPTION 'step not found' USING ERRCODE = '42501';
  END IF;
  IF v_step.type <> 'procedure_step' THEN
    RAISE EXCEPTION 'that block is not a protocol step' USING ERRCODE = '22023';
  END IF;

  -- The run belongs to the step's experiment (api.link_plate_run checks who may).
  v_run := api.link_plate_run(p_plate_run_id, v_step.record_id);

  -- The step's data in page order: the step, then whatever is already in it.
  SELECT b.id INTO v_after
    FROM api.blocks b
   WHERE b.record_id = v_step.record_id
     AND b.id <> p_block_id
     AND b.payload->>'stepBlockId' = p_block_id::text
   ORDER BY b."order" DESC LIMIT 1;

  SELECT * INTO v_existing FROM api.blocks
   WHERE record_id = v_step.record_id AND type = 'plate_run'
     AND payload->>'runId' = p_plate_run_id::text
   ORDER BY "order" LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    -- Already in the notebook, perhaps at the end: bring it into the step.
    IF coalesce(v_existing.payload->>'stepBlockId', '') <> p_block_id::text THEN
      PERFORM api.update_block_payload(
        v_existing.id,
        v_existing.payload || jsonb_build_object('stepBlockId', p_block_id),
        v_existing.version, 1);
      SELECT structure_version INTO v_structure FROM api.records WHERE id = v_step.record_id;
      -- The block that follows the spot, so the move sits between the two.
      SELECT b.id INTO v_before
        FROM api.blocks b
       WHERE b.record_id = v_step.record_id AND b.id <> v_existing.id
         AND b."order" > (SELECT a."order" FROM api.blocks a WHERE a.id = coalesce(v_after, p_block_id))
       ORDER BY b."order" LIMIT 1;
      PERFORM api.move_block(v_existing.id, v_structure, coalesce(v_after, p_block_id), v_before);
    END IF;
    v_block_id := v_existing.id;
  ELSE
    v_inserted := api.insert_block(
      v_step.record_id, 'plate_run',
      jsonb_build_object('runId', p_plate_run_id, 'view', 'hits', 'stepBlockId', p_block_id),
      1, coalesce(v_after, p_block_id), NULL, NULL);
    v_block_id := (v_inserted -> 'block' ->> 'id')::uuid;
  END IF;

  RETURN jsonb_build_object(
    'block_id', v_block_id,
    'step_block_id', p_block_id,
    'record_id', v_step.record_id,
    'plate_run_id', p_plate_run_id,
    'already_there', v_existing.id IS NOT NULL AND coalesce(v_existing.payload->>'stepBlockId', '') = p_block_id::text);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_step_plate_run(p_block_id uuid, p_plate_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_step_plate_run(p_block_id uuid, p_plate_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_step_plate_run(p_block_id uuid, p_plate_run_id uuid) TO authenticated;
