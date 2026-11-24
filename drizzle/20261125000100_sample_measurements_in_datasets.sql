-- Sample measurements live in a dataset.
--
-- A bench reading, a plate run's result for a sample and an API-recorded
-- measurement used to sit in their own table, apart from every other result.
-- They are now rows of a built-in measurement table ("Sample measurement"), in
-- one dataset per workspace, each row linking to the sample it measures. The
-- old `api.sample_measurements` name stays as a read-only view over those
-- rows, with the same columns and ids, so every screen, API call and watcher
-- that read it still works. `record_sample_measurement` and
-- `publish_plate_run_measurements` write dataset rows.

-- A built-in measurement table is its own origin.
ALTER TABLE api.dataset_schema_definitions DROP CONSTRAINT chk_dataset_schema_definitions_origin;
--> statement-breakpoint
ALTER TABLE api.dataset_schema_definitions
  ADD CONSTRAINT chk_dataset_schema_definitions_origin
  CHECK (origin IN ('designed', 'starter', 'import', 'built_in'));
--> statement-breakpoint

-- The columns of each built-in result table. One entry per table key.
CREATE FUNCTION internal.result_table_spec(p_key text) RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE p_key
    WHEN 'sample_measurement' THEN jsonb_build_object(
      'name', 'Sample measurement',
      'description', 'A value measured on a sample: concentration, titre, viability, a plate reading.',
      'datasetName', 'Sample measurements',
      'datasetDescription', 'Every measurement recorded against a sample, whether typed in, read at the bench or read off a plate.',
      'fields', jsonb_build_array(
        jsonb_build_object('key', 'sample', 'label', 'Sample', 'logical_type', 'reference', 'nullable', false,
          'relationship', jsonb_build_object('target', jsonb_build_object('kind', 'model', 'modelKey', 'sample'), 'cardinality', 'one')),
        jsonb_build_object('key', 'measurement', 'label', 'Measurement', 'logical_type', 'text', 'nullable', false,
          'validation', jsonb_build_object('maxLength', 200)),
        jsonb_build_object('key', 'value', 'label', 'Value', 'logical_type', 'decimal', 'nullable', false),
        jsonb_build_object('key', 'unit', 'label', 'Unit', 'logical_type', 'text'),
        jsonb_build_object('key', 'method', 'label', 'Method', 'logical_type', 'text'),
        jsonb_build_object('key', 'measured_at', 'label', 'Measured at', 'logical_type', 'timestamp', 'nullable', false),
        jsonb_build_object('key', 'notes', 'label', 'Notes', 'logical_type', 'text'),
        jsonb_build_object('key', 'plate_run', 'label', 'Plate run', 'logical_type', 'text'),
        jsonb_build_object('key', 'recorded_by', 'label', 'Recorded by', 'logical_type', 'text')))
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.result_table_spec(p_key text) OWNER TO migrator;
--> statement-breakpoint

