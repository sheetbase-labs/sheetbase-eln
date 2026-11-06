-- Parts of an experiment: one notebook split over days, each part its own page.
--
-- An experiment with no parts is a single page, exactly as before. Once it has
-- parts, every block belongs to one, parts run in order, and each carries the
-- day it falls on (days from the start of the experiment) and who does it.
-- Reads and writes go through the functions below; the table is read-only to
-- callers so the rules in them (the lock on submitted notebooks, block order
-- following part order, the current part) cannot be skipped.
--
--   * api.experiment_parts            the parts of a record
--   * api.blocks.part_id              which part a block is in (null: no parts)
--   * create / update / move / delete a part, mark one done, put a block in a
--     part, split an existing notebook into parts
--   * api.record_parts, api.record_steps (now part-aware)
--   * a part opens when the one before it is done; finishing the last open
--     step of a part finishes it. Both go on the change feed.
--   * protocols and templates that carry parts hand them to the experiments
--     made from them
--   * a bell notification on the morning of a part's day

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE api.experiment_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    "position" real NOT NULL,
    title text NOT NULL,
    day_offset integer DEFAULT 0 NOT NULL,
    assignee_user_id text,
    opened_at timestamp with time zone,
    completed_at timestamp with time zone,
    completed_by_user_id text,
    -- The part of a protocol or template this one was made from.
    source_part_id uuid,
    reminded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    updated_by_user_id text,
    CONSTRAINT experiment_parts_pkey PRIMARY KEY (id),
    CONSTRAINT experiment_parts_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT experiment_parts_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT experiment_parts_assignee_fk FOREIGN KEY (assignee_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_experiment_parts_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_experiment_parts_day CHECK (day_offset BETWEEN 0 AND 3650)
);
--> statement-breakpoint
ALTER TABLE api.experiment_parts OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_experiment_parts_record ON api.experiment_parts (record_id, "position");
--> statement-breakpoint
CREATE INDEX idx_experiment_parts_reminder ON api.experiment_parts (record_id) WHERE reminded_at IS NULL AND completed_at IS NULL;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON api.experiment_parts FOR EACH ROW EXECUTE FUNCTION internal.set_updated_at();
--> statement-breakpoint
ALTER TABLE api.experiment_parts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_parts_select ON api.experiment_parts FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY experiment_parts_select_api_client ON api.experiment_parts FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_parts TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_parts TO api_client;
--> statement-breakpoint

