-- Gates: a rule that holds back the rest of a page (or a whole part) until
-- earlier work is done.
--
--   * a `gate` block: everything after it in the same part sits behind it
--   * an "opens when" rule on a part, and a "steps in order" flag on a part
--   * conditions: a table or sheet is filled, a step is done, a part is done,
--     samples are linked, a record field is set, a date is reached
--   * api.record_gates answers which gates are met and what is still missing,
--     in words
--   * a gate that blocks is enforced here: writes below it, steps out of order
--     and finishing a closed part are refused with a clear error code. A gate
--     that warns can be gone past with a reason, which is kept (api.gate_overrides)
--   * gates a template or a protocol carries cannot be taken off the experiment
--   * the change feed hears when a gate opens and when one is gone past

-- ---------------------------------------------------------------------------
-- Parts: the rule that opens them and the order of their steps
-- ---------------------------------------------------------------------------
ALTER TABLE api.experiment_parts
    ADD COLUMN opens_when jsonb,
    ADD COLUMN gate_mode text DEFAULT 'warn' NOT NULL,
    ADD COLUMN steps_in_order boolean DEFAULT false NOT NULL,
    ADD COLUMN gate_from_template boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE api.experiment_parts
    ADD CONSTRAINT chk_experiment_parts_gate_mode CHECK (gate_mode IN ('warn', 'block')),
    ADD CONSTRAINT chk_experiment_parts_opens_when CHECK (
      opens_when IS NULL OR (jsonb_typeof(opens_when) = 'array' AND jsonb_array_length(opens_when) BETWEEN 1 AND 12));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The gate block
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.blocks'::regclass AND conname = 'chk_blocks_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_blocks_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''gate''::text]');
  EXECUTE 'ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type';
  EXECUTE 'ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type ' || v_def;
END $$;
--> statement-breakpoint

CREATE INDEX idx_blocks_sheet_instance ON api.blocks ((payload->>'instanceId')) WHERE type = 'sheet';
--> statement-breakpoint
CREATE INDEX idx_blocks_gate ON api.blocks (record_id) WHERE type = 'gate';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Gone past: who went on without the gate being open, and why
-- ---------------------------------------------------------------------------
CREATE TABLE api.gate_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    block_id uuid,
    part_id uuid,
    -- What the gate was and what was missing when it was gone past.
    label text NOT NULL,
    missing text[] DEFAULT '{}'::text[] NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT gate_overrides_pkey PRIMARY KEY (id),
    CONSTRAINT gate_overrides_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT gate_overrides_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT gate_overrides_block_fk FOREIGN KEY (block_id) REFERENCES api.blocks(id) ON DELETE CASCADE,
    CONSTRAINT gate_overrides_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE,
    CONSTRAINT gate_overrides_user_fk FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_gate_overrides_one_gate CHECK ((block_id IS NULL) <> (part_id IS NULL)),
    CONSTRAINT chk_gate_overrides_reason CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
ALTER TABLE api.gate_overrides OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_gate_overrides_block ON api.gate_overrides (block_id) WHERE block_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_gate_overrides_part ON api.gate_overrides (part_id) WHERE part_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_gate_overrides_record ON api.gate_overrides (record_id);
--> statement-breakpoint
ALTER TABLE api.gate_overrides ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY gate_overrides_select ON api.gate_overrides FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY gate_overrides_select_api_client ON api.gate_overrides FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.gate_overrides TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.gate_overrides TO api_client;
--> statement-breakpoint

