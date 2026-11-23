-- Retire the static table block.
--
-- A `table` block held its columns and rows as fixed text: nothing in the
-- notebook could edit it, and it looked like a sheet. The notebook has two
-- tabular surfaces, an ad hoc sheet and a dataset sheet, so every existing
-- table block becomes an ad hoc sheet with the same columns and rows, and the
-- block type is refused from now on.
--
-- Locks are untouched: only the block's type and payload change, never the
-- record's status, lock or signatures, and the signed revisions keep the text
-- they were signed with. A numeric-looking column becomes a number column when
-- every cell reads back exactly as it was written; every other column stays
-- text.
--
-- A template version, revision or old snapshot written before this can still
-- carry a `table` block. Copying one into a new notebook turns it into an ad
-- hoc sheet on the way in, so those keep working without a second code path.

CREATE OR REPLACE FUNCTION internal.grid_sheet_state(p_payload jsonb, p_seed text, p_text_only boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  raw_columns jsonb := CASE WHEN jsonb_typeof(p_payload->'columns') = 'array' THEN p_payload->'columns' ELSE '[]'::jsonb END;
  raw_rows jsonb := CASE WHEN jsonb_typeof(p_payload->'rows') = 'array' THEN p_payload->'rows' ELSE '[]'::jsonb END;
  n integer := jsonb_array_length(raw_columns);
  j integer;
  i integer;
  col jsonb;
  label text;
  slug text;
  keys text[] := '{}';
  key text;
  col_key text;
  logical text;
  fields jsonb := '[]'::jsonb;
  field_ids uuid[] := '{}';
  field_id uuid;
  col_keys text[] := '{}';
  col_types text[] := '{}';
  row_item jsonb;
  cell jsonb;
  cell_text text;
  all_numeric boolean;
  all_integer boolean;
  any_value boolean;
  local_values jsonb := '{}'::jsonb;
  row_values jsonb;
  row_key text;
  seed text := md5(p_seed);
  cell_value jsonb;
BEGIN
  IF n = 0 THEN
    -- Nothing to carry: an empty table still becomes a sheet with one column.
    raw_columns := '["Column 1"]'::jsonb;
    n := 1;
  END IF;
  IF n > 64 THEN
    raw_columns := (SELECT jsonb_agg(c) FROM (SELECT c FROM jsonb_array_elements(raw_columns) WITH ORDINALITY AS t(c, o) WHERE o <= 64 ORDER BY o) x);
    n := 64;
  END IF;

  FOR j IN 1..n LOOP
    col := raw_columns->(j - 1);
    label := CASE
      WHEN jsonb_typeof(col) = 'string' THEN col#>>'{}'
      WHEN jsonb_typeof(col) = 'object' THEN coalesce(col->>'label', col->>'key')
      ELSE NULL END;
    col_key := CASE WHEN jsonb_typeof(col) = 'object' THEN col->>'key' ELSE NULL END;
    label := left(nullif(btrim(coalesce(label, '')), ''), 200);
    IF label IS NULL THEN label := 'Column ' || j; END IF;
    col_keys := array_append(col_keys, coalesce(col_key, ''));

    slug := regexp_replace(lower(label), '[^a-z0-9]+', '_', 'g');
    slug := btrim(slug, '_');
    IF slug !~ '^[a-z]' THEN slug := 'column_' || slug; END IF;
    slug := btrim(left(slug, 50), '_');
    IF slug = '' OR slug = 'column' THEN slug := 'column_' || j; END IF;
    key := slug;
    IF key = ANY(keys) THEN key := left(slug, 50) || '_' || j; END IF;
    keys := array_append(keys, key);

    -- A column is a number column only when every cell round-trips exactly.
    all_numeric := NOT p_text_only;
    all_integer := true;
    any_value := false;
    IF all_numeric THEN
      FOR row_item IN SELECT t.x FROM jsonb_array_elements(raw_rows) AS t(x) LOOP
        cell := CASE
          WHEN jsonb_typeof(row_item) = 'array' THEN row_item->(j - 1)
          WHEN jsonb_typeof(row_item) = 'object' THEN row_item->coalesce(col_key, (j - 1)::text)
          ELSE NULL END;
        IF cell IS NULL OR cell = 'null'::jsonb OR (jsonb_typeof(cell) = 'string' AND btrim(cell#>>'{}') = '') THEN
          CONTINUE;
        END IF;
        any_value := true;
        IF jsonb_typeof(cell) = 'number' THEN
          IF abs((cell#>>'{}')::numeric) > 9007199254740991 THEN all_numeric := false; END IF;
          IF (cell#>>'{}')::numeric <> trunc((cell#>>'{}')::numeric) THEN all_integer := false; END IF;
        ELSIF jsonb_typeof(cell) = 'string'
              AND (cell#>>'{}') ~ '^-?(0|[1-9][0-9]{0,14})(\.[0-9]{1,15})?$'
              AND ((cell#>>'{}')::numeric)::text = (cell#>>'{}')
              AND (cell#>>'{}') <> '-0' THEN
          IF (cell#>>'{}') ~ '\.' THEN all_integer := false; END IF;
        ELSE
          all_numeric := false;
        END IF;
        EXIT WHEN NOT all_numeric;
      END LOOP;
    END IF;
    logical := CASE WHEN all_numeric AND any_value AND all_integer THEN 'integer'
                    WHEN all_numeric AND any_value THEN 'decimal'
                    ELSE 'text' END;
    col_types := array_append(col_types, logical);

    field_id := gen_random_uuid();
    field_ids := array_append(field_ids, field_id);
    fields := fields || jsonb_build_array(jsonb_build_object(
      'fieldId', field_id,
      'key', key,
      'label', label,
      'description', NULL,
      'logicalType', logical,
      'nullable', true,
      'defaultValue', NULL,
      'cardinality', 'one',
      'quantity', NULL,
      'validation', '{}'::jsonb,
      'category', NULL,
      'relationship', NULL,
      'computation', jsonb_build_object('mode', 'stored'),
      'lifecycle', 'active'
    ));
  END LOOP;

  i := 0;
  FOR row_item IN SELECT t.x FROM jsonb_array_elements(raw_rows) AS t(x) LOOP
    i := i + 1;
    EXIT WHEN i > 2000;
    row_key := lpad(to_hex(i), 8, '0') || '-' || substr(seed, 9, 4) || '-4' || substr(seed, 14, 3)
               || '-8' || substr(seed, 18, 3) || '-' || substr(seed, 21, 12);
    row_values := '{}'::jsonb;
    FOR j IN 1..n LOOP
      cell := CASE
        WHEN jsonb_typeof(row_item) = 'array' THEN row_item->(j - 1)
        WHEN jsonb_typeof(row_item) = 'object' THEN row_item->coalesce(NULLIF(col_keys[j], ''), (j - 1)::text)
        ELSE NULL END;
      IF cell IS NULL OR cell = 'null'::jsonb OR (jsonb_typeof(cell) = 'string' AND btrim(cell#>>'{}') = '') THEN
        CONTINUE;
      END IF;
      IF col_types[j] = 'text' THEN
        cell_value := to_jsonb(cell#>>'{}');
        IF jsonb_typeof(cell) IN ('object', 'array') THEN cell_value := to_jsonb(cell::text); END IF;
      ELSE
        cell_value := to_jsonb(((cell#>>'{}')::numeric));
      END IF;
      row_values := jsonb_set(row_values, ARRAY[field_ids[j]::text], cell_value, true);
    END LOOP;
    local_values := jsonb_set(local_values, ARRAY[row_key], row_values, true);
  END LOOP;

  RETURN jsonb_build_object(
    'bindings', '[]'::jsonb,
    'localFields', fields,
    'localValues', local_values,
    'calculationOverrides', '{}'::jsonb,
    'presentation', jsonb_build_object(
      'columnOrder', to_jsonb(field_ids),
      'hiddenColumnIds', '[]'::jsonb,
      'columnWidths', '{}'::jsonb,
      'frozenColumnCount', 0,
      'density', 'standard',
      'filters', '[]'::jsonb,
      'sorts', '[]'::jsonb
    ),
    'provenance', jsonb_build_object('createdFrom', 'ad_hoc')
  );
END
$$;

ALTER FUNCTION internal.grid_sheet_state(jsonb, text, boolean) OWNER TO migrator;

-- The ad hoc Sheet Instance for one table block. Falls back to an all-text
-- sheet if the typed one is refused, so no table is ever left behind.
CREATE OR REPLACE FUNCTION internal.grid_to_sheet_instance(p_record_id uuid, p_payload jsonb, p_seed text, p_user_id text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  rec api.records;
  state jsonb;
  instance_id uuid;
BEGIN
  SELECT * INTO rec FROM api.records WHERE id = p_record_id;
  IF rec.id IS NULL THEN
    RAISE EXCEPTION 'block owner not found' USING ERRCODE = '23503';
  END IF;
  state := internal.grid_sheet_state(p_payload, p_seed);
  BEGIN
    PERFORM internal.validate_sheet_instance_state(state);
  EXCEPTION WHEN OTHERS THEN
    state := internal.grid_sheet_state(p_payload, p_seed, true);
    PERFORM internal.validate_sheet_instance_state(state);
  END;
  PERFORM set_config('sheetbase.sheet_instance_write', 'rpc-v1', true);
  INSERT INTO api.sheet_instances(workspace_id, name, project_id, notebook_record_id, state,
                                  created_by_user_id, updated_by_user_id)
  VALUES (rec.workspace_id, 'Notebook sheet', rec.project_id, rec.id, state, p_user_id, p_user_id)
  RETURNING id INTO instance_id;
  RETURN instance_id;
END
$$;

ALTER FUNCTION internal.grid_to_sheet_instance(uuid, jsonb, text, text) OWNER TO migrator;
REVOKE ALL ON FUNCTION internal.grid_to_sheet_instance(uuid, jsonb, text, text) FROM PUBLIC;

-- The table-shaped view of a sheet block that gates and plugin checks read:
-- the sheet's own columns in display order, and one row of text per record.
CREATE OR REPLACE FUNCTION internal.gate_sheet_table_payload(p_block_payload jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH inst AS (
    SELECT i.state FROM api.sheet_instances i
     WHERE i.id = internal.gate_uuid(p_block_payload->>'instanceId')
  ), cols AS (
    SELECT f.value AS field, row_number() OVER (ORDER BY coalesce(o.ord, 1000000 + f.ord)) AS pos
      FROM inst,
           LATERAL jsonb_array_elements(coalesce(inst.state->'localFields', '[]'::jsonb)) WITH ORDINALITY AS f(value, ord)
           LEFT JOIN LATERAL (
             SELECT x.ord FROM jsonb_array_elements_text(coalesce(inst.state->'presentation'->'columnOrder', '[]'::jsonb)) WITH ORDINALITY AS x(id, ord)
              WHERE x.id = f.value->>'fieldId') o ON true
     WHERE f.value->>'lifecycle' = 'active'
  )
  SELECT jsonb_build_object(
    'columns', coalesce((SELECT jsonb_agg(field->>'label' ORDER BY pos) FROM cols), '[]'::jsonb),
    'rows', coalesce((
      SELECT jsonb_agg((SELECT jsonb_agg(coalesce(r.value->>(c.field->>'fieldId'), '') ORDER BY c.pos) FROM cols c) ORDER BY r.key)
        FROM inst, jsonb_each(coalesce(inst.state->'localValues', '{}'::jsonb)) AS r(key, value)
       WHERE jsonb_typeof(r.value) = 'object'
    ), '[]'::jsonb));
$$;

ALTER FUNCTION internal.gate_sheet_table_payload(jsonb) OWNER TO migrator;
REVOKE ALL ON FUNCTION internal.gate_sheet_table_payload(jsonb) FROM PUBLIC;

-- Copying an old template version into a notebook turns a table block into a
-- sheet; asking for one any other way is refused. Named to run before the
-- other block triggers.
CREATE OR REPLACE FUNCTION internal.aa_convert_legacy_table_block()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  call_stack text;
BEGIN
  -- Only the two template copies may carry an old table forward. A person,
  -- token, agent or import asking for a table block is told to use a sheet.
  GET DIAGNOSTICS call_stack = PG_CONTEXT;
  IF call_stack !~ 'function api\.instantiate_(template|notebook_template_version)\(' THEN
    RAISE EXCEPTION 'table blocks are retired: add a sheet instead' USING ERRCODE = '22023';
  END IF;
  NEW.payload := jsonb_build_object(
    'instanceId',
    internal.grid_to_sheet_instance(NEW.record_id, NEW.payload, NEW.id::text, NEW.created_by_user_id)
  );
  NEW.type := 'sheet';
  RETURN NEW;
END
$$;

ALTER FUNCTION internal.aa_convert_legacy_table_block() OWNER TO migrator;

DROP TRIGGER IF EXISTS aa_convert_legacy_table_block ON api.blocks;
CREATE TRIGGER aa_convert_legacy_table_block
  BEFORE INSERT ON api.blocks
  FOR EACH ROW WHEN (NEW.type = 'table')
  EXECUTE FUNCTION internal.aa_convert_legacy_table_block();

-- Existing table blocks. The block guards (locked or approved record, signed
-- part, change reason, change events, search sync) are off for this one
-- statement so a locked record is converted the same as an open one and the
-- conversion is not announced as an edit.
ALTER TABLE api.blocks DISABLE TRIGGER USER;

DO $convert$
DECLARE
  b record;
  instance_id uuid;
  old_hash text;
  new_payload jsonb;
  touched uuid[] := '{}';
BEGIN
  FOR b IN SELECT id, record_id, payload, created_by_user_id FROM api.blocks WHERE type = 'table' ORDER BY record_id, "order" LOOP
    instance_id := internal.grid_to_sheet_instance(b.record_id, b.payload, b.id::text, b.created_by_user_id);
    new_payload := jsonb_build_object('instanceId', instance_id);
    UPDATE api.blocks
       SET type = 'sheet', payload = new_payload, version = version + 1
     WHERE id = b.id;
    -- A plugin check that passed on this table still holds: same content.
    UPDATE api.gate_check_results
       SET table_hash = internal.gate_table_hash(internal.gate_sheet_table_payload(new_payload))
     WHERE block_id = b.id;
    touched := array_append(touched, b.record_id);
  END LOOP;
END
$convert$;

ALTER TABLE api.blocks ENABLE TRIGGER USER;

-- Gates now read a sheet only.

CREATE OR REPLACE FUNCTION internal.eval_gate_conditions(p_record_id uuid, p_conditions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_binding jsonb;
  v_ds record;
  v_use_ds boolean;
  v_pc api.gate_check_results;
  v_qc_id uuid;
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
       WHERE record_id = p_record_id AND id = internal.gate_uuid(v_c->>'blockId') AND type = 'sheet';
      v_column := nullif(btrim(coalesce(v_c->>'column', '')), '');
      v_min := CASE WHEN (v_c->>'minRows') ~ '^[0-9]+$' THEN (v_c->>'minRows')::integer ELSE 0 END;
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''),
                          nullif(btrim(coalesce(v_block.payload->>'title', '')), ''), 'The table');
      IF v_block.id IS NULL THEN
        v_text := 'A table this gate waits on has been removed';
      ELSE
        v_idx := NULL;
        v_total := 0; v_nonempty := 0; v_filled := 0; v_names := '{}';
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
          -- A sheet that reads a dataset has its rows there. Its own columns
          -- come first; a column it doesn't have is looked for in the dataset.
          v_binding := NULL;
          v_use_ds := false;
          IF v_column IS NULL OR v_field_id IS NULL THEN
            SELECT x.value INTO v_binding
              FROM jsonb_array_elements(coalesce(v_instance->'bindings', '[]'::jsonb)) x
             WHERE x.value->>'kind' = 'dataset' LIMIT 1;
          END IF;
          IF v_binding IS NOT NULL AND (v_column IS NOT NULL OR jsonb_array_length(coalesce(v_instance->'localFields', '[]'::jsonb)) = 0) THEN
            SELECT * INTO v_ds FROM internal.gate_dataset_grid(
              v_record.workspace_id, internal.gate_uuid(v_binding->>'datasetId'),
              CASE WHEN v_binding->'policy'->>'mode' = 'version' THEN internal.gate_uuid(v_binding->'policy'->>'datasetVersionId') END,
              v_column);
            v_use_ds := v_ds.total IS NOT NULL;
          END IF;
          IF v_use_ds THEN
            v_total := v_ds.total; v_nonempty := v_ds.nonempty; v_filled := v_ds.filled; v_names := v_ds.names;
            v_idx := CASE WHEN v_ds.has_column THEN 1 END;
          ELSE
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


    ELSIF v_kind = 'qc_in_control' THEN
      v_qc_id := internal.gate_uuid(v_c->>'seriesId');
      IF v_qc_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM api.qc_series s WHERE s.id = v_qc_id AND s.workspace_id = v_record.workspace_id) THEN
        v_text := 'A quality control series this gate waits on has been removed';
      ELSE
        SELECT coalesce(array_agg(b.name || ' (' || b.rules || ')' ORDER BY b.name), '{}') INTO v_names
          FROM internal.qc_open_breaches b
         WHERE b.workspace_id = v_record.workspace_id
           AND (v_qc_id IS NULL OR b.series_id = v_qc_id);
        v_met := coalesce(array_length(v_names, 1), 0) = 0;
        IF NOT v_met THEN
          v_text := 'Quality control is out of range: ' || array_to_string(v_names, ', ');
        END IF;
      END IF;


    ELSIF v_kind = 'plugin_check' THEN
      SELECT * INTO v_block FROM api.blocks
       WHERE record_id = p_record_id AND id = internal.gate_uuid(v_c->>'blockId') AND type = 'sheet';
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''), 'The check');
      IF v_block.id IS NULL THEN
        v_text := 'A table this gate waits on has been removed';
      ELSE
        SELECT * INTO v_pc FROM api.gate_check_results r
         WHERE r.record_id = p_record_id AND r.block_id = v_block.id
           AND r.extension_key = v_c->>'extensionKey' AND r.check_id = v_c->>'checkId';
        IF v_pc.record_id IS NULL THEN
          v_text := v_label || ' has not been run yet';
        ELSIF v_pc.table_hash <> internal.gate_table_hash(internal.gate_sheet_table_payload(v_block.payload)) THEN
          v_text := v_label || ' was run before the table changed. Run it again';
        ELSIF v_pc.status = 'fail' THEN
          v_text := v_label || ' failed' || CASE WHEN v_pc.message <> '' THEN ': ' || v_pc.message ELSE '' END;
        ELSE
          v_met := true;
        END IF;
      END IF;


    ELSIF v_kind = 'plugin_flag' THEN
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''), 'The plugin');
      SELECT array_agg(f.title || CASE WHEN f.message <> '' THEN ' (' || f.message || ')' ELSE '' END ORDER BY f.raised_at)
        INTO v_names
        FROM api.plugin_flags f
       WHERE f.record_id = p_record_id AND f.state = 'open'
         AND f.extension_key = v_c->>'extensionKey'
         AND (NOT (v_c ? 'flagKey') OR f.flag_key = v_c->>'flagKey');
      v_met := coalesce(array_length(v_names, 1), 0) = 0;
      IF NOT v_met THEN
        v_text := v_label || ' has this open: ' || array_to_string(v_names, '; ');
      END IF;

    ELSE
      v_text := 'Unknown condition';
    END IF;

    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'kind', v_kind, 'met', v_met, 'soft', v_soft, 'text', v_text,
      'blockId', v_block.id, 'partId', v_part.id)));
  END LOOP;
  RETURN v_out;
END $function$;

CREATE OR REPLACE FUNCTION internal.record_gate_check(p_record_id uuid, p_block_id uuid, p_extension_key text, p_check_id text, p_status text, p_message text, p_actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_block api.blocks;
  v_workspace uuid;
BEGIN
  SELECT * INTO v_block FROM api.blocks
   WHERE id = p_block_id AND record_id = p_record_id AND type = 'sheet';
  IF v_block.id IS NULL THEN
    RAISE EXCEPTION 'That sheet is not on this record' USING ERRCODE = '22023';
  END IF;
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = p_record_id;
  INSERT INTO api.gate_check_results
         (record_id, block_id, workspace_id, extension_key, check_id, status, message, table_hash, checked_at, checked_by_user_id)
  VALUES (p_record_id, p_block_id, v_workspace, p_extension_key, p_check_id, p_status,
          left(coalesce(p_message, ''), 300), internal.gate_table_hash(internal.gate_sheet_table_payload(v_block.payload)), now(), p_actor)
  ON CONFLICT (record_id, block_id, extension_key, check_id) DO UPDATE
     SET status = EXCLUDED.status, message = EXCLUDED.message, table_hash = EXCLUDED.table_hash,
         checked_at = EXCLUDED.checked_at, checked_by_user_id = EXCLUDED.checked_by_user_id;
END;
$function$;

CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    WHEN 'code_cell' THEN
      -- The code and the names of what it reads; never the output rows.
      v_text := concat_ws(' ', v_p ->> 'source',
        internal.jsonb_path_text(v_p, '$.inputs[*].alias'),
        internal.jsonb_path_text(v_p, '$.inputs[*].label'));

    WHEN 'gate' THEN
      v_text := concat_ws(' ', v_p ->> 'label',
        internal.jsonb_path_text(v_p, '$.conditions[*].label'),
        internal.jsonb_path_text(v_p, '$.conditions[*].column'));

    WHEN 'plate_run' THEN
      v_text := concat_ws(' ', v_p #>> '{pinned,reference}', v_p #>> '{pinned,name}');

    WHEN 'plugin' THEN
      -- The words in a plugin block's state: every text value of up to 500
      -- characters. Longer ones (a raw sequence) are not words and are left out.
      SELECT coalesce(string_agg(x #>> '{}', ' '), '') INTO v_text
        FROM jsonb_path_query(coalesce(v_p -> 'state', 'null'::jsonb), 'strict $.**') x
       WHERE jsonb_typeof(x) = 'string' AND length(x #>> '{}') <= 500;

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$function$;

CREATE OR REPLACE FUNCTION internal.validate_notebook_template_configuration(p_workspace_id uuid, p_config jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  item jsonb;
  mapping jsonb;
  parameter jsonb;
  def_param jsonb;
  version_row api.sheet_definition_versions;
  definition api.sheet_definitions;
  parameter_ids text[] := '{}';
  parameter_keys text[] := '{}';
  placement_ids text[] := '{}';
  id text;
  order_seen numeric[] := '{}';
  mapped boolean;
BEGIN
  IF octet_length(p_config::text) > 1048576 THEN
    RAISE EXCEPTION 'Notebook Template configuration exceeds 1 MiB' USING ERRCODE = 'SB091';
  END IF;
  PERFORM internal.assert_sheet_definition_object(
    p_config,
    ARRAY['formatVersion','parameters','placements'],
    ARRAY['formatVersion','parameters','placements','parts','signOffParts'],
    'configuration'
  );
  IF p_config->'formatVersion' <> '1'::jsonb THEN
    RAISE EXCEPTION 'unsupported Notebook Template configuration format' USING ERRCODE = 'SB091';
  END IF;
  IF jsonb_typeof(p_config->'parameters') <> 'array'
     OR jsonb_array_length(p_config->'parameters') > 64
     OR jsonb_typeof(p_config->'placements') <> 'array'
     OR jsonb_array_length(p_config->'placements') > 256 THEN
    RAISE EXCEPTION 'invalid Notebook Template sections' USING ERRCODE = 'SB091';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
    BEGIN
      PERFORM internal.validate_parameter(item);
    EXCEPTION WHEN SQLSTATE 'SB071' THEN
      RAISE EXCEPTION 'invalid Notebook Template parameter: %', SQLERRM USING ERRCODE = 'SB091';
    END;
    id := item->>'id';
    IF id = ANY(parameter_ids) OR item->>'key' = ANY(parameter_keys) THEN
      RAISE EXCEPTION 'duplicate Notebook Template parameter identity' USING ERRCODE = 'SB091';
    END IF;
    parameter_ids := array_append(parameter_ids, id);
    parameter_keys := array_append(parameter_keys, item->>'key');
  END LOOP;

  IF p_config ? 'signOffParts' AND jsonb_typeof(p_config->'signOffParts') <> 'boolean' THEN
    RAISE EXCEPTION 'invalid Notebook Template sign-off setting' USING ERRCODE = 'SB091';
  END IF;
  IF p_config ? 'parts' THEN
    IF jsonb_typeof(p_config->'parts') <> 'array' OR jsonb_array_length(p_config->'parts') > 60 THEN
      RAISE EXCEPTION 'invalid Notebook Template parts' USING ERRCODE = 'SB091';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_config->'parts') LOOP
      PERFORM internal.assert_sheet_definition_object(
        item, ARRAY['id','title','dayOffset'], ARRAY['id','title','dayOffset','opensWhen','gateMode','stepsInOrder'], 'parts');
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

  FOR item IN SELECT value FROM jsonb_array_elements(p_config->'placements') LOOP
    IF jsonb_typeof(item) <> 'object' OR item->>'kind' NOT IN ('narrative','sheet','section_placeholder') THEN
      RAISE EXCEPTION 'invalid Template placement kind' USING ERRCODE = 'SB091';
    END IF;
    id := internal.sheet_definition_uuid(item->>'id','placements.id')::text;
    IF id = ANY(placement_ids) THEN
      RAISE EXCEPTION 'duplicate Template placement id' USING ERRCODE = 'SB091';
    END IF;
    placement_ids := array_append(placement_ids, id);
    IF item ? 'partId' AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(p_config->'parts', '[]'::jsonb)) pr
       WHERE pr.value->>'id' = item->>'partId') THEN
      RAISE EXCEPTION 'a placement names a part the Template does not have' USING ERRCODE = 'SB091';
    END IF;
    IF jsonb_typeof(item->'order') <> 'number'
       OR (item->>'order')::numeric <> trunc((item->>'order')::numeric)
       OR (item->>'order')::numeric < 1
       OR (item->>'order')::numeric = ANY(order_seen) THEN
      RAISE EXCEPTION 'Template placements require unique positive integer order' USING ERRCODE = 'SB091';
    END IF;
    order_seen := array_append(order_seen, (item->>'order')::numeric);

    IF item->>'kind' = 'narrative' THEN
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','blockType','payload'],
        ARRAY['id','kind','order','blockType','payload','partId'],
        'placements.narrative'
      );
      IF item->>'blockType' NOT IN (
        'rich_text','checklist','linked_record','callout','chart',
        'plate_map','file','metric','procedure_step','protocol_reference','materials','gate'
      ) THEN
        RAISE EXCEPTION 'narrative placement cannot be a Sheet block' USING ERRCODE = 'SB091';
      END IF;
      IF jsonb_typeof(item->'payload') <> 'object' THEN
        RAISE EXCEPTION 'narrative placement payload must be an object' USING ERRCODE = 'SB091';
      END IF;
    ELSIF item->>'kind' = 'section_placeholder' THEN
      -- CORE-06.11: reserved reference shape so future versioned Sections
      -- can be named without Template inheritance.
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','key','label'],
        ARRAY['id','kind','order','key','label'],
        'placements.section'
      );
      IF item->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
         OR length(btrim(item->>'label')) NOT BETWEEN 1 AND 200 THEN
        RAISE EXCEPTION 'invalid Template section placeholder' USING ERRCODE = 'SB091';
      END IF;
    ELSE
      PERFORM internal.assert_sheet_definition_object(
        item,
        ARRAY['id','kind','order','definitionVersionId','parameterMappings'],
        ARRAY['id','kind','order','definitionVersionId','parameterMappings','title','partId'],
        'placements.sheet'
      );
      IF item ? 'title' AND (jsonb_typeof(item->'title') <> 'string' OR length(btrim(item->>'title')) > 200) THEN
        RAISE EXCEPTION 'invalid Sheet placement title' USING ERRCODE = 'SB091';
      END IF;
      SELECT * INTO version_row
        FROM api.sheet_definition_versions definition_version
        WHERE definition_version.id = internal.sheet_definition_uuid(
          item->>'definitionVersionId','placements.definitionVersionId'
        );
      IF version_row.id IS NULL OR version_row.lifecycle <> 'published' THEN
        RAISE EXCEPTION 'Sheet placement must pin a published Sheet Definition Version' USING ERRCODE = 'SB091';
      END IF;
      SELECT * INTO definition FROM api.sheet_definitions sheet_def
        WHERE sheet_def.id = version_row.definition_id;
      IF definition.workspace_id IS DISTINCT FROM p_workspace_id OR definition.lifecycle <> 'active' THEN
        RAISE EXCEPTION 'Sheet Definition Version must belong to this workspace' USING ERRCODE = 'SB091';
      END IF;
      IF jsonb_typeof(item->'parameterMappings') <> 'array'
         OR jsonb_array_length(item->'parameterMappings') > 64 THEN
        RAISE EXCEPTION 'invalid parameterMappings' USING ERRCODE = 'SB091';
      END IF;
      FOR mapping IN SELECT value FROM jsonb_array_elements(item->'parameterMappings') LOOP
        PERFORM internal.assert_sheet_definition_object(
          mapping,
          ARRAY['templateParameterId','definitionParameterId'],
          ARRAY['templateParameterId','definitionParameterId'],
          'parameterMappings'
        );
        IF (mapping->>'templateParameterId') <> ALL(parameter_ids) THEN
          RAISE EXCEPTION 'parameter mapping names an unknown Template parameter' USING ERRCODE = 'SB091';
        END IF;
        SELECT value INTO parameter
          FROM jsonb_array_elements(p_config->'parameters') value
          WHERE value->>'id' = mapping->>'templateParameterId';
        SELECT value INTO def_param
          FROM jsonb_array_elements(coalesce(version_row.configuration->'parameters','[]'::jsonb)) value
          WHERE value->>'id' = mapping->>'definitionParameterId';
        IF def_param IS NULL THEN
          RAISE EXCEPTION 'parameter mapping names an unknown Sheet Definition parameter' USING ERRCODE = 'SB091';
        END IF;
        IF parameter->'type' IS DISTINCT FROM def_param->'type' THEN
          RAISE EXCEPTION 'Template parameter type must match the mapped Definition parameter' USING ERRCODE = 'SB091';
        END IF;
      END LOOP;
      FOR def_param IN SELECT value FROM jsonb_array_elements(coalesce(version_row.configuration->'parameters','[]'::jsonb)) LOOP
        IF def_param->>'required' = 'true' THEN
          mapped := EXISTS (
            SELECT 1 FROM jsonb_array_elements(item->'parameterMappings') map_row
            WHERE map_row->>'definitionParameterId' = def_param->>'id'
          );
          IF NOT mapped THEN
            RAISE EXCEPTION 'required Sheet Definition parameter % is unmapped', def_param->>'id'
              USING ERRCODE = 'SB091';
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$function$;

CREATE OR REPLACE FUNCTION internal.lab_watcher_candidates(p_watcher api.lab_watchers)
 RETURNS TABLE(object_kind text, object_id uuid, project_id uuid, title text, summary text, suggested jsonb, dedupe_key text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_days integer := coalesce(nullif(p_watcher.params->>'days', '')::integer, 30);
  v_sigma numeric := coalesce(nullif(p_watcher.params->>'sigma', '')::numeric, 3);
BEGIN
  IF p_watcher.kind = 'stock_expiring' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Lot ' || coalesce(r.properties->>'lot', '(no lot)') || ' expires on ' || (r.properties->>'expiry')
            || ' and nothing is planned for it.')::text,
           jsonb_build_object('kind', 'lab_action', 'label', 'Order a replacement',
                              'action', 'request_reagent_order',
                              'arguments', jsonb_build_object('p_material_record_id', r.id, 'p_quantity', 1)),
           ('expiring:' || r.id || ':' || (r.properties->>'expiry'))::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed', 'depleted')
       AND CASE WHEN (r.properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
                THEN (r.properties->>'expiry')::date END <= current_date + v_days
       AND NOT EXISTS (SELECT 1 FROM api.reagent_orders o
                        WHERE o.material_record_id = r.id AND o.status NOT IN ('received', 'cancelled'))
       AND NOT EXISTS (SELECT 1 FROM api.sample_reservations s
                        WHERE s.sample_record_id = r.id AND s.state = 'active');
  ELSIF p_watcher.kind = 'stock_low' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Only ' || (r.properties->>'quantity') || ' ' || coalesce(r.properties->>'unit', '')
            || ' left, at or below the low-stock level of ' || (r.properties->>'low_stock_threshold') || '. No order is open.')::text,
           jsonb_build_object('kind', 'lab_action', 'label', 'Request more',
                              'action', 'request_reagent_order',
                              'arguments', jsonb_build_object('p_material_record_id', r.id, 'p_quantity', 1)),
           ('low:' || r.id)::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed')
       AND (r.properties->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (r.properties->>'low_stock_threshold') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (r.properties->>'quantity')::numeric <= (r.properties->>'low_stock_threshold')::numeric
       AND NOT EXISTS (SELECT 1 FROM api.reagent_orders o
                        WHERE o.material_record_id = r.id AND o.status NOT IN ('received', 'cancelled'));
  ELSIF p_watcher.kind = 'work_overdue' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Planned to finish on ' || to_char(d.due, 'YYYY-MM-DD') || ' (' || (current_date - d.due)
            || CASE WHEN current_date - d.due = 1 THEN ' day' ELSE ' days' END || ' ago) and still open.')::text,
           NULL::jsonb,
           ('overdue:' || r.id || ':' || to_char(d.due, 'YYYY-MM-DD'))::text
      FROM api.records r
      JOIN LATERAL (
        SELECT least(r.planned_end, m.planned_on) AS due
          FROM (SELECT 1) one
          LEFT JOIN api.experiment_series_members m ON m.member_record_id = r.id
         WHERE r.planned_end IS NOT NULL OR m.planned_on IS NOT NULL) d ON d.due IS NOT NULL
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'experiment' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND r.status IN ('planned', 'draft', 'in_progress')
       AND d.due < current_date;
  ELSIF p_watcher.kind = 'data_missing' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           'Every step is ticked off, but no results, tables or sheets are recorded yet. Add the data before sending it for review.'::text,
           NULL::jsonb,
           ('missing:' || r.id)::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'experiment' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND r.status = 'in_progress'
       AND EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type = 'procedure_step')
       AND NOT EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type = 'procedure_step'
                          AND coalesce(b.payload->>'completed', 'false') <> 'true')
       AND NOT EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type IN ('metric', 'sheet'));
  ELSIF p_watcher.kind = 'results_off' THEN
    RETURN QUERY
    WITH history AS (
      SELECT m.sample_record_id, m.name, m.unit, m.value, m.measured_at, m.id,
             avg(m.value) OVER w AS mean, stddev_samp(m.value) OVER w AS sd, count(*) OVER w AS n
        FROM api.sample_measurements m
        JOIN api.records s ON s.id = m.sample_record_id
       WHERE m.workspace_id = p_watcher.workspace_id
         AND (p_watcher.project_id IS NULL OR s.project_id = p_watcher.project_id)
      WINDOW w AS (PARTITION BY m.name, coalesce(m.unit, '')
                   ORDER BY m.measured_at, m.id ROWS BETWEEN 50 PRECEDING AND 1 PRECEDING)
    )
    SELECT 'record'::text, h.sample_record_id, s.project_id,
           (s.identifier || ' ' || s.title)::text,
           (h.name || ' of ' || trim_scale(h.value) || coalesce(' ' || h.unit, '') || ' is '
            || round(abs(h.value - h.mean) / h.sd, 1) || ' standard deviations '
            || CASE WHEN h.value > h.mean THEN 'above' ELSE 'below' END
            || ' the usual ' || round(h.mean, 3) || ' (from ' || h.n || ' earlier readings).')::text,
           NULL::jsonb,
           ('off:' || h.id)::text
      FROM history h
      JOIN api.records s ON s.id = h.sample_record_id
     WHERE h.n >= 5 AND h.sd > 0
       AND h.measured_at >= now() - interval '14 days'
       AND abs(h.value - h.mean) / h.sd >= v_sigma;
  END IF;
END $function$;

ALTER FUNCTION internal.eval_gate_conditions(p_record_id uuid, p_conditions jsonb) OWNER TO migrator;
ALTER FUNCTION internal.record_gate_check(uuid, uuid, text, text, text, text, text) OWNER TO migrator;

ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type;
ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type CHECK ((type = ANY (ARRAY['rich_text'::text, 'checklist'::text, 'linked_record'::text, 'callout'::text, 'sheet'::text, 'chart'::text, 'analysis'::text, 'plate_map'::text, 'file'::text, 'metric'::text, 'procedure_step'::text, 'protocol_reference'::text, 'materials'::text, 'pipeline_output'::text, 'signature_request'::text, 'corrective_actions'::text, 'conclusion'::text, 'dataset_import'::text, 'structure'::text, 'reaction'::text, 'code_cell'::text, 'gate'::text, 'plugin'::text, 'plate_run'::text])));