-- The workspace's dataset for a built-in result table, made the first time a
-- result is written. The table itself is published (an ordinary measurement
-- table people can see under Models).
CREATE FUNCTION internal.ensure_result_dataset(p_workspace_id uuid, p_key text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_spec jsonb := internal.result_table_spec(p_key);
  v_def_key text := 'builtin_' || p_key;
  v_dataset uuid;
  v_version uuid;
  v_created jsonb;
BEGIN
  IF v_spec IS NULL THEN
    RAISE EXCEPTION 'unknown result table' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_workspace_id::text || ':' || p_key, 0));
  SELECT d.id INTO v_dataset
    FROM api.datasets d
    JOIN api.dataset_schema_versions v ON v.id = d.schema_version_id
    JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
   WHERE d.workspace_id = p_workspace_id AND s.workspace_id = p_workspace_id
     AND s.key = v_def_key AND d.lifecycle = 'active'
   ORDER BY d.created_at LIMIT 1;
  IF v_dataset IS NOT NULL THEN
    RETURN v_dataset;
  END IF;
  SELECT v.id INTO v_version
    FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
   WHERE s.workspace_id = p_workspace_id AND s.key = v_def_key AND v.lifecycle = 'active'
   ORDER BY v.version DESC LIMIT 1;
  IF v_version IS NULL THEN
    v_created := internal.create_published_dataset_structure(
      p_workspace_id, api.current_user_id(), v_def_key, v_spec->>'name', v_spec->>'description',
      v_spec->'fields', 'starter');
    UPDATE api.dataset_schema_definitions SET origin = 'built_in'
     WHERE id = (v_created->>'schema_definition_id')::uuid;
    v_version := (v_created->>'schema_version_id')::uuid;
  END IF;
  INSERT INTO api.datasets (workspace_id, schema_version_id, name, description, created_by_user_id)
  VALUES (p_workspace_id, v_version, v_spec->>'datasetName', v_spec->>'datasetDescription', api.current_user_id())
  RETURNING id INTO v_dataset;
  RETURN v_dataset;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ensure_result_dataset(p_workspace_id uuid, p_key text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ensure_result_dataset(p_workspace_id uuid, p_key text) FROM PUBLIC;
--> statement-breakpoint

-- Writes rows to a result table's dataset through the same governed commit
-- every import and sheet uses, so a result is validated, audited and counted
-- like any other dataset row. Each row is an object keyed by column key.
-- Returns the new row ids in order.
CREATE FUNCTION internal.write_result_rows(p_workspace_id uuid, p_key text, p_rows jsonb) RETURNS uuid[]
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dataset uuid;
  v_version uuid;
  v_revision bigint;
  v_row jsonb;
  v_values jsonb;
  v_field record;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_items jsonb := '[]'::jsonb;
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN v_ids;
  END IF;
  v_dataset := internal.ensure_result_dataset(p_workspace_id, p_key);
  SELECT d.schema_version_id, d.revision INTO v_version, v_revision
    FROM api.datasets d WHERE d.id = v_dataset FOR UPDATE;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    v_values := '{}'::jsonb;
    FOR v_field IN
      SELECT f.key, f.field_id FROM api.dataset_schema_version_fields f
       WHERE f.schema_version_id = v_version AND f.lifecycle = 'active'
    LOOP
      IF v_row ? v_field.key AND jsonb_typeof(v_row -> v_field.key) <> 'null' THEN
        v_values := v_values || jsonb_build_object(v_field.field_id::text, v_row -> v_field.key);
      END IF;
    END LOOP;
    v_id := gen_random_uuid();
    v_ids := v_ids || v_id;
    v_items := v_items || jsonb_build_array(jsonb_build_object('operation', 'create', 'rowId', v_id, 'values', v_values));
  END LOOP;
  v_result := api.commit_dataset_row_batch(v_dataset, v_revision, v_items, gen_random_uuid()::text);
  IF (v_result->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'result not recorded: %', left(coalesce(v_result->>'errors', v_result::text), 300)
      USING ERRCODE = '22023';
  END IF;
  RETURN v_ids;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.write_result_rows(p_workspace_id uuid, p_key text, p_rows jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.write_result_rows(p_workspace_id uuid, p_key text, p_rows jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Removes result rows (a plate run read again replaces what it wrote) and
-- counts the change on the dataset.
CREATE FUNCTION internal.delete_result_rows(p_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE api.datasets SET revision = revision + 1, updated_at = now()
   WHERE id IN (SELECT dataset_id FROM api.dataset_rows WHERE id = ANY (p_ids));
  DELETE FROM api.dataset_rows WHERE id = ANY (p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.delete_result_rows(p_ids uuid[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.delete_result_rows(p_ids uuid[]) FROM PUBLIC;
--> statement-breakpoint

-- Move what is already recorded -------------------------------------------------------
-- Every row keeps its id, so a link to a measurement still resolves. The value
-- trigger is paused for the copy: it checks that the sample is live, and a
-- measurement of a sample that was since deleted must still come across.
ALTER TABLE api.dataset_row_values DISABLE TRIGGER validate_dataset_row_value;
--> statement-breakpoint
DO $$
DECLARE
  v_workspace record;
  v_dataset uuid;
  v_version uuid;
BEGIN
  FOR v_workspace IN SELECT DISTINCT workspace_id FROM api.sample_measurements LOOP
    v_dataset := internal.ensure_result_dataset(v_workspace.workspace_id, 'sample_measurement');
    SELECT schema_version_id INTO v_version FROM api.datasets WHERE id = v_dataset;
    INSERT INTO api.dataset_rows (id, dataset_id, workspace_id, created_at, updated_at)
    SELECT m.id, v_dataset, m.workspace_id, m.created_at, m.updated_at
      FROM api.sample_measurements m WHERE m.workspace_id = v_workspace.workspace_id;
    INSERT INTO api.dataset_row_values
      (row_id, field_id, ordinal, text_value, numeric_value, timestamp_value, reference_id)
    SELECT m.id, f.field_id, 0,
           CASE f.key WHEN 'measurement' THEN m.name WHEN 'unit' THEN m.unit WHEN 'method' THEN m.method
                      WHEN 'notes' THEN m.notes
                      WHEN 'plate_run' THEN 'PLR-' || CASE WHEN pr.number >= 10000 THEN pr.number::text ELSE lpad(pr.number::text, 4, '0') END
                      WHEN 'recorded_by' THEN u.name END,
           CASE f.key WHEN 'value' THEN m.value END,
           CASE f.key WHEN 'measured_at' THEN m.measured_at END,
           CASE f.key WHEN 'sample' THEN m.sample_record_id END
      FROM api.sample_measurements m
      JOIN api.dataset_schema_version_fields f ON f.schema_version_id = v_version AND f.lifecycle = 'active'
      LEFT JOIN api.plate_runs pr ON pr.id = m.plate_run_id
      LEFT JOIN internal."user" u ON u.id = m.created_by_user_id
     WHERE m.workspace_id = v_workspace.workspace_id
       AND CASE f.key
             WHEN 'sample' THEN true WHEN 'measurement' THEN true WHEN 'value' THEN true
             WHEN 'measured_at' THEN true
             WHEN 'unit' THEN m.unit IS NOT NULL WHEN 'method' THEN m.method IS NOT NULL
             WHEN 'notes' THEN m.notes IS NOT NULL WHEN 'plate_run' THEN pr.id IS NOT NULL
             WHEN 'recorded_by' THEN u.name IS NOT NULL
             ELSE false END;
    UPDATE api.datasets SET revision = revision + 1, updated_at = now() WHERE id = v_dataset;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE api.dataset_row_values ENABLE TRIGGER validate_dataset_row_value;
--> statement-breakpoint

-- The old name, now a view -------------------------------------------------------------
DROP FUNCTION api.record_sample_measurement(uuid, text, numeric, text, text, timestamp with time zone, text);
--> statement-breakpoint
DROP TABLE api.sample_measurements;
--> statement-breakpoint
-- security_invoker: the rows follow the dataset's own access rules, like every
-- other read of a dataset.
CREATE VIEW api.sample_measurements WITH (security_invoker = true) AS
SELECT r.id,
       r.workspace_id,
       vs.reference_id AS sample_record_id,
       vn.text_value AS name,
       vv.numeric_value AS value,
       vu.text_value AS unit,
       vm.text_value AS method,
       vt.timestamp_value AS measured_at,
       vo.text_value AS notes,
       NULL::text AS created_by_user_id,
       r.created_at,
       r.updated_at,
       (SELECT pr.id FROM api.plate_runs pr
         WHERE pr.workspace_id = r.workspace_id
           AND pr.number = substring(vp.text_value FROM '^PLR-([0-9]+)$')::integer) AS plate_run_id
  FROM api.dataset_rows r
  JOIN api.datasets d ON d.id = r.dataset_id
  JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
  JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id AND sd.key = 'builtin_sample_measurement'
  JOIN api.dataset_schema_version_fields fs ON fs.schema_version_id = d.schema_version_id AND fs.key = 'sample' AND fs.lifecycle = 'active'
  JOIN api.dataset_row_values vs ON vs.row_id = r.id AND vs.field_id = fs.field_id AND vs.ordinal = 0
  JOIN api.dataset_schema_version_fields fn ON fn.schema_version_id = d.schema_version_id AND fn.key = 'measurement' AND fn.lifecycle = 'active'
  JOIN api.dataset_row_values vn ON vn.row_id = r.id AND vn.field_id = fn.field_id AND vn.ordinal = 0
  JOIN api.dataset_schema_version_fields fv ON fv.schema_version_id = d.schema_version_id AND fv.key = 'value' AND fv.lifecycle = 'active'
  JOIN api.dataset_row_values vv ON vv.row_id = r.id AND vv.field_id = fv.field_id AND vv.ordinal = 0
  JOIN api.dataset_schema_version_fields ft ON ft.schema_version_id = d.schema_version_id AND ft.key = 'measured_at' AND ft.lifecycle = 'active'
  JOIN api.dataset_row_values vt ON vt.row_id = r.id AND vt.field_id = ft.field_id AND vt.ordinal = 0
  LEFT JOIN api.dataset_schema_version_fields fu ON fu.schema_version_id = d.schema_version_id AND fu.key = 'unit' AND fu.lifecycle = 'active'
  LEFT JOIN api.dataset_row_values vu ON vu.row_id = r.id AND vu.field_id = fu.field_id AND vu.ordinal = 0
  LEFT JOIN api.dataset_schema_version_fields fm ON fm.schema_version_id = d.schema_version_id AND fm.key = 'method' AND fm.lifecycle = 'active'
  LEFT JOIN api.dataset_row_values vm ON vm.row_id = r.id AND vm.field_id = fm.field_id AND vm.ordinal = 0
  LEFT JOIN api.dataset_schema_version_fields fo ON fo.schema_version_id = d.schema_version_id AND fo.key = 'notes' AND fo.lifecycle = 'active'
  LEFT JOIN api.dataset_row_values vo ON vo.row_id = r.id AND vo.field_id = fo.field_id AND vo.ordinal = 0
  LEFT JOIN api.dataset_schema_version_fields fp ON fp.schema_version_id = d.schema_version_id AND fp.key = 'plate_run' AND fp.lifecycle = 'active'
  LEFT JOIN api.dataset_row_values vp ON vp.row_id = r.id AND vp.field_id = fp.field_id AND vp.ordinal = 0
 WHERE r.status = 'recorded';
--> statement-breakpoint
ALTER VIEW api.sample_measurements OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE api.sample_measurements TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.sample_measurements TO api_client;
--> statement-breakpoint
COMMENT ON VIEW api.sample_measurements IS 'A value measured on a sample. Read-only: the rows are those of the workspace''s Sample measurements dataset (built-in measurement table), so edit them there or record one with record_sample_measurement.';
--> statement-breakpoint

CREATE FUNCTION api.record_sample_measurement(p_sample_record_id uuid, p_name text, p_value numeric, p_unit text DEFAULT NULL::text, p_method text DEFAULT NULL::text, p_measured_at timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text) RETURNS api.sample_measurements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.sample_measurements;
  r api.records;
  v_ids uuid[];
BEGIN
  IF p_sample_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record', p_sample_record_id, 'edit'); END IF;
  SELECT * INTO r FROM api.records
   WHERE id = p_sample_record_id AND deleted_at IS NULL;
  IF r.id IS NULL
     OR r.kind <> 'sample'
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'measurement name required' USING ERRCODE = '22023';
  END IF;
  v_ids := internal.write_result_rows(r.workspace_id, 'sample_measurement', jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object(
      'sample', r.id,
      'measurement', btrim(p_name),
      'value', p_value,
      'unit', p_unit,
      'method', p_method,
      'measured_at', coalesce(p_measured_at, now()),
      'notes', p_notes,
      'recorded_by', (SELECT u.name FROM internal."user" u WHERE u.id = api.current_user_id())))));
  SELECT * INTO v FROM api.sample_measurements WHERE id = v_ids[1];
  RETURN v;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.record_sample_measurement(p_sample_record_id uuid, p_name text, p_value numeric, p_unit text, p_method text, p_measured_at timestamp with time zone, p_notes text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_sample_measurement(p_sample_record_id uuid, p_name text, p_value numeric, p_unit text, p_method text, p_measured_at timestamp with time zone, p_notes text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_sample_measurement(p_sample_record_id uuid, p_name text, p_value numeric, p_unit text, p_method text, p_measured_at timestamp with time zone, p_notes text) TO authenticated;
--> statement-breakpoint

-- A plate run's results for its samples are rows of the same dataset. Reading the
-- plate again replaces only what this run wrote.
CREATE OR REPLACE FUNCTION api.publish_plate_run_measurements(p_plate_run_id uuid, p_name text DEFAULT NULL)
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
  v_rows jsonb := '[]'::jsonb;
  v_by text;
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

  v_reference := 'PLR-' || CASE WHEN v_run.number >= 10000 THEN v_run.number::text ELSE lpad(v_run.number::text, 4, '0') END;
  v_unit := nullif(btrim(coalesce(v_run.results #>> '{quantify,curve,unit}', '')), '');
  v_name := nullif(btrim(coalesce(p_name, '')), '');
  IF v_name IS NULL THEN
    SELECT d.name INTO v_name FROM api.plate_designs d WHERE d.id = v_run.design_id;
  END IF;
  v_name := left(coalesce(v_name, v_run.name), 200);
  v_by := (SELECT u.name FROM internal."user" u WHERE u.id = api.current_user_id());

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
    v_rows := v_rows || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'sample', v_sample,
      'measurement', v_name,
      'value', v_value,
      'unit', v_unit,
      'method', v_reference || ' · standard curve',
      'measured_at', coalesce(v_run.analysed_at, now()),
      'notes', CASE WHEN v_dilution <> 1
           THEN 'Read off the standard curve, diluted ' || trim(trailing '.' from trim(trailing '0' from v_dilution::text)) || '-fold, mean of ' || coalesce(v_item ->> 'n', '1') || ' well(s).'
           ELSE 'Read off the standard curve, mean of ' || coalesce(v_item ->> 'n', '1') || ' well(s).' END,
      'plate_run', v_reference,
      'recorded_by', v_by)));
    v_published := v_published + 1;
  END LOOP;

  -- What this run wrote before is replaced, so reading the plate again never
  -- leaves two answers for one sample.
  PERFORM internal.delete_result_rows(coalesce(
    (SELECT array_agg(m.id) FROM api.sample_measurements m
      WHERE m.workspace_id = v_run.workspace_id AND m.plate_run_id = v_run.id), ARRAY[]::uuid[]));
  PERFORM internal.write_result_rows(v_run.workspace_id, 'sample_measurement', v_rows);

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

-- The sample's Measurements tab ------------------------------------------------------
-- The tab already lists dataset rows that link to the sample. A sample
-- measurement row names itself in its Measurement column (not "Value") and
-- keeps its unit in the Unit column; a row a plate run wrote is shown in the
-- plate results list, so it is left out here rather than listed twice.
DO $migration$
DECLARE
  d text := pg_get_functiondef('api.sample_measurement_provenance(uuid)'::regprocedure);
  d2 text;
BEGIN
  d2 := replace(d,
    $old$      m.label AS measurement,
      m.value_num AS value,
      m.value_num::text AS value_text,
      coalesce(m.quantity->>'symbol', m.quantity->>'storageUnit') AS unit,$old$,
    $new$      coalesce(
        (SELECT nv.text_value FROM api.dataset_schema_version_fields nf
           JOIN api.dataset_row_values nv ON nv.row_id = m.row_id AND nv.field_id = nf.field_id
          WHERE nf.schema_version_id = m.schema_version_id AND nf.lifecycle = 'active'
            AND nf.key = 'measurement' AND nf.logical_type = 'text'),
        m.label) AS measurement,
      m.value_num AS value,
      m.value_num::text AS value_text,
      coalesce(
        (SELECT uv.text_value FROM api.dataset_schema_version_fields uf
           JOIN api.dataset_row_values uv ON uv.row_id = m.row_id AND uv.field_id = uf.field_id
          WHERE uf.schema_version_id = m.schema_version_id AND uf.lifecycle = 'active'
            AND uf.key = 'unit' AND uf.logical_type = 'text'),
        m.quantity->>'symbol', m.quantity->>'storageUnit') AS unit,$new$);
  IF d2 = d THEN RAISE EXCEPTION 'could not extend sample_measurement_provenance (select list)'; END IF;
  d := d2;
  d2 := replace(d,
    $old$    ) m
  ),
  integration_measures AS ($old$,
    $new$    ) m
     WHERE NOT EXISTS (
       SELECT 1 FROM api.dataset_schema_version_fields pf
         JOIN api.dataset_row_values pv ON pv.row_id = m.row_id AND pv.field_id = pf.field_id
        WHERE pf.schema_version_id = m.schema_version_id AND pf.lifecycle = 'active'
          AND pf.key = 'plate_run' AND pf.logical_type = 'text')
  ),
  integration_measures AS ($new$);
  IF d2 = d THEN RAISE EXCEPTION 'could not extend sample_measurement_provenance (plate rows)'; END IF;
  EXECUTE d2;
END $migration$;