-- Which gates are open now, so the change feed says "opened" once and again
-- only after the gate has closed in between.
CREATE TABLE internal.gate_states (
    record_id uuid NOT NULL,
    block_id uuid,
    part_id uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gate_states_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT gate_states_block_fk FOREIGN KEY (block_id) REFERENCES api.blocks(id) ON DELETE CASCADE,
    CONSTRAINT gate_states_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE,
    CONSTRAINT chk_gate_states_one_gate CHECK ((block_id IS NULL) <> (part_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE internal.gate_states OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_gate_states_block ON internal.gate_states (block_id) WHERE block_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_gate_states_part ON internal.gate_states (part_id) WHERE part_id IS NOT NULL;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.gate_states FROM PUBLIC;
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
  v_def := replace(v_def, '::text]', '::text, ''gate_opening''::text, ''gate_override''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('experiment.gate_opened'), ('experiment.gate_overridden');
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''experiment.part_opened'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''experiment.part_opened'',',
    '''experiment.part_opened'', ''experiment.gate_opened'', ''experiment.gate_overridden'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Evaluating conditions
-- ---------------------------------------------------------------------------

-- A uuid from text, or null when it is not one.
CREATE FUNCTION internal.gate_uuid(p_value text) RETURNS uuid
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE WHEN p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p_value::uuid END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_uuid(p_value text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.gate_uuid(p_value text) FROM PUBLIC;
--> statement-breakpoint

-- "P3", "P3 and P4", "P3, P4 and P5", "P3, P4, P5 and 2 more".
CREATE FUNCTION internal.gate_name_list(p_names text[]) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN coalesce(array_length(p_names, 1), 0) = 0 THEN ''
    WHEN array_length(p_names, 1) = 1 THEN p_names[1]
    WHEN array_length(p_names, 1) <= 3 THEN
      array_to_string(p_names[1:array_length(p_names, 1) - 1], ', ') || ' and ' || p_names[array_length(p_names, 1)]
    ELSE array_to_string(p_names[1:3], ', ') || ' and ' || (array_length(p_names, 1) - 3) || ' more'
  END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_name_list(p_names text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.gate_name_list(p_names text[]) FROM PUBLIC;
--> statement-breakpoint

-- Is this a list of conditions the gate knows how to check?
CREATE FUNCTION internal.gate_conditions_valid(p_conditions jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_c jsonb;
  v_kind text;
BEGIN
  IF p_conditions IS NULL OR jsonb_typeof(p_conditions) <> 'array'
     OR jsonb_array_length(p_conditions) NOT BETWEEN 1 AND 12 THEN
    RETURN false;
  END IF;
  FOR v_c IN SELECT value FROM jsonb_array_elements(p_conditions) LOOP
    IF jsonb_typeof(v_c) <> 'object' THEN
      RETURN false;
    END IF;
    v_kind := v_c->>'kind';
    IF v_kind = 'table_filled' THEN
      IF internal.gate_uuid(v_c->>'blockId') IS NULL
         OR (v_c ? 'column' AND jsonb_typeof(v_c->'column') <> 'string')
         OR (v_c ? 'minRows' AND (jsonb_typeof(v_c->'minRows') <> 'number'
                                  OR (v_c->>'minRows')::numeric NOT BETWEEN 1 AND 100000)) THEN
        RETURN false;
      END IF;
    ELSIF v_kind = 'step_done' THEN
      IF internal.gate_uuid(v_c->>'blockId') IS NULL THEN
        RETURN false;
      END IF;
    ELSIF v_kind = 'part_done' THEN
      IF internal.gate_uuid(v_c->>'partId') IS NULL THEN
        RETURN false;
      END IF;
    ELSIF v_kind = 'samples_linked' THEN
      IF v_c ? 'min' AND (jsonb_typeof(v_c->'min') <> 'number' OR (v_c->>'min')::numeric NOT BETWEEN 1 AND 100000) THEN
        RETURN false;
      END IF;
    ELSIF v_kind = 'field_set' THEN
      IF jsonb_typeof(v_c->'field') <> 'string' OR char_length(btrim(v_c->>'field')) NOT BETWEEN 1 AND 100 THEN
        RETURN false;
      END IF;
    ELSIF v_kind = 'date_reached' THEN
      IF (v_c->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RETURN false;
      END IF;
    ELSE
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_conditions_valid(p_conditions jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.gate_conditions_valid(p_conditions jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Check each condition of a gate against the experiment as it is now. Returns
-- one object per condition: {kind, met, soft, text, blockId?, partId?}. `text`
-- says what is missing in words and is empty once the condition is met. A date
-- condition is `soft`: it warns but never blocks.
CREATE FUNCTION internal.eval_gate_conditions(p_record_id uuid, p_conditions jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_c jsonb;
  v_kind text;
  v_met boolean;
  v_soft boolean;
  v_text text;
  v_block api.blocks;
  v_part api.experiment_parts;
  v_record api.records;
  v_label text;
  v_column text;
  v_idx integer;
  v_min integer;
  v_total integer;
  v_nonempty integer;
  v_filled integer;
  v_names text[];
  v_n integer;
  v_value text;
  v_instance jsonb;
  v_field_id text;
  v_first_field text;
BEGIN
  IF p_conditions IS NULL OR jsonb_typeof(p_conditions) <> 'array' THEN
    RETURN v_out;
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id;
  FOR v_c IN SELECT value FROM jsonb_array_elements(p_conditions) LOOP
    v_kind := v_c->>'kind';
    v_met := false;
    v_soft := false;
    v_text := '';
    v_block := NULL;
    v_part := NULL;

    IF v_kind = 'table_filled' THEN
      SELECT * INTO v_block FROM api.blocks
       WHERE record_id = p_record_id AND id = internal.gate_uuid(v_c->>'blockId') AND type IN ('table', 'sheet');
      v_column := nullif(btrim(coalesce(v_c->>'column', '')), '');
      v_min := CASE WHEN (v_c->>'minRows') ~ '^[0-9]+$' THEN (v_c->>'minRows')::integer ELSE 0 END;
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''),
                          nullif(btrim(coalesce(v_block.payload->>'title', '')), ''), 'The table');
      IF v_block.id IS NULL THEN
        v_text := 'A table this gate waits on has been removed';
      ELSE
        v_idx := NULL;
        v_total := 0; v_nonempty := 0; v_filled := 0; v_names := '{}';
        IF v_block.type = 'table' THEN
          IF v_column IS NOT NULL THEN
            SELECT c.ord::integer INTO v_idx
              FROM jsonb_array_elements_text(coalesce(v_block.payload->'columns', '[]'::jsonb)) WITH ORDINALITY AS c(name, ord)
             WHERE lower(btrim(c.name)) = lower(v_column) LIMIT 1;
          END IF;
          WITH grid AS (
            SELECT r.ord::integer AS ord,
                   coalesce(nullif(btrim(r.val->>0), ''), 'Row ' || r.ord) AS name,
                   CASE WHEN v_idx IS NULL THEN NULL ELSE nullif(btrim(coalesce(r.val->>(v_idx - 1), '')), '') END AS cell,
                   EXISTS (SELECT 1 FROM jsonb_array_elements_text(r.val) x WHERE btrim(x) <> '') AS any_cell
              FROM jsonb_array_elements(coalesce(v_block.payload->'rows', '[]'::jsonb)) WITH ORDINALITY AS r(val, ord)
             WHERE jsonb_typeof(r.val) = 'array')
          SELECT count(*)::integer, (count(*) FILTER (WHERE any_cell))::integer,
                 (count(*) FILTER (WHERE cell IS NOT NULL))::integer,
                 coalesce(array_agg(name ORDER BY ord) FILTER (WHERE cell IS NULL), '{}')
            INTO v_total, v_nonempty, v_filled, v_names FROM grid;
        ELSE
          v_instance := (SELECT i.state FROM api.sheet_instances i
                          WHERE i.id = internal.gate_uuid(v_block.payload->>'instanceId'));
          v_first_field := v_instance->'localFields'->0->>'fieldId';
          IF v_column IS NOT NULL THEN
            SELECT f.value->>'fieldId' INTO v_field_id
              FROM jsonb_array_elements(coalesce(v_instance->'localFields', '[]'::jsonb)) f
             WHERE lower(f.value->>'key') = lower(v_column) OR lower(btrim(f.value->>'label')) = lower(v_column)
             LIMIT 1;
            v_idx := CASE WHEN v_field_id IS NULL THEN NULL ELSE 1 END;
          END IF;
          WITH grid AS (
            SELECT row_number() OVER (ORDER BY coalesce(nullif(btrim(coalesce(r.value->>v_first_field, '')), ''), r.key))::integer AS ord,
                   coalesce(nullif(btrim(coalesce(r.value->>v_first_field, '')), ''), 'Row') AS name,
                   CASE WHEN v_field_id IS NULL THEN NULL ELSE nullif(btrim(coalesce(r.value->>v_field_id, '')), '') END AS cell,
                   EXISTS (SELECT 1 FROM jsonb_each_text(r.value) x WHERE btrim(coalesce(x.value, '')) <> '') AS any_cell
              FROM jsonb_each(coalesce(v_instance->'localValues', '{}'::jsonb)) AS r(key, value)
             WHERE jsonb_typeof(r.value) = 'object')
          SELECT count(*)::integer, (count(*) FILTER (WHERE any_cell))::integer,
                 (count(*) FILTER (WHERE cell IS NOT NULL))::integer,
                 coalesce(array_agg(CASE WHEN name = 'Row' THEN 'Row ' || ord ELSE name END ORDER BY ord) FILTER (WHERE cell IS NULL), '{}')
            INTO v_total, v_nonempty, v_filled, v_names FROM grid;
        END IF;
        IF v_column IS NOT NULL AND v_idx IS NULL THEN
          v_text := v_label || ' has no ' || v_column || ' column';
        ELSIF v_column IS NOT NULL AND v_min > 0 THEN
          v_met := v_filled >= v_min;
          IF NOT v_met THEN
            v_text := v_label || ' needs ' || v_min || ' ' || CASE WHEN v_min = 1 THEN 'row' ELSE 'rows' END
                      || ' with ' || v_column || ' (' || v_filled || ' so far)';
          END IF;
        ELSIF v_column IS NOT NULL THEN
          v_met := v_total > 0 AND v_filled = v_total;
          IF v_total = 0 THEN
            v_text := v_label || ' has no rows yet';
          ELSIF NOT v_met THEN
            v_text := internal.gate_name_list(v_names) || CASE WHEN cardinality(v_names) = 1 THEN ' has' ELSE ' have' END
                      || ' no ' || v_column;
          END IF;
        ELSE
          IF v_min <= 0 THEN v_min := 1; END IF;
          v_met := v_nonempty >= v_min;
          IF NOT v_met THEN
            v_text := v_label || ' needs at least ' || v_min || ' ' || CASE WHEN v_min = 1 THEN 'row' ELSE 'rows' END
                      || ' filled (' || v_nonempty || ' so far)';
          END IF;
        END IF;
      END IF;

    ELSIF v_kind = 'step_done' THEN
      SELECT * INTO v_block FROM api.blocks
       WHERE record_id = p_record_id AND type = 'procedure_step'
         AND (id = internal.gate_uuid(v_c->>'blockId') OR payload->>'sourceStepBlockId' = v_c->>'blockId')
       ORDER BY "order" LIMIT 1;
      IF v_block.id IS NULL THEN
        v_text := 'A step this gate waits on has been removed';
      ELSE
        v_met := coalesce(v_block.payload->>'completed', 'false') = 'true';
        IF NOT v_met THEN
          SELECT count(*)::integer INTO v_n FROM api.blocks s
           WHERE s.record_id = p_record_id AND s.type = 'procedure_step'
             AND s.part_id IS NOT DISTINCT FROM v_block.part_id AND s."order" <= v_block."order";
          v_text := 'Step ' || v_n || ' (' || left(coalesce(v_block.payload->>'text', ''), 40) || ') isn''t done';
        END IF;
      END IF;

    ELSIF v_kind = 'part_done' THEN
      SELECT * INTO v_part FROM api.experiment_parts
       WHERE record_id = p_record_id
         AND (id = internal.gate_uuid(v_c->>'partId') OR source_part_id = internal.gate_uuid(v_c->>'partId'))
       ORDER BY "position" LIMIT 1;
      IF v_part.id IS NULL THEN
        v_text := 'A part this gate waits on has been removed';
      ELSE
        v_met := v_part.completed_at IS NOT NULL;
        IF NOT v_met THEN
          SELECT count(*)::integer INTO v_n FROM api.experiment_parts x
           WHERE x.record_id = p_record_id AND (x."position", x.id) <= (v_part."position", v_part.id);
          v_text := 'Part ' || v_n || ' (' || v_part.title || ') isn''t done';
        END IF;
      END IF;

    ELSIF v_kind = 'samples_linked' THEN
      v_min := CASE WHEN (v_c->>'min') ~ '^[0-9]+$' THEN greatest((v_c->>'min')::integer, 1) ELSE 1 END;
      SELECT count(*)::integer INTO v_n FROM api.record_links
       WHERE source_record_id = p_record_id AND link_type = 'sample';
      v_met := v_n >= v_min;
      IF NOT v_met THEN
        v_text := CASE WHEN v_min = 1 THEN 'No sample is linked yet'
                       ELSE 'At least ' || v_min || ' samples must be linked (' || v_n || ' so far)' END;
      END IF;

    ELSIF v_kind = 'field_set' THEN
      v_column := btrim(coalesce(v_c->>'field', ''));
      v_value := CASE v_column
        WHEN 'reviewer' THEN v_record.reviewer_user_id
        WHEN 'assignee' THEN v_record.assignee_user_id
        WHEN 'planned_end' THEN v_record.planned_end::text
        ELSE coalesce(v_record.properties->>v_column, v_record.custom_fields->>v_column) END;
      v_met := nullif(btrim(coalesce(v_value, '')), '') IS NOT NULL;
      IF NOT v_met THEN
        v_text := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''), v_column) || ' isn''t set';
      END IF;

    ELSIF v_kind = 'date_reached' THEN
      v_soft := true;
      IF (v_c->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        v_met := current_date >= (v_c->>'date')::date;
        IF NOT v_met THEN
          v_text := 'Not before ' || to_char((v_c->>'date')::date, 'FMDD Mon YYYY');
        END IF;
      ELSE
        v_text := 'The date is not valid';
      END IF;

    ELSE
      v_text := 'Unknown condition';
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'kind', v_kind, 'met', v_met, 'soft', v_soft, 'text', v_text,
      'blockId', v_block.id, 'partId', v_part.id)));
  END LOOP;
  RETURN v_out;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.eval_gate_conditions(p_record_id uuid, p_conditions jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.eval_gate_conditions(p_record_id uuid, p_conditions jsonb) FROM PUBLIC;
--> statement-breakpoint

-- The whole gate: met when every condition is; `blocking` when a condition
-- that is not a date is unmet; `missing` is what is still to do, in words.
CREATE FUNCTION internal.gate_status(p_record_id uuid, p_conditions jsonb,
    OUT met boolean, OUT blocking boolean, OUT missing text[], OUT conditions jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  conditions := internal.eval_gate_conditions(p_record_id, p_conditions);
  met := NOT EXISTS (SELECT 1 FROM jsonb_array_elements(conditions) c WHERE (c.value->>'met') <> 'true');
  blocking := EXISTS (SELECT 1 FROM jsonb_array_elements(conditions) c
                       WHERE (c.value->>'met') <> 'true' AND (c.value->>'soft') <> 'true');
  missing := coalesce(ARRAY(SELECT c.value->>'text' FROM jsonb_array_elements(conditions) WITH ORDINALITY c(value, ord)
                             WHERE (c.value->>'met') <> 'true' ORDER BY c.ord), '{}');
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.gate_status(p_record_id uuid, p_conditions jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.gate_status(p_record_id uuid, p_conditions jsonb) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reading the gates of an experiment
-- ---------------------------------------------------------------------------

-- Every gate of an experiment in page order: the "opens when" rule of each part,
-- then the gate blocks. `blocking` is true when the gate holds work back now:
-- it is unmet, it is set to block, and it has not been gone past.
CREATE FUNCTION api.record_gates(p_record_id uuid)
  RETURNS TABLE (
    gate_id text, gate_kind text, block_id uuid, part_id uuid, part_number integer,
    label text, mode text, met boolean, blocking boolean,
    overridden boolean, overridden_at timestamptz, overridden_by_user_id text, override_reason text,
    missing text[], conditions jsonb, from_template boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_gate record;
  v_status record;
  v_override api.gate_overrides;
BEGIN
  IF api.current_user_id() IS NULL OR NOT EXISTS (
       SELECT 1 FROM api.records r
        WHERE r.id = p_record_id AND r.workspace_id = api.current_workspace_id() AND r.deleted_at IS NULL)
     OR NOT internal.can_access_object('record', p_record_id, 'view') THEN
    RETURN;
  END IF;
  FOR v_gate IN
    SELECT 'part:' || p.id::text AS gate_id, 'part'::text AS gate_kind, NULL::uuid AS block_id, p.id AS part_id,
           (SELECT count(*)::integer FROM api.experiment_parts x
             WHERE x.record_id = p.record_id AND (x."position", x.id) <= (p."position", p.id)) AS part_number,
           'Part ' || (SELECT count(*) FROM api.experiment_parts x
                        WHERE x.record_id = p.record_id AND (x."position", x.id) <= (p."position", p.id)) AS label,
           p.gate_mode AS mode, p.opens_when AS conds, p.gate_from_template AS from_template,
           p."position" AS sort_a, 0::real AS sort_b
      FROM api.experiment_parts p
     WHERE p.record_id = p_record_id AND p.opens_when IS NOT NULL
    UNION ALL
    SELECT 'block:' || b.id::text, 'block', b.id, b.part_id,
           (SELECT count(*)::integer FROM api.experiment_parts x JOIN api.experiment_parts bp ON bp.id = b.part_id
             WHERE x.record_id = b.record_id AND (x."position", x.id) <= (bp."position", bp.id)),
           coalesce(nullif(btrim(coalesce(b.payload->>'label', '')), ''), 'Gate'),
           coalesce(b.payload->>'mode', 'warn'), b.payload->'conditions',
           coalesce(b.payload->>'fromTemplate', 'false') = 'true',
           coalesce((SELECT bp."position" FROM api.experiment_parts bp WHERE bp.id = b.part_id), 0), b."order"
      FROM api.blocks b
     WHERE b.record_id = p_record_id AND b.type = 'gate' AND coalesce(b.payload->>'pending', 'false') <> 'true'
     ORDER BY sort_a, sort_b
  LOOP
    SELECT * INTO v_status FROM internal.gate_status(p_record_id, v_gate.conds);
    SELECT * INTO v_override FROM api.gate_overrides o
     WHERE (v_gate.block_id IS NOT NULL AND o.block_id = v_gate.block_id)
        OR (v_gate.part_id IS NOT NULL AND v_gate.block_id IS NULL AND o.part_id = v_gate.part_id);
    gate_id := v_gate.gate_id;
    gate_kind := v_gate.gate_kind;
    block_id := v_gate.block_id;
    part_id := v_gate.part_id;
    part_number := v_gate.part_number;
    label := v_gate.label;
    mode := v_gate.mode;
    met := v_status.met;
    blocking := NOT v_status.met AND v_status.blocking AND v_gate.mode = 'block';
    overridden := v_override.id IS NOT NULL;
    overridden_at := v_override.created_at;
    overridden_by_user_id := v_override.created_by_user_id;
    override_reason := v_override.reason;
    missing := v_status.missing;
    conditions := v_status.conditions;
    from_template := v_gate.from_template;
    RETURN NEXT;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_gates(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_gates(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_gates(p_record_id uuid) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_gates(p_record_id uuid) TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

-- A gate opens (change: opened) or is gone past (change: overridden).
CREATE FUNCTION internal.emit_gate_event(p_record_id uuid, p_block_id uuid, p_part_id uuid,
    p_entity_type text, p_change text, p_reason text, p_missing text[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_block api.blocks;
  v_part api.experiment_parts;
  v_number integer;
  v_part_id uuid := p_part_id;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id;
  IF v_record.id IS NULL THEN
    RETURN;
  END IF;
  IF p_block_id IS NOT NULL THEN
    SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id;
    v_part_id := v_block.part_id;
  END IF;
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = v_part_id;
  IF v_part.id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_number FROM api.experiment_parts
     WHERE record_id = p_record_id AND ("position", id) <= (v_part."position", v_part.id);
  END IF;
  PERFORM internal.emit_change_event(v_record.workspace_id, p_entity_type, coalesce(p_block_id, p_part_id), 'create',
    p_record_id, v_record.project_id,
    jsonb_strip_nulls(jsonb_build_object('change', p_change,
      'gateId', CASE WHEN p_block_id IS NOT NULL THEN 'block:' || p_block_id::text ELSE 'part:' || p_part_id::text END,
      'gate', CASE WHEN p_block_id IS NOT NULL THEN coalesce(nullif(btrim(coalesce(v_block.payload->>'label', '')), ''), 'Gate')
                   ELSE 'Part ' || v_number END,
      'mode', CASE WHEN p_block_id IS NOT NULL THEN coalesce(v_block.payload->>'mode', 'warn') ELSE v_part.gate_mode END,
      'blockId', p_block_id, 'partId', v_part_id, 'partNumber', v_number, 'part', v_part.title,
      'recordId', p_record_id, 'identifier', v_record.identifier, 'title', v_record.title,
      'reason', p_reason, 'missing', to_jsonb(p_missing),
      'userId', api.current_user_id())));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_gate_event(p_record_id uuid, p_block_id uuid, p_part_id uuid, p_entity_type text, p_change text, p_reason text, p_missing text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.emit_gate_event(p_record_id uuid, p_block_id uuid, p_part_id uuid, p_entity_type text, p_change text, p_reason text, p_missing text[]) FROM PUBLIC;
--> statement-breakpoint

-- Bring the record of which gates are open in line with the experiment, and
-- tell the change feed about each gate that has just opened. A gate that closes
-- again forgets it was open, so it can open once more later.
CREATE FUNCTION internal.refresh_record_gates(p_record_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_gate record;
  v_status record;
  v_inserted integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.records WHERE id = p_record_id) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.blocks WHERE record_id = p_record_id AND type = 'gate')
     AND NOT EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = p_record_id AND opens_when IS NOT NULL) THEN
    RETURN;
  END IF;
  FOR v_gate IN
    SELECT NULL::uuid AS block_id, p.id AS part_id, p.opens_when AS conds
      FROM api.experiment_parts p WHERE p.record_id = p_record_id AND p.opens_when IS NOT NULL
    UNION ALL
    SELECT b.id, NULL::uuid, b.payload->'conditions'
      FROM api.blocks b
     WHERE b.record_id = p_record_id AND b.type = 'gate' AND coalesce(b.payload->>'pending', 'false') <> 'true'
  LOOP
    SELECT * INTO v_status FROM internal.gate_status(p_record_id, v_gate.conds);
    IF v_status.met THEN
      IF v_gate.block_id IS NOT NULL THEN
        INSERT INTO internal.gate_states (record_id, block_id) VALUES (p_record_id, v_gate.block_id)
          ON CONFLICT (block_id) WHERE block_id IS NOT NULL DO NOTHING;
      ELSE
        INSERT INTO internal.gate_states (record_id, part_id) VALUES (p_record_id, v_gate.part_id)
          ON CONFLICT (part_id) WHERE part_id IS NOT NULL DO NOTHING;
      END IF;
      GET DIAGNOSTICS v_inserted = ROW_COUNT;
      IF v_inserted > 0 THEN
        PERFORM internal.emit_gate_event(p_record_id, v_gate.block_id, v_gate.part_id, 'gate_opening', 'opened', NULL, NULL);
      END IF;
    ELSE
      DELETE FROM internal.gate_states
       WHERE (v_gate.block_id IS NOT NULL AND block_id = v_gate.block_id)
          OR (v_gate.part_id IS NOT NULL AND part_id = v_gate.part_id);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refresh_record_gates(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.refresh_record_gates(p_record_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.trg_refresh_gates_from_block() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM internal.refresh_record_gates(OLD.record_id);
  ELSE
    PERFORM internal.refresh_record_gates(NEW.record_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_block() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_block() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_insert AFTER INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type IN ('gate', 'table', 'procedure_step', 'sheet'))
  EXECUTE FUNCTION internal.trg_refresh_gates_from_block();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_update AFTER UPDATE ON api.blocks
  FOR EACH ROW WHEN (NEW.type IN ('gate', 'table', 'procedure_step', 'sheet') AND OLD.payload IS DISTINCT FROM NEW.payload)
  EXECUTE FUNCTION internal.trg_refresh_gates_from_block();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_delete AFTER DELETE ON api.blocks
  FOR EACH ROW WHEN (OLD.type IN ('gate', 'table', 'procedure_step', 'sheet'))
  EXECUTE FUNCTION internal.trg_refresh_gates_from_block();
--> statement-breakpoint

CREATE FUNCTION internal.trg_refresh_gates_from_part() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.refresh_record_gates(NEW.record_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_part() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_part() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_part AFTER UPDATE OF completed_at, opens_when, gate_mode ON api.experiment_parts
  FOR EACH ROW EXECUTE FUNCTION internal.trg_refresh_gates_from_part();
--> statement-breakpoint

CREATE FUNCTION internal.trg_refresh_gates_from_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM internal.refresh_record_gates(OLD.source_record_id);
  ELSE
    PERFORM internal.refresh_record_gates(NEW.source_record_id);
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_link() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_link() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_link_insert AFTER INSERT ON api.record_links
  FOR EACH ROW WHEN (NEW.link_type = 'sample') EXECUTE FUNCTION internal.trg_refresh_gates_from_link();
--> statement-breakpoint
CREATE TRIGGER refresh_gates_link_delete AFTER DELETE ON api.record_links
  FOR EACH ROW WHEN (OLD.link_type = 'sample') EXECUTE FUNCTION internal.trg_refresh_gates_from_link();
--> statement-breakpoint

CREATE FUNCTION internal.trg_refresh_gates_from_record() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.refresh_record_gates(NEW.id);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_record() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_record() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_record AFTER UPDATE OF reviewer_user_id, assignee_user_id, planned_end, properties, custom_fields ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.trg_refresh_gates_from_record();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enforcing a gate that blocks
-- ---------------------------------------------------------------------------

-- Refuse a write in a part or below a gate while the gate that holds it back is
-- closed. Only a gate set to block counts, and a date condition on its own
-- never blocks. SB150 is the error code.
CREATE FUNCTION internal.assert_gates_open(p_record_id uuid, p_part_id uuid, p_order real, p_block_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_gate api.blocks;
  v_status record;
  v_number integer;
BEGIN
  IF p_part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id;
    IF v_part.id IS NOT NULL AND v_part.opens_when IS NOT NULL AND v_part.gate_mode = 'block' THEN
      SELECT * INTO v_status FROM internal.gate_status(p_record_id, v_part.opens_when);
      IF NOT v_status.met AND v_status.blocking THEN
        SELECT count(*)::integer INTO v_number FROM api.experiment_parts
         WHERE record_id = p_record_id AND ("position", id) <= (v_part."position", v_part.id);
        RAISE EXCEPTION 'Part % is not open yet: %', v_number, array_to_string(v_status.missing, '; ')
          USING ERRCODE = 'SB150', DETAIL = array_to_string(v_status.missing, '; ');
      END IF;
    END IF;
  END IF;
  FOR v_gate IN
    SELECT * FROM api.blocks g
     WHERE g.record_id = p_record_id AND g.type = 'gate'
       AND g.part_id IS NOT DISTINCT FROM p_part_id
       AND g."order" < p_order AND g.id IS DISTINCT FROM p_block_id
       AND g.payload->>'mode' = 'block' AND coalesce(g.payload->>'pending', 'false') <> 'true'
     ORDER BY g."order"
  LOOP
    SELECT * INTO v_status FROM internal.gate_status(p_record_id, v_gate.payload->'conditions');
    IF NOT v_status.met AND v_status.blocking THEN
      RAISE EXCEPTION 'This is behind a gate that is not open yet: %', array_to_string(v_status.missing, '; ')
        USING ERRCODE = 'SB150', DETAIL = array_to_string(v_status.missing, '; ');
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.assert_gates_open(p_record_id uuid, p_part_id uuid, p_order real, p_block_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.assert_gates_open(p_record_id uuid, p_part_id uuid, p_order real, p_block_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.enforce_block_gates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_before integer;
BEGIN
  IF NEW.type = 'gate' THEN
    IF coalesce(NEW.payload->>'pending', 'false') = 'true' THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.payload IS NOT DISTINCT FROM NEW.payload THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND coalesce(OLD.payload->>'fromTemplate', 'false') = 'true'
       AND (OLD.payload->'conditions' IS DISTINCT FROM NEW.payload->'conditions'
            OR OLD.payload->>'mode' IS DISTINCT FROM NEW.payload->>'mode'
            OR coalesce(NEW.payload->>'fromTemplate', 'false') <> 'true') THEN
      RAISE EXCEPTION 'This gate comes from the template and cannot be changed here' USING ERRCODE = 'SB152';
    END IF;
    IF NOT internal.gate_conditions_valid(NEW.payload->'conditions')
       OR coalesce(NEW.payload->>'mode', '') NOT IN ('warn', 'block') THEN
      RAISE EXCEPTION 'A gate needs between 1 and 12 conditions it can check, and a mode of warn or block'
        USING ERRCODE = 'SB153';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.payload IS NOT DISTINCT FROM NEW.payload THEN
    RETURN NEW;
  END IF;
  -- Steps in order: a step is not done before the ones above it in its part.
  IF NEW.type = 'procedure_step' AND NEW.part_id IS NOT NULL
     AND coalesce(NEW.payload->>'completed', 'false') = 'true'
     AND (TG_OP = 'INSERT' OR coalesce(OLD.payload->>'completed', 'false') <> 'true') THEN
    SELECT * INTO v_part FROM api.experiment_parts WHERE id = NEW.part_id;
    IF v_part.steps_in_order THEN
      SELECT count(*)::integer INTO v_before FROM api.blocks s
       WHERE s.part_id = NEW.part_id AND s.type = 'procedure_step' AND s."order" < NEW."order"
         AND coalesce(s.payload->>'completed', 'false') <> 'true';
      IF v_before > 0 THEN
        RAISE EXCEPTION 'Steps in this part are done in order: finish the earlier steps first' USING ERRCODE = 'SB151';
      END IF;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM api.blocks g WHERE g.record_id = NEW.record_id AND g.type = 'gate')
     OR (NEW.part_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM api.experiment_parts p WHERE p.id = NEW.part_id AND p.opens_when IS NOT NULL)) THEN
    PERFORM internal.assert_gates_open(NEW.record_id, NEW.part_id, NEW."order", NEW.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_block_gates() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enforce_block_gates() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER enforce_block_gates BEFORE INSERT OR UPDATE OF payload ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_block_gates();
--> statement-breakpoint

-- A gate a template or protocol put there stays.
CREATE FUNCTION internal.keep_template_gates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF coalesce(OLD.payload->>'fromTemplate', 'false') = 'true'
     AND EXISTS (SELECT 1 FROM api.records WHERE id = OLD.record_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'This gate comes from the template and cannot be removed here' USING ERRCODE = 'SB152';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.keep_template_gates() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.keep_template_gates() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER keep_template_gates BEFORE DELETE ON api.blocks
  FOR EACH ROW WHEN (OLD.type = 'gate') EXECUTE FUNCTION internal.keep_template_gates();
--> statement-breakpoint

-- Finishing a part that is not open (by hand, for a part with no steps).
CREATE FUNCTION internal.enforce_part_gate() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_status record;
  v_number integer;
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL
     AND NEW.opens_when IS NOT NULL AND NEW.gate_mode = 'block' THEN
    SELECT * INTO v_status FROM internal.gate_status(NEW.record_id, NEW.opens_when);
    IF NOT v_status.met AND v_status.blocking THEN
      SELECT count(*)::integer INTO v_number FROM api.experiment_parts
       WHERE record_id = NEW.record_id AND ("position", id) <= (NEW."position", NEW.id);
      RAISE EXCEPTION 'Part % is not open yet: %', v_number, array_to_string(v_status.missing, '; ')
        USING ERRCODE = 'SB150', DETAIL = array_to_string(v_status.missing, '; ');
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_part_gate() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enforce_part_gate() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER enforce_part_gate BEFORE UPDATE OF completed_at ON api.experiment_parts
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_part_gate();
--> statement-breakpoint

-- Cells of a sheet are not blocks, so a sheet below a gate is checked when its
-- cells change, and a sheet some gate waits on is looked at again.
CREATE FUNCTION internal.enforce_sheet_gates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_block api.blocks;
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NEW;
  END IF;
  FOR v_block IN
    SELECT * FROM api.blocks b WHERE b.type = 'sheet' AND b.payload->>'instanceId' = NEW.id::text
  LOOP
    IF EXISTS (SELECT 1 FROM api.blocks g WHERE g.record_id = v_block.record_id AND g.type = 'gate')
       OR (v_block.part_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM api.experiment_parts p WHERE p.id = v_block.part_id AND p.opens_when IS NOT NULL)) THEN
      PERFORM internal.assert_gates_open(v_block.record_id, v_block.part_id, v_block."order", v_block.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_sheet_gates() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enforce_sheet_gates() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER enforce_sheet_gates BEFORE UPDATE OF state ON api.sheet_instances
  FOR EACH ROW EXECUTE FUNCTION internal.enforce_sheet_gates();
--> statement-breakpoint

CREATE FUNCTION internal.trg_refresh_gates_from_sheet() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record uuid;
BEGIN
  IF NEW.state IS NOT DISTINCT FROM OLD.state THEN
    RETURN NULL;
  END IF;
  FOR v_record IN
    SELECT DISTINCT b.record_id FROM api.blocks b WHERE b.type = 'sheet' AND b.payload->>'instanceId' = NEW.id::text
  LOOP
    PERFORM internal.refresh_record_gates(v_record);
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_refresh_gates_from_sheet() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_refresh_gates_from_sheet() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER refresh_gates_sheet AFTER UPDATE OF state ON api.sheet_instances
  FOR EACH ROW EXECUTE FUNCTION internal.trg_refresh_gates_from_sheet();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Set, change or clear the rule that opens a part: the conditions (null or an
-- empty list clears it), whether it warns or blocks, and whether the steps of
-- the part are done in order. Gates from a template stay as they are.
CREATE FUNCTION api.set_part_gate(p_part_id uuid, p_conditions jsonb DEFAULT NULL, p_gate_mode text DEFAULT NULL,
    p_steps_in_order boolean DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_conditions jsonb := CASE WHEN p_conditions IS NULL OR p_conditions = 'null'::jsonb OR p_conditions = '[]'::jsonb
                             THEN NULL ELSE p_conditions END;
  v_mode text := coalesce(p_gate_mode, 'warn');
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id FOR UPDATE;
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.part_write_record(v_part.record_id);
  IF v_part.gate_from_template THEN
    RAISE EXCEPTION 'This gate comes from the template and cannot be changed here' USING ERRCODE = 'SB152';
  END IF;
  IF v_mode NOT IN ('warn', 'block') THEN
    RAISE EXCEPTION 'a gate warns or blocks' USING ERRCODE = 'SB153';
  END IF;
  IF v_conditions IS NOT NULL AND NOT internal.gate_conditions_valid(v_conditions) THEN
    RAISE EXCEPTION 'A gate needs between 1 and 12 conditions it can check' USING ERRCODE = 'SB153';
  END IF;
  UPDATE api.experiment_parts
     SET opens_when = v_conditions,
         gate_mode = CASE WHEN v_conditions IS NULL THEN 'warn' ELSE coalesce(p_gate_mode, gate_mode) END,
         steps_in_order = coalesce(p_steps_in_order, steps_in_order),
         updated_by_user_id = api.current_user_id()
   WHERE id = p_part_id RETURNING * INTO v_part;
  IF v_conditions IS NULL THEN
    DELETE FROM api.gate_overrides WHERE part_id = p_part_id;
    DELETE FROM internal.gate_states WHERE part_id = p_part_id;
  END IF;
  PERFORM internal.refresh_record_gates(v_part.record_id);
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id;
  RETURN to_jsonb(v_part);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_part_gate(p_part_id uuid, p_conditions jsonb, p_gate_mode text, p_steps_in_order boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_part_gate(p_part_id uuid, p_conditions jsonb, p_gate_mode text, p_steps_in_order boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_part_gate(p_part_id uuid, p_conditions jsonb, p_gate_mode text, p_steps_in_order boolean) TO authenticated;
--> statement-breakpoint

-- Go on past a gate that warns, with a reason. Name the gate block or the part.
-- A gate that blocks cannot be gone past. The reason stays with the experiment
-- and the reviewer sees it.
CREATE FUNCTION api.override_gate(p_gate_block_id uuid DEFAULT NULL, p_gate_part_id uuid DEFAULT NULL, p_reason text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_block api.blocks;
  v_part api.experiment_parts;
  v_record_id uuid;
  v_conds jsonb;
  v_mode text;
  v_label text;
  v_status record;
  v_row api.gate_overrides;
  v_workspace uuid;
BEGIN
  IF (p_gate_block_id IS NULL) = (p_gate_part_id IS NULL) THEN
    RAISE EXCEPTION 'name the gate block or the part' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'say why you are going on' USING ERRCODE = 'SB154';
  END IF;
  IF p_gate_block_id IS NOT NULL THEN
    SELECT * INTO v_block FROM api.blocks WHERE id = p_gate_block_id AND type = 'gate';
    IF v_block.id IS NULL THEN
      RAISE EXCEPTION 'gate not found' USING ERRCODE = '42501';
    END IF;
    v_record_id := v_block.record_id;
    v_conds := v_block.payload->'conditions';
    v_mode := coalesce(v_block.payload->>'mode', 'warn');
    v_label := coalesce(nullif(btrim(coalesce(v_block.payload->>'label', '')), ''), 'Gate');
  ELSE
    SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_gate_part_id AND opens_when IS NOT NULL;
    IF v_part.id IS NULL THEN
      RAISE EXCEPTION 'gate not found' USING ERRCODE = '42501';
    END IF;
    v_record_id := v_part.record_id;
    v_conds := v_part.opens_when;
    v_mode := v_part.gate_mode;
    v_label := 'Part ' || (SELECT count(*) FROM api.experiment_parts x
                            WHERE x.record_id = v_part.record_id AND (x."position", x.id) <= (v_part."position", v_part.id));
  END IF;
  PERFORM internal.part_write_record(v_record_id);
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = v_record_id;
  IF v_mode = 'block' THEN
    RAISE EXCEPTION 'This gate blocks until it is met: it cannot be gone past' USING ERRCODE = 'SB155';
  END IF;
  SELECT * INTO v_row FROM api.gate_overrides
   WHERE (p_gate_block_id IS NOT NULL AND block_id = p_gate_block_id) OR (p_gate_part_id IS NOT NULL AND part_id = p_gate_part_id);
  IF v_row.id IS NULL THEN
    SELECT * INTO v_status FROM internal.gate_status(v_record_id, v_conds);
    IF v_status.met THEN
      RAISE EXCEPTION 'This gate is already open' USING ERRCODE = 'SB156';
    END IF;
    INSERT INTO api.gate_overrides (workspace_id, record_id, block_id, part_id, label, missing, reason, created_by_user_id)
    VALUES (v_workspace, v_record_id, p_gate_block_id, p_gate_part_id, v_label, v_status.missing, v_reason, api.current_user_id())
    RETURNING * INTO v_row;
    PERFORM internal.emit_gate_event(v_record_id, p_gate_block_id, p_gate_part_id, 'gate_override', 'overridden', v_reason, v_status.missing);
  END IF;
  RETURN to_jsonb(v_row);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.override_gate(p_gate_block_id uuid, p_gate_part_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.override_gate(p_gate_block_id uuid, p_gate_part_id uuid, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.override_gate(p_gate_block_id uuid, p_gate_part_id uuid, p_reason text) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Templates and protocols carry gates
-- ---------------------------------------------------------------------------

-- A notebook template part may carry opensWhen, gateMode and stepsInOrder, and
-- a template may place a gate block. The database's check of a template
-- configuration learns both.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.validate_notebook_template_configuration(uuid,jsonb)'::regprocedure) INTO v_def;
  v_def := replace(v_def,
    'ARRAY[''id'',''title'',''dayOffset''], ARRAY[''id'',''title'',''dayOffset''], ''parts''',
    'ARRAY[''id'',''title'',''dayOffset''], ARRAY[''id'',''title'',''dayOffset'',''opensWhen'',''gateMode'',''stepsInOrder''], ''parts''');
  v_def := replace(v_def,
    '''procedure_step'',''protocol_reference'',''materials''',
    '''procedure_step'',''protocol_reference'',''materials'',''gate''');
  IF position('''opensWhen'',''gateMode''' IN v_def) = 0 OR position('''materials'',''gate''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'could not patch internal.validate_notebook_template_configuration';
  END IF;
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- A part that comes from a protocol part brings the protocol's gate with it.
CREATE OR REPLACE FUNCTION internal.assign_block_part() RETURNS trigger
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
          (workspace_id, record_id, "position", title, day_offset, source_part_id, created_by_user_id,
           opens_when, gate_mode, steps_in_order, gate_from_template)
        SELECT r.workspace_id, NEW.record_id,
               coalesce((SELECT max(x."position") FROM api.experiment_parts x WHERE x.record_id = NEW.record_id), 0) + 1,
               v_source_part.title, v_source_part.day_offset, v_source_part.id, api.current_user_id(),
               v_source_part.opens_when, v_source_part.gate_mode, v_source_part.steps_in_order,
               (v_source_part.opens_when IS NOT NULL OR v_source_part.steps_in_order)
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

-- An experiment made from a template takes the template's gates: the rule on
-- each part, and each gate block, with the blocks it waits on pointed at the
-- experiment's own. They are marked as coming from the template.
CREATE OR REPLACE FUNCTION internal.apply_template_parts() RETURNS trigger
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
  v_blocks jsonb := '{}'::jsonb;
  v_entry jsonb;
  v_placement jsonb;
  v_part_id uuid;
  v_opens jsonb;
  v_gate api.blocks;
  v_conds jsonb;
BEGIN
  SELECT configuration INTO v_config FROM api.notebook_template_versions WHERE id = NEW.template_version_id;
  IF v_config IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_record FROM api.records WHERE id = NEW.record_id;
  IF v_record.id IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(v_config->'parts') = 'array' AND jsonb_array_length(v_config->'parts') > 0
     AND NOT EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = NEW.record_id) THEN
    FOR v_part IN SELECT value FROM jsonb_array_elements(v_config->'parts') LOOP
      v_n := v_n + 1;
      v_opens := CASE WHEN internal.gate_conditions_valid(v_part->'opensWhen') THEN v_part->'opensWhen' END;
      INSERT INTO api.experiment_parts
        (workspace_id, record_id, "position", title, day_offset, source_part_id, created_by_user_id,
         opens_when, gate_mode, steps_in_order, gate_from_template)
      VALUES (v_record.workspace_id, NEW.record_id, v_n,
              left(btrim(coalesce(v_part->>'title', 'Part ' || v_n)), 200),
              CASE WHEN (v_part->>'dayOffset') ~ '^[0-9]+$' THEN least((v_part->>'dayOffset')::integer, 3650) ELSE 0 END,
              CASE WHEN (v_part->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   THEN (v_part->>'id')::uuid END,
              NEW.actor_user_id,
              v_opens,
              CASE WHEN v_part->>'gateMode' = 'block' THEN 'block' ELSE 'warn' END,
              coalesce(v_part->>'stepsInOrder', 'false') = 'true',
              (v_opens IS NOT NULL OR coalesce(v_part->>'stepsInOrder', 'false') = 'true'))
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
  END IF;
  -- Point the gates at the experiment's own blocks. A template names the
  -- blocks it waits on by their place in the template.
  FOR v_entry IN SELECT value FROM jsonb_array_elements(coalesce(NEW.result->'composition', '[]'::jsonb)) LOOP
    IF (v_entry->>'placementId') IS NOT NULL AND (v_entry->>'blockId') IS NOT NULL THEN
      v_blocks := v_blocks || jsonb_build_object(v_entry->>'placementId', v_entry->>'blockId');
    END IF;
  END LOOP;
  FOR v_gate IN
    SELECT * FROM api.blocks g
     WHERE g.record_id = NEW.record_id AND g.type = 'gate' AND coalesce(g.payload->>'pending', 'false') = 'true'
  LOOP
    v_conds := coalesce((
      SELECT jsonb_agg(CASE WHEN c.value ? 'blockId' AND v_blocks ? (c.value->>'blockId')
                            THEN jsonb_set(c.value, '{blockId}', to_jsonb(v_blocks->>(c.value->>'blockId')))
                            ELSE c.value END ORDER BY c.ord)
        FROM jsonb_array_elements(coalesce(v_gate.payload->'conditions', '[]'::jsonb)) WITH ORDINALITY c(value, ord)), '[]'::jsonb);
    UPDATE api.blocks
       SET payload = (v_gate.payload - 'pending') || jsonb_build_object('conditions', v_conds, 'fromTemplate', true),
           version = version + 1
     WHERE id = v_gate.id;
  END LOOP;
  FOR v_new IN SELECT * FROM api.experiment_parts WHERE record_id = NEW.record_id AND opens_when IS NOT NULL LOOP
    v_conds := (
      SELECT jsonb_agg(CASE WHEN c.value ? 'blockId' AND v_blocks ? (c.value->>'blockId')
                            THEN jsonb_set(c.value, '{blockId}', to_jsonb(v_blocks->>(c.value->>'blockId')))
                            ELSE c.value END ORDER BY c.ord)
        FROM jsonb_array_elements(v_new.opens_when) WITH ORDINALITY c(value, ord));
    IF v_conds IS DISTINCT FROM v_new.opens_when THEN
      UPDATE api.experiment_parts SET opens_when = v_conds WHERE id = v_new.id;
    END IF;
  END LOOP;
  PERFORM internal.refresh_record_gates(NEW.record_id);
  RETURN NEW;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Gates that wait on a date
-- ---------------------------------------------------------------------------

-- A date has no change to hear about, so the sweep looks at the gates that wait
-- on one and have not opened yet.
CREATE FUNCTION internal.sweep_gates() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record uuid;
  v_count integer := 0;
BEGIN
  FOR v_record IN
    SELECT DISTINCT x.record_id FROM (
      SELECT b.record_id FROM api.blocks b
       WHERE b.type = 'gate' AND b.payload::text LIKE '%date_reached%'
         AND NOT EXISTS (SELECT 1 FROM internal.gate_states s WHERE s.block_id = b.id)
      UNION ALL
      SELECT p.record_id FROM api.experiment_parts p
       WHERE p.opens_when IS NOT NULL AND p.opens_when::text LIKE '%date_reached%'
         AND NOT EXISTS (SELECT 1 FROM internal.gate_states s WHERE s.part_id = p.id)
    ) x
    LIMIT 200
  LOOP
    PERFORM internal.refresh_record_gates(v_record);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sweep_gates() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sweep_gates() FROM PUBLIC;
--> statement-breakpoint

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
        (workspace_id, user_id, event_type, title, body, record_id, dedupe_tag)
      VALUES (v_timer.workspace_id, v_timer.user_id, 'step_timer',
              'Timer finished', v_timer.label, v_timer.record_id,
              'step-timer-' || v_timer.id::text);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  v_count := v_count + internal.sweep_part_reminders();
  v_count := v_count + internal.sweep_gates();
  RETURN v_count;
END $$;
--> statement-breakpoint
-- A gate is found by its name and the words of what it waits on.
CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text text := '';
  v_id uuid;
  v_ref text;
BEGIN
  CASE p_type
    WHEN 'rich_text' THEN
      v_text := internal.rich_text_plain(v_p -> 'doc');

    WHEN 'checklist' THEN
      v_text := internal.jsonb_path_text(v_p, '$.items[*].text');

    WHEN 'callout' THEN
      v_text := coalesce(v_p ->> 'text', '');

    WHEN 'conclusion' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'basis',
        replace(coalesce(v_p ->> 'verdict', ''), '_', ' '));

    WHEN 'metric' THEN
      v_text := concat_ws(' ', v_p ->> 'label', v_p ->> 'value', v_p ->> 'unit',
        v_p ->> 'provenance');

    WHEN 'table' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.columns[*]'),
        internal.jsonb_path_text(v_p, '$.rows[*][*]'));

    WHEN 'procedure_step' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'note');

    WHEN 'signature_request' THEN
      v_text := concat_ws(' ', v_p ->> 'requestedUserName',
        replace(coalesce(v_p ->> 'meaning', ''), '-', ' '), v_p ->> 'note');

    WHEN 'corrective_actions' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].action'),
        internal.jsonb_path_text(v_p, '$.items[*].ownerName'),
        replace(internal.jsonb_path_text(v_p, '$.items[*].status'), '-', ' '));

    WHEN 'materials' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].identifier'),
        internal.jsonb_path_text(v_p, '$.items[*].title'),
        internal.jsonb_path_text(v_p, '$.items[*].note'),
        internal.jsonb_path_text(v_p, '$.items[*].unit.symbol'));

    WHEN 'linked_record' THEN
      v_text := concat_ws(' ', v_p ->> 'targetIdentifier', v_p ->> 'label',
        replace(coalesce(v_p ->> 'linkType', ''), '_', ' '), v_p ->> 'targetKind');
      v_id := internal.search_uuid(v_p ->> 'targetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', r.identifier, r.title) INTO v_ref
          FROM api.records r
         WHERE r.id = v_id AND r.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, r.project_id);
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'protocol_reference' THEN
      v_text := concat_ws(' ', v_p ->> 'protocolIdentifier', v_p ->> 'protocolTitle',
        v_p ->> 'version', replace(coalesce(v_p ->> 'approvalStatus', ''), '_', ' '));

    WHEN 'file' THEN
      v_text := concat_ws(' ', v_p ->> 'displayName', v_p ->> 'fileIdentifier',
        v_p ->> 'mediaType');
      v_id := internal.search_uuid(v_p ->> 'fileRecordId');
      IF v_id IS NOT NULL THEN
        -- What is written inside the attached file, so a notebook is found by
        -- the report it attaches. Only the version the block shows (its
        -- fileVersion, else the newest), capped, and only from a file in the
        -- notebook's own project.
        SELECT left(fo.extracted_text, 100000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id)
         ORDER BY (fo.version = internal.search_int(v_p ->> 'fileVersion')) DESC NULLS LAST,
                  fo.version DESC
         LIMIT 1;
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'sheet' THEN
      v_id := internal.search_uuid(v_p ->> 'instanceId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', si.display_id, si.name,
                 internal.jsonb_path_text(si.state, '$.localFields[*].label'))
          INTO v_text
          FROM api.sheet_instances si
         WHERE si.id = v_id AND si.lifecycle IN ('active', 'archived')
           AND internal.search_scope_ok(p_record_id, si.project_id);
      END IF;

    WHEN 'chart' THEN
      v_text := concat_ws(' ', v_p ->> 'title',
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.label'),
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.unit'),
        internal.jsonb_path_text(v_p, '$.spec.display.series[*].label'),
        internal.jsonb_path_text(v_p, '$.spec.display.annotations[*].label'),
        v_p #>> '{spec,display,caption}');
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.datasets[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT f.label, ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.fields.*.fieldId') x
        JOIN api.dataset_schema_version_fields f ON f.field_id = internal.search_uuid(x #>> '{}');

    WHEN 'analysis' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        v_p #>> '{frozen,definitionName}',
        internal.jsonb_path_text(v_p, '$.frozen.columns[*].label'));
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.frozen.datasetProvenance[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      v_id := internal.search_uuid(v_p ->> 'definitionId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, ad.name) INTO v_text
          FROM api.analysis_definitions ad WHERE ad.id = v_id;
      END IF;

    WHEN 'plate_map' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        internal.jsonb_path_text(v_p, '$.spec.wells[*].wellCode'),
        replace(internal.jsonb_path_text(v_p, '$.spec.wells[*].role'), '_', ' '),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.identifier'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.title'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].notes'));

    WHEN 'pipeline_output' THEN
      v_text := coalesce(v_p ->> 'label', '');
      v_id := internal.search_uuid(v_p ->> 'runId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, pd.display_id, pd.name) INTO v_text
          FROM api.pipeline_runs pr
          JOIN api.pipeline_definition_versions pv ON pv.id = pr.definition_version_id
          JOIN api.pipeline_definitions pd ON pd.id = pv.definition_id
         WHERE pr.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'dataset_import' THEN
      v_text := coalesce(v_p ->> 'sheetName', '');
      v_id := internal.search_uuid(v_p ->> 'fileId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, f.filename) INTO v_text
          FROM api.dataset_import_files f WHERE f.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'structure' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'name',
        v_p ->> 'formula', v_p ->> 'smiles');

    WHEN 'reaction' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'smiles',
        internal.jsonb_path_text(v_p, '$.rows[*].name'),
        internal.jsonb_path_text(v_p, '$.rows[*].formula'),
        internal.jsonb_path_text(v_p, '$.rows[*].note'));

    WHEN 'gate' THEN
      v_text := concat_ws(' ', v_p ->> 'label',
        internal.jsonb_path_text(v_p, '$.conditions[*].label'),
        internal.jsonb_path_text(v_p, '$.conditions[*].column'));

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$$;
--> statement-breakpoint
-- A pipeline can set when a part opens. The database's copy of the action
-- catalogue (checked when a pipeline is saved) gains the action.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"set_part_gate","rpc":"set_part_gate","label":"Set when a part opens","description":"Make a part of an experiment open only when earlier work is done (a table filled, a step done, samples linked), and say whether it warns or blocks until then. Leave the conditions out to take the rule off.","arguments":[{"name":"p_part_id","type":"uuid","required":true,"nullable":false},{"name":"p_conditions","type":"jsonb","required":false,"nullable":true},{"name":"p_gate_mode","type":"text","required":false,"nullable":true},{"name":"p_steps_in_order","type":"boolean","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
