-- The current step of an experiment: what the notebook's "Now" card shows and
-- what the assistant, the API, webhooks and pipelines can do with a step.
--
-- A protocol step is a notebook block of type procedure_step, copied into the
-- experiment when its protocol is pinned. Until now the only way to finish one
-- was to edit its block, and only the page did that. This migration:
--
--   * adds api.set_step_done (finish or reopen a step, with a note),
--     api.add_step_result (record a measurement against a step) and
--     api.record_steps (every step with its status taken from the evidence);
--   * puts step.completed, step.reopened and step.result_added on the change feed
--     so webhooks, the live feed and pipeline triggers see them;
--   * lets a pipeline run the two writes.
--
-- Status comes from the evidence on the page, never from a separate flag:
-- done when the step is ticked; in progress when it is not ticked but has a
-- note, a result recorded against it, or a running timer; otherwise not started.
-- The current step is the first one that is not done.

-- New kind of thing on the change feed.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''step_completion''::text, ''step_result''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('step.completed'), ('step.reopened'), ('step.result_added');
--> statement-breakpoint

-- A step is finished or reopened.
CREATE FUNCTION internal.trg_change_event_step() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_is boolean := coalesce(NEW.payload->>'completed', 'false') = 'true';
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = NEW.record_id;
  IF v_record.id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'step_completion', NEW.id,
    CASE WHEN v_is THEN 'create' ELSE 'delete' END,
    NEW.record_id, v_record.project_id,
    jsonb_build_object('change', CASE WHEN v_is THEN 'completed' ELSE 'reopened' END,
                       'blockId', NEW.id, 'recordId', NEW.record_id,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'stepNumber', NEW.payload->'stepNumber',
                       'step', left(coalesce(NEW.payload->>'text', ''), 200),
                       'completedByUserId', NEW.payload->>'completedByUserId'));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_step() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_step AFTER UPDATE OF payload ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'procedure_step'
    AND coalesce(OLD.payload->>'completed', 'false') IS DISTINCT FROM coalesce(NEW.payload->>'completed', 'false'))
  EXECUTE FUNCTION internal.trg_change_event_step();
--> statement-breakpoint