ALTER TABLE api.blocks ADD COLUMN part_id uuid;
--> statement-breakpoint
ALTER TABLE api.blocks ADD CONSTRAINT blocks_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX idx_blocks_part ON api.blocks (part_id) WHERE part_id IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Change feed, webhooks and pipeline triggers
-- ---------------------------------------------------------------------------
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
  v_def := replace(v_def, '::text]', '::text, ''experiment_part''::text, ''part_completion''::text, ''part_opened''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('experiment.part_created'), ('experiment.part_completed'),
  ('experiment.part_reopened'), ('experiment.part_opened');
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''step.result_added'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''step.result_added'',',
    '''step.result_added'', ''experiment.part_created'', ''experiment.part_completed'', ''experiment.part_reopened'', ''experiment.part_opened'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A pipeline can mark a part done. The database's copy of the action catalogue
-- (checked when a pipeline is saved) gains the action.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"set_part_done","rpc":"set_part_done","label":"Finish or reopen a part","description":"Mark a part of an experiment that has no steps as done, or reopen it. A part with steps is done when its steps are.","arguments":[{"name":"p_part_id","type":"uuid","required":true,"nullable":false},{"name":"p_done","type":"boolean","required":true,"nullable":false}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A notebook template may list parts and tag its placements with the part they
-- belong to. The database's check of a template configuration (strict about
-- the keys it allows) learns both.
DO $$
DECLARE
  v_def text;
  v_nl text := chr(10);
BEGIN
  SELECT pg_get_functiondef('internal.validate_notebook_template_configuration(uuid,jsonb)'::regprocedure) INTO v_def;
  IF position('''placements.narrative''' IN v_def) = 0 OR position('''placements.sheet''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_notebook_template_configuration';
  END IF;
  v_def := replace(v_def,
    'ARRAY[''formatVersion'',''parameters'',''placements''],' || v_nl || '    ''configuration''',
    'ARRAY[''formatVersion'',''parameters'',''placements'',''parts''],' || v_nl || '    ''configuration''');
  v_def := replace(v_def,
    'ARRAY[''id'',''kind'',''order'',''blockType'',''payload''],' || v_nl || '        ''placements.narrative''',
    'ARRAY[''id'',''kind'',''order'',''blockType'',''payload'',''partId''],' || v_nl || '        ''placements.narrative''');
  v_def := replace(v_def,
    '''parameterMappings'',''title''],' || v_nl || '        ''placements.sheet''',
    '''parameterMappings'',''title'',''partId''],' || v_nl || '        ''placements.sheet''');
  v_def := replace(v_def,
    '  FOR item IN SELECT value FROM jsonb_array_elements(p_config->''placements'') LOOP',
    $parts$  IF p_config ? 'parts' THEN
    IF jsonb_typeof(p_config->'parts') <> 'array' OR jsonb_array_length(p_config->'parts') > 60 THEN
      RAISE EXCEPTION 'invalid Notebook Template parts' USING ERRCODE = 'SB091';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_config->'parts') LOOP
      PERFORM internal.assert_sheet_definition_object(
        item, ARRAY['id','title','dayOffset'], ARRAY['id','title','dayOffset'], 'parts');
      PERFORM internal.sheet_definition_uuid(item->>'id', 'parts.id');
      IF jsonb_typeof(item->'title') <> 'string'
         OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 200
         OR jsonb_typeof(item->'dayOffset') <> 'number'
         OR (item->>'dayOffset')::numeric <> trunc((item->>'dayOffset')::numeric)
         OR (item->>'dayOffset')::numeric NOT BETWEEN 0 AND 3650 THEN
        RAISE EXCEPTION 'invalid Notebook Template part' USING ERRCODE = 'SB091';
      END IF;
    END LOOP;
    IF (SELECT count(DISTINCT pr.value->>'id') FROM jsonb_array_elements(p_config->'parts') pr)
       <> jsonb_array_length(p_config->'parts') THEN
      RAISE EXCEPTION 'duplicate Notebook Template part' USING ERRCODE = 'SB091';
    END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'placements') LOOP$parts$);
  v_def := replace(v_def,
    '    placement_ids := array_append(placement_ids, id);',
    $ids$    placement_ids := array_append(placement_ids, id);
    IF item ? 'partId' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_config->'parts', '[]'::jsonb)) pr
       WHERE pr.value->>'id' = item->>'partId') THEN
      RAISE EXCEPTION 'a placement names a part the Template does not have' USING ERRCODE = 'SB091';
    END IF;$ids$);
  IF position('''parts''],' IN v_def) = 0 OR position('''partId''],' IN v_def) = 0
     OR position('duplicate Notebook Template part' IN v_def) = 0
     OR position('names a part the Template' IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not patch internal.validate_notebook_template_configuration';
  END IF;
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- One event for a part: change is created, completed, reopened or opened.
CREATE FUNCTION internal.emit_part_event(p_part api.experiment_parts, p_entity_type text, p_operation text, p_change text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_number integer;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_part.record_id;
  IF v_record.id IS NULL THEN
    RETURN;
  END IF;
  SELECT count(*)::integer INTO v_number FROM api.experiment_parts
   WHERE record_id = p_part.record_id AND ("position", id) <= (p_part."position", p_part.id);
  PERFORM internal.emit_change_event(v_record.workspace_id, p_entity_type, p_part.id, p_operation,
    p_part.record_id, v_record.project_id,
    jsonb_build_object('change', p_change,
                       'partId', p_part.id, 'partNumber', v_number, 'part', p_part.title,
                       'recordId', p_part.record_id,
                       'identifier', v_record.identifier, 'title', v_record.title,
                       'dayOffset', p_part.day_offset,
                       'assigneeUserId', p_part.assignee_user_id,
                       'completedByUserId', p_part.completed_by_user_id));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_part_event(p_part api.experiment_parts, p_entity_type text, p_operation text, p_change text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_part_event(p_part api.experiment_parts, p_entity_type text, p_operation text, p_change text) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Keeping parts in step with their steps
-- ---------------------------------------------------------------------------

-- A part is done when all its steps are done, or by hand when it has none. The
-- current part is the first one that is not done, and it opens the moment it
-- becomes current. This brings the stored state in line with the notebook and
-- reports what changed.
CREATE FUNCTION internal.refresh_record_parts(p_record_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_steps integer;
  v_open integer;
  v_done boolean;
  v_current_found boolean := false;
BEGIN
  FOR v_part IN
    SELECT * FROM api.experiment_parts WHERE record_id = p_record_id ORDER BY "position", id
  LOOP
    SELECT count(*)::integer,
           count(*) FILTER (WHERE coalesce(b.payload->>'completed', 'false') <> 'true')::integer
      INTO v_steps, v_open
      FROM api.blocks b WHERE b.part_id = v_part.id AND b.type = 'procedure_step';
    IF v_steps > 0 THEN
      v_done := v_open = 0;
      IF v_done AND v_part.completed_at IS NULL THEN
        UPDATE api.experiment_parts
           SET completed_at = now(), completed_by_user_id = api.current_user_id()
         WHERE id = v_part.id RETURNING * INTO v_part;
        PERFORM internal.emit_part_event(v_part, 'part_completion', 'create', 'completed');
      ELSIF NOT v_done AND v_part.completed_at IS NOT NULL THEN
        UPDATE api.experiment_parts
           SET completed_at = NULL, completed_by_user_id = NULL
         WHERE id = v_part.id RETURNING * INTO v_part;
        PERFORM internal.emit_part_event(v_part, 'part_completion', 'delete', 'reopened');
      END IF;
    ELSE
      v_done := v_part.completed_at IS NOT NULL;
    END IF;
    IF NOT v_done AND NOT v_current_found THEN
      v_current_found := true;
      IF v_part.opened_at IS NULL THEN
        UPDATE api.experiment_parts SET opened_at = now() WHERE id = v_part.id RETURNING * INTO v_part;
        PERFORM internal.emit_part_event(v_part, 'part_opened', 'create', 'opened');
      END IF;
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refresh_record_parts(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refresh_record_parts(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- A block lands in a part: the one named, the part a protocol step came from,
-- or the part of the block before it. Parts never mix records.
CREATE FUNCTION internal.assign_block_part() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_source_part api.experiment_parts;
  v_prev uuid;
BEGIN
  IF NEW.part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM api.experiment_parts WHERE id = NEW.part_id;
    IF v_part.id IS NULL OR v_part.record_id IS DISTINCT FROM NEW.record_id THEN
      RAISE EXCEPTION 'a block can only be in a part of its own experiment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = NEW.record_id) THEN
    -- A copied protocol step brings its protocol's part with it, when the
    -- protocol is split into parts and the experiment has none yet.
    IF NEW.type = 'procedure_step'
       AND (NEW.payload->>'sourceStepBlockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND EXISTS (
         SELECT 1 FROM api.blocks s JOIN api.experiment_parts sp ON sp.id = s.part_id
          WHERE s.id = (NEW.payload->>'sourceStepBlockId')::uuid) THEN
      NULL;
    ELSE
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.type = 'procedure_step'
     AND (NEW.payload->>'sourceStepBlockId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT sp.* INTO v_source_part
      FROM api.blocks s JOIN api.experiment_parts sp ON sp.id = s.part_id
     WHERE s.id = (NEW.payload->>'sourceStepBlockId')::uuid;
    IF v_source_part.id IS NOT NULL THEN
      SELECT * INTO v_part FROM api.experiment_parts
       WHERE record_id = NEW.record_id AND source_part_id = v_source_part.id;
      IF v_part.id IS NULL THEN
        INSERT INTO api.experiment_parts
          (workspace_id, record_id, "position", title, day_offset, source_part_id, created_by_user_id)
        SELECT r.workspace_id, NEW.record_id,
               coalesce((SELECT max(x."position") FROM api.experiment_parts x WHERE x.record_id = NEW.record_id), 0) + 1,
               v_source_part.title, v_source_part.day_offset, v_source_part.id, api.current_user_id()
          FROM api.records r WHERE r.id = NEW.record_id
        RETURNING * INTO v_part;
      END IF;
      NEW.part_id := v_part.id;
      RETURN NEW;
    END IF;
  END IF;
  SELECT b.part_id INTO v_prev FROM api.blocks b
   WHERE b.record_id = NEW.record_id AND b."order" < NEW."order" AND b.part_id IS NOT NULL
   ORDER BY b."order" DESC LIMIT 1;
  IF v_prev IS NULL THEN
    SELECT id INTO v_prev FROM api.experiment_parts
     WHERE record_id = NEW.record_id ORDER BY "position", id LIMIT 1;
  END IF;
  NEW.part_id := v_prev;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.assign_block_part() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assign_block_part() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER assign_block_part BEFORE INSERT OR UPDATE OF part_id ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.assign_block_part();
--> statement-breakpoint

-- A step is finished, reopened, added, removed or moved to another part.
CREATE FUNCTION internal.trg_refresh_parts_from_block() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM internal.refresh_record_parts(OLD.record_id);
  ELSE
    PERFORM internal.refresh_record_parts(NEW.record_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_parts_from_block() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_parts_from_block() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_parts_step_insert AFTER INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'procedure_step' AND NEW.part_id IS NOT NULL)
  EXECUTE FUNCTION internal.trg_refresh_parts_from_block();
--> statement-breakpoint
CREATE TRIGGER refresh_parts_step_update AFTER UPDATE ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'procedure_step'
    AND (coalesce(OLD.payload->>'completed', 'false') IS DISTINCT FROM coalesce(NEW.payload->>'completed', 'false')
         OR OLD.part_id IS DISTINCT FROM NEW.part_id))
  EXECUTE FUNCTION internal.trg_refresh_parts_from_block();
--> statement-breakpoint
CREATE TRIGGER refresh_parts_step_delete AFTER DELETE ON api.blocks
  FOR EACH ROW WHEN (OLD.type = 'procedure_step' AND OLD.part_id IS NOT NULL)
  EXECUTE FUNCTION internal.trg_refresh_parts_from_block();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Who may change the parts of a record: a writer who can edit it, while it is
-- not locked. Definer functions skip the block lock trigger, so it is checked here.
CREATE FUNCTION internal.part_write_record(p_record_id uuid) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND workspace_id = api.current_workspace_id() AND deleted_at IS NULL;
  IF v_record.id IS NULL OR api.current_user_id() IS NULL
     OR NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  IF v_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'this experiment is archived' USING ERRCODE = 'SB006';
  END IF;
  IF v_record.locked_at IS NOT NULL OR internal.record_is_locked(p_record_id) THEN
    RAISE EXCEPTION 'record is locked' USING ERRCODE = 'SB011';
  END IF;
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.part_write_record(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.part_write_record(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Put every block of a record back in part order, keeping each part's own order.
CREATE FUNCTION internal.restage_part_blocks(p_record_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
  v_min real;
  v_max real;
  v_offset real;
BEGIN
  SELECT count(*), min("order"), max("order") INTO v_count, v_min, v_max
    FROM api.blocks WHERE record_id = p_record_id;
  IF v_count = 0 THEN
    RETURN;
  END IF;
  v_offset := greatest(v_max, v_count) - v_min + 1;
  UPDATE api.blocks SET "order" = "order" + v_offset WHERE record_id = p_record_id;
  WITH ordered AS (
    SELECT b.id, row_number() OVER (ORDER BY p."position" NULLS FIRST, b."order", b.id) AS n
      FROM api.blocks b LEFT JOIN api.experiment_parts p ON p.id = b.part_id
     WHERE b.record_id = p_record_id)
  UPDATE api.blocks x SET "order" = ordered.n, version = x.version + 1
    FROM ordered WHERE x.id = ordered.id;
  UPDATE api.records SET structure_version = structure_version + 1 WHERE id = p_record_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.restage_part_blocks(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.restage_part_blocks(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Add a part. The first part of a notebook that already has content takes all
-- of it, so nothing is left outside a part. Later parts start empty, after the
-- part named (or last), and with the day after the part before when no day is given.
CREATE FUNCTION api.create_experiment_part(p_record_id uuid, p_title text, p_day_offset integer DEFAULT NULL, p_after_part_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records := internal.part_write_record(p_record_id);
  v_title text := btrim(coalesce(p_title, ''));
  v_after api.experiment_parts;
  v_next real;
  v_position real;
  v_day integer := p_day_offset;
  v_first boolean;
  v_part api.experiment_parts;
BEGIN
  IF char_length(v_title) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'give the part a title of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF v_day IS NOT NULL AND v_day NOT BETWEEN 0 AND 3650 THEN
    RAISE EXCEPTION 'a part falls between day 0 and day 3650' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM api.experiment_parts WHERE record_id = p_record_id) >= 60 THEN
    RAISE EXCEPTION 'an experiment can have up to 60 parts' USING ERRCODE = '22023';
  END IF;
  v_first := NOT EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = p_record_id);
  IF p_after_part_id IS NOT NULL THEN
    SELECT * INTO v_after FROM api.experiment_parts WHERE id = p_after_part_id AND record_id = p_record_id;
    IF v_after.id IS NULL THEN
      RAISE EXCEPTION 'that part is not in this experiment' USING ERRCODE = '23503';
    END IF;
    SELECT min("position") INTO v_next FROM api.experiment_parts
     WHERE record_id = p_record_id AND "position" > v_after."position";
    v_position := CASE WHEN v_next IS NULL THEN v_after."position" + 1 ELSE (v_after."position" + v_next) / 2 END;
  ELSE
    SELECT * INTO v_after FROM api.experiment_parts WHERE record_id = p_record_id ORDER BY "position" DESC, id DESC LIMIT 1;
    v_position := coalesce(v_after."position", 0) + 1;
  END IF;
  IF v_day IS NULL THEN
    v_day := CASE WHEN v_after.id IS NULL THEN 0 ELSE least(v_after.day_offset + 1, 3650) END;
  END IF;
  INSERT INTO api.experiment_parts
    (workspace_id, record_id, "position", title, day_offset, created_by_user_id, updated_by_user_id)
  VALUES (v_record.workspace_id, p_record_id, v_position, v_title, v_day,
          api.current_user_id(), api.current_user_id())
  RETURNING * INTO v_part;
  PERFORM internal.emit_part_event(v_part, 'experiment_part', 'create', 'created');
  IF v_first THEN
    UPDATE api.blocks SET part_id = v_part.id WHERE record_id = p_record_id AND part_id IS NULL;
    UPDATE api.records SET structure_version = structure_version + 1 WHERE id = p_record_id;
  END IF;
  PERFORM internal.refresh_record_parts(p_record_id);
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = v_part.id;
  RETURN to_jsonb(v_part);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_experiment_part(p_record_id uuid, p_title text, p_day_offset integer, p_after_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_experiment_part(p_record_id uuid, p_title text, p_day_offset integer, p_after_part_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_experiment_part(p_record_id uuid, p_title text, p_day_offset integer, p_after_part_id uuid) TO authenticated;
--> statement-breakpoint

-- Rename a part, change its day, or set or clear who does it.
CREATE FUNCTION api.update_experiment_part(p_part_id uuid, p_title text DEFAULT NULL, p_day_offset integer DEFAULT NULL, p_assignee_user_id text DEFAULT NULL, p_clear_assignee boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  IF p_title IS NOT NULL AND (v_title IS NULL OR char_length(v_title) > 200) THEN
    RAISE EXCEPTION 'give the part a title of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF p_day_offset IS NOT NULL AND p_day_offset NOT BETWEEN 0 AND 3650 THEN
    RAISE EXCEPTION 'a part falls between day 0 and day 3650' USING ERRCODE = '22023';
  END IF;
  IF p_assignee_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.workspace_memberships m
        WHERE m.workspace_id = v_part.workspace_id AND m.user_id = p_assignee_user_id) THEN
    RAISE EXCEPTION 'that person is not in this workspace' USING ERRCODE = '22023';
  END IF;
  UPDATE api.experiment_parts
     SET title = coalesce(v_title, title),
         day_offset = coalesce(p_day_offset, day_offset),
         assignee_user_id = CASE WHEN p_clear_assignee THEN NULL
                                 ELSE coalesce(p_assignee_user_id, assignee_user_id) END,
         -- A new day or person means a fresh reminder.
         reminded_at = CASE WHEN p_day_offset IS DISTINCT FROM day_offset AND p_day_offset IS NOT NULL
                            THEN NULL ELSE reminded_at END,
         updated_by_user_id = api.current_user_id()
   WHERE id = p_part_id
  RETURNING * INTO v_part;
  RETURN to_jsonb(v_part);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_experiment_part(p_part_id uuid, p_title text, p_day_offset integer, p_assignee_user_id text, p_clear_assignee boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_experiment_part(p_part_id uuid, p_title text, p_day_offset integer, p_assignee_user_id text, p_clear_assignee boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_experiment_part(p_part_id uuid, p_title text, p_day_offset integer, p_assignee_user_id text, p_clear_assignee boolean) TO authenticated;
--> statement-breakpoint

-- Move a part to sit after another (or first, when none is named). Its blocks follow.
CREATE FUNCTION api.move_experiment_part(p_part_id uuid, p_after_part_id uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_after api.experiment_parts;
  v_next real;
  v_position real;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  IF p_after_part_id IS NOT NULL THEN
    IF p_after_part_id = p_part_id THEN
      RETURN to_jsonb(v_part);
    END IF;
    SELECT * INTO v_after FROM api.experiment_parts WHERE id = p_after_part_id AND record_id = v_part.record_id;
    IF v_after.id IS NULL THEN
      RAISE EXCEPTION 'that part is not in this experiment' USING ERRCODE = '23503';
    END IF;
    SELECT min("position") INTO v_next FROM api.experiment_parts
     WHERE record_id = v_part.record_id AND "position" > v_after."position" AND id <> p_part_id;
    v_position := CASE WHEN v_next IS NULL THEN v_after."position" + 1 ELSE (v_after."position" + v_next) / 2 END;
  ELSE
    SELECT min("position") INTO v_next FROM api.experiment_parts
     WHERE record_id = v_part.record_id AND id <> p_part_id;
    v_position := coalesce(v_next, 1) - 1;
  END IF;
  UPDATE api.experiment_parts SET "position" = v_position, updated_by_user_id = api.current_user_id()
   WHERE id = p_part_id RETURNING * INTO v_part;
  PERFORM internal.restage_part_blocks(v_part.record_id);
  PERFORM internal.refresh_record_parts(v_part.record_id);
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id;
  RETURN to_jsonb(v_part);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.move_experiment_part(p_part_id uuid, p_after_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.move_experiment_part(p_part_id uuid, p_after_part_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.move_experiment_part(p_part_id uuid, p_after_part_id uuid) TO authenticated;
--> statement-breakpoint

-- Put a block in a part, at the end of it. Used by the page after it adds a
-- block, by the API, and to move content between parts.
CREATE FUNCTION api.set_block_part(p_block_id uuid, p_part_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_block api.blocks;
  v_part api.experiment_parts;
  v_lo real;
  v_hi real;
  v_order real;
BEGIN
  SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id FOR UPDATE;
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'block not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_block.record_id);
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id AND record_id = v_block.record_id;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'that part is not in this experiment' USING ERRCODE = '23503';
  END IF;
  IF v_block.part_id IS NOT DISTINCT FROM p_part_id THEN
    RETURN jsonb_build_object('block_id', v_block.id, 'part_id', v_block.part_id, 'order', v_block."order", 'version', v_block.version,
      'structure_version', (SELECT structure_version FROM api.records WHERE id = v_block.record_id));
  END IF;
  -- Slot it after everything in this part and the parts before it, and before
  -- everything in the parts after it.
  SELECT max(b."order") INTO v_lo
    FROM api.blocks b LEFT JOIN api.experiment_parts p ON p.id = b.part_id
   WHERE b.record_id = v_block.record_id AND b.id <> p_block_id
     AND (p.id IS NULL OR p."position" <= v_part."position");
  SELECT min(b."order") INTO v_hi
    FROM api.blocks b JOIN api.experiment_parts p ON p.id = b.part_id
   WHERE b.record_id = v_block.record_id AND b.id <> p_block_id AND p."position" > v_part."position";
  v_order := CASE WHEN v_lo IS NULL AND v_hi IS NULL THEN 1
                  WHEN v_hi IS NULL THEN v_lo + 1
                  WHEN v_lo IS NULL THEN v_hi / 2
                  ELSE (v_lo + v_hi) / 2 END;
  UPDATE api.blocks
     SET part_id = p_part_id,
         "order" = CASE WHEN v_lo IS NOT NULL AND v_hi IS NOT NULL AND v_lo >= v_hi THEN "order" ELSE v_order END,
         version = version + 1, updated_by_user_id = api.current_user_id()
   WHERE id = p_block_id RETURNING * INTO v_block;
  IF v_lo IS NOT NULL AND v_hi IS NOT NULL AND v_lo >= v_hi THEN
    PERFORM internal.restage_part_blocks(v_block.record_id);
  ELSE
    UPDATE api.records SET structure_version = structure_version + 1 WHERE id = v_block.record_id;
  END IF;
  SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id;
  RETURN jsonb_build_object('block_id', v_block.id, 'part_id', v_block.part_id, 'order', v_block."order", 'version', v_block.version,
    'structure_version', (SELECT structure_version FROM api.records WHERE id = v_block.record_id));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_block_part(p_block_id uuid, p_part_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_block_part(p_block_id uuid, p_part_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_block_part(p_block_id uuid, p_part_id uuid) TO authenticated;
--> statement-breakpoint

-- Remove a part. It has to be empty, or say which part takes its blocks.
CREATE FUNCTION api.delete_experiment_part(p_part_id uuid, p_move_blocks_to uuid DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_target api.experiment_parts;
  v_blocks integer;
  v_moved integer := 0;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  SELECT count(*)::integer INTO v_blocks FROM api.blocks WHERE part_id = p_part_id;
  IF v_blocks > 0 THEN
    IF p_move_blocks_to IS NULL THEN
      RAISE EXCEPTION 'this part has content: say which part takes it, or empty it first' USING ERRCODE = 'SB006';
    END IF;
    SELECT * INTO v_target FROM api.experiment_parts
     WHERE id = p_move_blocks_to AND record_id = v_part.record_id AND id <> p_part_id;
    IF v_target.id IS NULL THEN
      RAISE EXCEPTION 'that part is not in this experiment' USING ERRCODE = '23503';
    END IF;
    -- The blocks join the end of the part that takes them, in the order they had.
    UPDATE api.blocks SET part_id = v_target.id, version = version + 1
     WHERE part_id = p_part_id;
    v_moved := v_blocks;
  END IF;
  DELETE FROM api.experiment_parts WHERE id = p_part_id;
  IF v_moved > 0 THEN
    PERFORM internal.restage_part_blocks(v_part.record_id);
  END IF;
  PERFORM internal.emit_part_event(v_part, 'experiment_part', 'delete', 'deleted');
  PERFORM internal.refresh_record_parts(v_part.record_id);
  RETURN jsonb_build_object('part_id', p_part_id, 'moved_blocks', v_moved);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_experiment_part(p_part_id uuid, p_move_blocks_to uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_experiment_part(p_part_id uuid, p_move_blocks_to uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_experiment_part(p_part_id uuid, p_move_blocks_to uuid) TO authenticated;
--> statement-breakpoint

-- Mark a part done, or reopen it. A part with steps is done when its steps are,
-- so this is for the parts without any.
CREATE FUNCTION api.set_part_done(p_part_id uuid, p_done boolean DEFAULT true) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  IF EXISTS (SELECT 1 FROM api.blocks WHERE part_id = p_part_id AND type = 'procedure_step') THEN
    RAISE EXCEPTION 'this part is done when its steps are: finish or reopen the steps' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_done, true) AND v_part.completed_at IS NULL THEN
    UPDATE api.experiment_parts
       SET completed_at = now(), completed_by_user_id = api.current_user_id(),
           updated_by_user_id = api.current_user_id()
     WHERE id = p_part_id RETURNING * INTO v_part;
    PERFORM internal.emit_part_event(v_part, 'part_completion', 'create', 'completed');
  ELSIF NOT coalesce(p_done, true) AND v_part.completed_at IS NOT NULL THEN
    UPDATE api.experiment_parts
       SET completed_at = NULL, completed_by_user_id = NULL, updated_by_user_id = api.current_user_id()
     WHERE id = p_part_id RETURNING * INTO v_part;
    PERFORM internal.emit_part_event(v_part, 'part_completion', 'delete', 'reopened');
  END IF;
  PERFORM internal.refresh_record_parts(v_part.record_id);
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id;
  RETURN to_jsonb(v_part);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_part_done(p_part_id uuid, p_done boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_part_done(p_part_id uuid, p_done boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_part_done(p_part_id uuid, p_done boolean) TO authenticated;
--> statement-breakpoint

-- Split a notebook that has no parts into several. `p_parts` is a list of
-- {title, first_block_id, day_offset?}: each part starts at its first block and
-- runs to the next part's first block; blocks before the first boundary join
-- the first part.
CREATE FUNCTION api.split_record_into_parts(p_record_id uuid, p_parts jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records := internal.part_write_record(p_record_id);
  v_entry jsonb;
  v_part api.experiment_parts;
  v_parts jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_start real;
  v_day integer;
  v_title text;
BEGIN
  IF EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = p_record_id) THEN
    RAISE EXCEPTION 'this experiment already has parts' USING ERRCODE = '22023';
  END IF;
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'give between 1 and 60 parts' USING ERRCODE = '22023';
  END IF;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    v_n := v_n + 1;
    v_title := btrim(coalesce(v_entry->>'title', ''));
    IF char_length(v_title) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'give every part a title of up to 200 characters' USING ERRCODE = '22023';
    END IF;
    v_day := CASE WHEN (v_entry->>'day_offset') ~ '^[0-9]+$' THEN least((v_entry->>'day_offset')::integer, 3650) ELSE v_n - 1 END;
    INSERT INTO api.experiment_parts
      (workspace_id, record_id, "position", title, day_offset, created_by_user_id, updated_by_user_id)
    VALUES (v_record.workspace_id, p_record_id, v_n, v_title, v_day, api.current_user_id(), api.current_user_id())
    RETURNING * INTO v_part;
    v_parts := v_parts || jsonb_build_array(to_jsonb(v_part));
    PERFORM internal.emit_part_event(v_part, 'experiment_part', 'create', 'created');
    IF (v_entry->>'first_block_id') IS NOT NULL THEN
      SELECT "order" INTO v_start FROM api.blocks
       WHERE id = (v_entry->>'first_block_id')::uuid AND record_id = p_record_id;
      IF v_start IS NULL THEN
        RAISE EXCEPTION 'a part starts at a block that is not in this experiment' USING ERRCODE = '23503';
      END IF;
    ELSE
      v_start := NULL;
    END IF;
    -- Everything from this boundary on joins this part; later parts claim their share after it.
    IF v_n = 1 THEN
      UPDATE api.blocks SET part_id = v_part.id WHERE record_id = p_record_id;
    ELSIF v_start IS NOT NULL THEN
      UPDATE api.blocks SET part_id = v_part.id WHERE record_id = p_record_id AND "order" >= v_start;
    END IF;
  END LOOP;
  UPDATE api.records SET structure_version = structure_version + 1 WHERE id = p_record_id;
  PERFORM internal.refresh_record_parts(p_record_id);
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."position"), '[]'::jsonb)
            FROM api.experiment_parts x WHERE x.record_id = p_record_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.split_record_into_parts(p_record_id uuid, p_parts jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.split_record_into_parts(p_record_id uuid, p_parts jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.split_record_into_parts(p_record_id uuid, p_parts jsonb) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- The parts of an experiment in order, with where each stands: done, now (the
-- first one not done) or later, and a count of its steps and blocks.
CREATE FUNCTION api.record_parts(p_record_id uuid)
  RETURNS TABLE (
    part_id uuid, part_number integer, title text, day_offset integer, due_on date,
    assignee_user_id text, status text, is_current boolean,
    opened_at timestamptz, completed_at timestamptz, completed_by_user_id text,
    step_count integer, steps_done integer, block_count integer, result_count integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH parts AS (
    SELECT p.*, row_number() OVER (ORDER BY p."position", p.id)::integer AS n
      FROM api.experiment_parts p WHERE p.record_id = p_record_id
  ), current_part AS (
    SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1
  )
  SELECT p.id, p.n, p.title, p.day_offset,
         (r.created_at::date + p.day_offset),
         p.assignee_user_id,
         CASE WHEN p.completed_at IS NOT NULL THEN 'done'
              WHEN p.id = (SELECT id FROM current_part) THEN 'now'
              ELSE 'later' END,
         (p.id = (SELECT id FROM current_part)),
         p.opened_at, p.completed_at, p.completed_by_user_id,
         (SELECT count(*)::integer FROM api.blocks b WHERE b.part_id = p.id AND b.type = 'procedure_step'),
         (SELECT count(*)::integer FROM api.blocks b WHERE b.part_id = p.id AND b.type = 'procedure_step'
             AND coalesce(b.payload->>'completed', 'false') = 'true'),
         (SELECT count(*)::integer FROM api.blocks b WHERE b.part_id = p.id),
         (SELECT count(*)::integer FROM api.blocks b WHERE b.part_id = p.id AND b.type = 'metric')
    FROM parts p JOIN api.records r ON r.id = p.record_id
   ORDER BY p.n;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_parts(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_parts(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_parts(p_record_id uuid) TO authenticated;
--> statement-breakpoint

-- Steps now say which part they are in and are numbered within it, and the
-- current step is the first open one of the current part.
DROP FUNCTION api.record_steps(uuid);
--> statement-breakpoint
CREATE FUNCTION api.record_steps(p_record_id uuid)
  RETURNS TABLE (
    block_id uuid, step_number integer, step_text text, status text, is_current boolean,
    completed_at timestamptz, completed_by_user_id text, note text,
    result_count integer, duration_seconds integer, timer_ends_at timestamptz, instrument_id uuid,
    part_id uuid, part_number integer, part_title text, part_step_number integer, part_step_count integer)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH parts AS (
    SELECT p.id, p.title, p.completed_at, row_number() OVER (ORDER BY p."position", p.id)::integer AS n
      FROM api.experiment_parts p WHERE p.record_id = p_record_id
  ), current_part AS (
    SELECT id FROM parts WHERE completed_at IS NULL ORDER BY n LIMIT 1
  ), steps AS (
    SELECT b.id, b."order", b.payload, b.part_id,
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
           row_number() OVER (PARTITION BY s.part_id, s.done ORDER BY s."order") AS first_open,
           row_number() OVER (PARTITION BY s.part_id ORDER BY s."order") AS in_part,
           count(*) OVER (PARTITION BY s.part_id) AS part_total
      FROM steps s
  )
  SELECT r.id,
         CASE WHEN (r.payload->>'stepNumber') ~ '^[0-9]+$' THEN (r.payload->>'stepNumber')::integer END,
         r.payload->>'text', r.status,
         (NOT r.done AND r.first_open = 1
            AND r.part_id IS NOT DISTINCT FROM (SELECT cp.id FROM current_part cp)),
         CASE WHEN r.done AND (r.payload->>'completedAt') IS NOT NULL
              THEN (r.payload->>'completedAt')::timestamptz END,
         r.payload->>'completedByUserId',
         nullif(btrim(r.payload->>'note'), ''),
         r.results,
         CASE WHEN (r.payload->>'durationSeconds') ~ '^[0-9]+$' THEN (r.payload->>'durationSeconds')::integer END,
         r.timer_ends,
         CASE WHEN (r.payload->>'instrumentId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (r.payload->>'instrumentId')::uuid END,
         r.part_id,
         (SELECT p.n FROM parts p WHERE p.id = r.part_id),
         (SELECT p.title FROM parts p WHERE p.id = r.part_id),
         CASE WHEN r.part_id IS NOT NULL THEN r.in_part::integer END,
         CASE WHEN r.part_id IS NOT NULL THEN r.part_total::integer END
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

-- ---------------------------------------------------------------------------
-- Experiments made from a template with parts
-- ---------------------------------------------------------------------------

-- A notebook template version may list parts ({id, title, dayOffset}) and tag
-- its placements with the part they belong to (`partId`). When an experiment is
-- made from it, the parts are created and each block lands in its part.
CREATE FUNCTION internal.apply_template_parts() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_config jsonb;
  v_record api.records;
  v_part jsonb;
  v_n integer := 0;
  v_new api.experiment_parts;
  v_map jsonb := '{}'::jsonb;
  v_entry jsonb;
  v_placement jsonb;
  v_part_id uuid;
BEGIN
  SELECT configuration INTO v_config FROM api.notebook_template_versions WHERE id = NEW.template_version_id;
  IF v_config IS NULL OR jsonb_typeof(v_config->'parts') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_config->'parts') = 0 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = NEW.record_id;
  IF v_record.id IS NULL OR EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = NEW.record_id) THEN
    RETURN NEW;
  END IF;
  FOR v_part IN SELECT value FROM jsonb_array_elements(v_config->'parts') LOOP
    v_n := v_n + 1;
    INSERT INTO api.experiment_parts
      (workspace_id, record_id, "position", title, day_offset, source_part_id, created_by_user_id)
    VALUES (v_record.workspace_id, NEW.record_id, v_n,
            left(btrim(coalesce(v_part->>'title', 'Part ' || v_n)), 200),
            CASE WHEN (v_part->>'dayOffset') ~ '^[0-9]+$' THEN least((v_part->>'dayOffset')::integer, 3650) ELSE 0 END,
            CASE WHEN (v_part->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN (v_part->>'id')::uuid END,
            NEW.actor_user_id)
    RETURNING * INTO v_new;
    v_map := v_map || jsonb_build_object(coalesce(v_part->>'id', v_n::text), v_new.id);
  END LOOP;
  FOR v_entry IN SELECT value FROM jsonb_array_elements(coalesce(NEW.result->'composition', '[]'::jsonb)) LOOP
    SELECT p.value INTO v_placement
      FROM jsonb_array_elements(coalesce(v_config->'placements', '[]'::jsonb)) p
     WHERE p.value->>'id' = v_entry->>'placementId';
    v_part_id := NULL;
    IF v_placement IS NOT NULL AND (v_placement->>'partId') IS NOT NULL AND v_map ? (v_placement->>'partId') THEN
      v_part_id := (v_map->>(v_placement->>'partId'))::uuid;
    END IF;
    IF (v_entry->>'blockId') IS NOT NULL THEN
      UPDATE api.blocks SET part_id = coalesce(v_part_id, (
               SELECT id FROM api.experiment_parts WHERE record_id = NEW.record_id ORDER BY "position" LIMIT 1))
       WHERE id = (v_entry->>'blockId')::uuid AND record_id = NEW.record_id;
    END IF;
  END LOOP;
  PERFORM internal.restage_part_blocks(NEW.record_id);
  PERFORM internal.refresh_record_parts(NEW.record_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.apply_template_parts() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.apply_template_parts() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER apply_template_parts AFTER INSERT ON api.notebook_template_instantiations
  FOR EACH ROW EXECUTE FUNCTION internal.apply_template_parts();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A reminder on the morning of a part's day
-- ---------------------------------------------------------------------------
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('part_reminder', 'notification', ARRAY[]::text[], false);
--> statement-breakpoint

-- Tell whoever does a part that its day has come: the person it is assigned to,
-- or the experiment's owner when nobody is. Once per part (a new day resets it),
-- and only while the experiment is running and the part is not done.
CREATE FUNCTION internal.sweep_part_reminders() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row record;
  v_recipient text;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT p.id, p.title, p.assignee_user_id, p.record_id, r.workspace_id, r.project_id,
           r.title AS record_title, r.created_by_user_id,
           (SELECT count(*) FROM api.experiment_parts x
             WHERE x.record_id = p.record_id AND (x."position", x.id) <= (p."position", p.id))::integer AS part_number
      FROM api.experiment_parts p
      JOIN api.records r ON r.id = p.record_id
     WHERE p.reminded_at IS NULL AND p.completed_at IS NULL
       AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND r.status IN ('in_progress', 'returned')
       AND (r.created_at::date + p.day_offset) <= current_date
     ORDER BY p.id
     FOR UPDATE OF p SKIP LOCKED
  LOOP
    UPDATE api.experiment_parts SET reminded_at = now() WHERE id = v_row.id;
    v_recipient := coalesce(v_row.assignee_user_id, v_row.created_by_user_id);
    IF v_recipient IS NOT NULL AND internal.notification_recipient_enabled(v_recipient, 'part_reminder') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, project_id)
      VALUES (v_row.workspace_id, v_recipient, 'part_reminder',
              'Part ' || v_row.part_number || ' is today: ' || v_row.title,
              v_row.record_title, v_row.record_id, v_row.project_id);
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sweep_part_reminders() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sweep_part_reminders() FROM PUBLIC;
--> statement-breakpoint

-- The one sweep the server already runs every few seconds does the reminders too.
CREATE OR REPLACE FUNCTION internal.sweep_step_timers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_timer api.step_timers;
  v_count integer := 0;
BEGIN
  FOR v_timer IN
    SELECT * FROM api.step_timers
     WHERE status = 'running' AND notified_at IS NULL AND ends_at <= now()
     ORDER BY ends_at
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE api.step_timers SET notified_at = now() WHERE id = v_timer.id;
    IF internal.notification_recipient_enabled(v_timer.user_id, 'step_timer') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id)
      VALUES (v_timer.workspace_id, v_timer.user_id, 'step_timer',
              'Timer finished', v_timer.label, v_timer.record_id);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  v_count := v_count + internal.sweep_part_reminders();
  RETURN v_count;
END $$;