-- A result is recorded against a step.
CREATE FUNCTION internal.trg_change_event_step_result() RETURNS trigger
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
                       'resultBlockId', NEW.id, 'label', NEW.payload->>'label'));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_step_result() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_step_result AFTER INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'metric'
    AND NEW.payload ? 'stepBlockId'
    AND (NEW.payload->>'stepBlockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  EXECUTE FUNCTION internal.trg_change_event_step_result();
--> statement-breakpoint

-- Finish a step, or reopen it, optionally with a note. Runs as the caller, so
-- the same permissions and the same lock on submitted notebooks apply as when a
-- person ticks the step on the page.
CREATE FUNCTION api.set_step_done(p_block_id uuid, p_done boolean DEFAULT true, p_note text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_block api.blocks;
BEGIN
  SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'step not found' USING ERRCODE = '42501';
  END IF;
  IF v_block.type <> 'procedure_step' THEN
    RAISE EXCEPTION 'that block is not a protocol step' USING ERRCODE = '22023';
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 2000 THEN
    RAISE EXCEPTION 'a step note can be up to 2000 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE api.blocks
     SET payload = v_block.payload
                   || jsonb_build_object('completed', coalesce(p_done, true))
                   || CASE WHEN p_note IS NOT NULL THEN jsonb_build_object('note', btrim(p_note)) ELSE '{}'::jsonb END,
         version = v_block.version + 1,
         updated_by_user_id = api.current_user_id()
   WHERE id = p_block_id
  RETURNING * INTO v_block;
  RETURN jsonb_build_object(
    'block_id', v_block.id, 'record_id', v_block.record_id, 'version', v_block.version,
    'step_number', v_block.payload->'stepNumber', 'text', v_block.payload->>'text',
    'done', coalesce(v_block.payload->>'completed', 'false') = 'true',
    'completed_at', v_block.payload->>'completedAt',
    'completed_by_user_id', v_block.payload->>'completedByUserId',
    'note', v_block.payload->>'note');
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_step_done(p_block_id uuid, p_done boolean, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_step_done(p_block_id uuid, p_done boolean, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_step_done(p_block_id uuid, p_done boolean, p_note text) TO authenticated;
--> statement-breakpoint

-- Record a measurement against a step. It lands in the notebook as a number
-- block straight after the step (or after the step's last result), so it reads
-- in order and travels with the record into review.
CREATE FUNCTION api.add_step_result(p_block_id uuid, p_label text, p_value text, p_unit text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_step api.blocks;
  v_after uuid;
  v_label text := btrim(coalesce(p_label, ''));
  v_value text := btrim(coalesce(p_value, ''));
  v_payload jsonb;
BEGIN
  SELECT * INTO v_step FROM api.blocks WHERE id = p_block_id;
  IF v_step.id IS NULL THEN
    RAISE EXCEPTION 'step not found' USING ERRCODE = '42501';
  END IF;
  IF v_step.type <> 'procedure_step' THEN
    RAISE EXCEPTION 'that block is not a protocol step' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_label) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'give the result a name of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_value) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'give the result a value of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  SELECT b.id INTO v_after
    FROM api.blocks b
   WHERE b.record_id = v_step.record_id AND b.type = 'metric'
     AND b.payload->>'stepBlockId' = p_block_id::text
   ORDER BY b."order" DESC LIMIT 1;
  v_payload := jsonb_build_object(
    'label', v_label,
    'value', CASE WHEN v_value ~ '^-?[0-9]+(\.[0-9]+)?$' THEN to_jsonb(v_value::numeric) ELSE to_jsonb(v_value) END,
    'stepBlockId', p_block_id);
  IF nullif(btrim(coalesce(p_unit, '')), '') IS NOT NULL THEN
    v_payload := v_payload || jsonb_build_object('unit', btrim(p_unit));
  END IF;
  RETURN api.insert_block(v_step.record_id, 'metric', v_payload, 1, coalesce(v_after, p_block_id), NULL, NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_step_result(p_block_id uuid, p_label text, p_value text, p_unit text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_step_result(p_block_id uuid, p_label text, p_value text, p_unit text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_step_result(p_block_id uuid, p_label text, p_value text, p_unit text) TO authenticated;
--> statement-breakpoint

-- Every step of a notebook in order, with its status taken from the evidence,
-- and which one is current. A timer counts as evidence only for the person who
-- started it, as timers are personal.
CREATE FUNCTION api.record_steps(p_record_id uuid)
  RETURNS TABLE (
    block_id uuid, step_number integer, step_text text, status text, is_current boolean,
    completed_at timestamptz, completed_by_user_id text, note text,
    result_count integer, duration_seconds integer, timer_ends_at timestamptz, instrument_id uuid)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH steps AS (
    SELECT b.id, b."order", b.payload,
           (coalesce(b.payload->>'completed', 'false') = 'true') AS done,
           (SELECT count(*)::integer FROM api.blocks r
             WHERE r.record_id = b.record_id AND r.type = 'metric'
               AND r.payload->>'stepBlockId' = b.id::text) AS results,
           (SELECT max(t.ends_at) FROM api.step_timers t
             WHERE t.block_id = b.id AND t.status = 'running'
               AND t.user_id = api.current_user_id()) AS timer_ends
      FROM api.blocks b
     WHERE b.record_id = p_record_id AND b.type = 'procedure_step'
  ), ranked AS (
    SELECT s.*,
           CASE WHEN s.done THEN 'done'
                WHEN coalesce(btrim(s.payload->>'note'), '') <> '' OR s.results > 0 OR s.timer_ends IS NOT NULL
                  THEN 'in_progress'
                ELSE 'not_started' END AS status,
           row_number() OVER (PARTITION BY s.done ORDER BY s."order") AS first_open
      FROM steps s
  )
  SELECT r.id,
         CASE WHEN (r.payload->>'stepNumber') ~ '^[0-9]+$' THEN (r.payload->>'stepNumber')::integer END,
         r.payload->>'text', r.status,
         (NOT r.done AND r.first_open = 1),
         CASE WHEN r.done AND (r.payload->>'completedAt') IS NOT NULL
              THEN (r.payload->>'completedAt')::timestamptz END,
         r.payload->>'completedByUserId',
         nullif(btrim(r.payload->>'note'), ''),
         r.results,
         CASE WHEN (r.payload->>'durationSeconds') ~ '^[0-9]+$' THEN (r.payload->>'durationSeconds')::integer END,
         r.timer_ends,
         CASE WHEN (r.payload->>'instrumentId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (r.payload->>'instrumentId')::uuid END
    FROM ranked r
   ORDER BY r."order";
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_steps(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_steps(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_steps(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Pipelines may be triggered by the step events (PIPELINE_TRIGGER_EVENTS in
-- src/lib/pipeline-schedule.ts).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''registry.entry.created'', ''record.assigned'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''registry.entry.created'', ''record.assigned'',',
    '''registry.entry.created'', ''record.assigned'', ''step.completed'', ''step.reopened'', ''step.result_added'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A pipeline can finish a step and record a result. The database's copy of the
-- action catalogue (checked when a pipeline is saved) gains the two actions.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"set_step_done","rpc":"set_step_done","label":"Finish or reopen a step","description":"Tick a protocol step as done, or reopen it, with an optional note. Stamps who finished it and when.","arguments":[{"name":"p_block_id","type":"uuid","required":true,"nullable":false},{"name":"p_done","type":"boolean","required":false,"nullable":false},{"name":"p_note","type":"text","required":false,"nullable":true}]},{"operation":"add_step_result","rpc":"add_step_result","label":"Record a result on a step","description":"Add a measurement to the notebook against a protocol step.","arguments":[{"name":"p_block_id","type":"uuid","required":true,"nullable":false},{"name":"p_label","type":"text","required":true,"nullable":false},{"name":"p_value","type":"text","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
