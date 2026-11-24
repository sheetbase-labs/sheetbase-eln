-- What an instrument run reads for a sample is a measurement of that sample, so
-- it is written to the Sample measurements dataset as well as kept as a quality
-- check. The quality check stays: the release gate reads its verdict. A check
-- with no number (a plain pass or fail) is only a quality check.
CREATE OR REPLACE FUNCTION api.record_run_sample_results(p_workspace_id uuid, p_run_id uuid, p_results jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_entry jsonb;
  v_check jsonb;
  v_sample api.records;
  v_ident text;
  v_type text;
  v_name text;
  v_linked integer := 0;
  v_checks integer := 0;
  v_unknown jsonb := '[]'::jsonb;
  v_readings jsonb := '[]'::jsonb;
  v_method text;
  v_value numeric;
BEGIN
  IF p_run_id IS NOT NULL THEN PERFORM internal.assert_object_access('run', p_run_id, 'edit'); END IF;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT r.run_identifier || coalesce(' · ' || i.name, '') INTO v_method
    FROM api.instrument_runs r
    LEFT JOIN api.instruments i ON i.id = r.instrument_id
   WHERE r.id = p_run_id AND r.workspace_id = p_workspace_id;
  IF v_method IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB039';
  END IF;
  IF jsonb_typeof(coalesce(p_results, 'null'::jsonb)) <> 'array' OR jsonb_array_length(p_results) > 2000 THEN
    RAISE EXCEPTION 'invalid sample results' USING ERRCODE = 'SB043';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    v_ident := nullif(btrim(coalesce(v_entry ->> 'sample', '')), '');
    IF v_ident IS NULL THEN CONTINUE; END IF;
    SELECT * INTO v_sample FROM api.records
     WHERE workspace_id = p_workspace_id AND kind = 'sample'
       AND lower(identifier) = lower(v_ident) AND deleted_at IS NULL
     LIMIT 1;
    IF v_sample.id IS NULL OR NOT internal.can_access_object('record', v_sample.id, 'view') THEN
      v_unknown := v_unknown || to_jsonb(v_ident);
      CONTINUE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM api.instrument_run_links
       WHERE run_id = p_run_id AND linked_record_id = v_sample.id AND link_type = 'sample') THEN
      INSERT INTO api.instrument_run_links
        (workspace_id, run_id, linked_record_id, linked_record_identifier,
         linked_record_title, link_type)
      VALUES
        (p_workspace_id, p_run_id, v_sample.id, v_sample.identifier, v_sample.title, 'sample');
      v_linked := v_linked + 1;
    END IF;
    FOR v_check IN SELECT value FROM jsonb_array_elements(coalesce(v_entry -> 'checks', '[]'::jsonb)) LOOP
      v_name := nullif(btrim(coalesce(v_check ->> 'name', '')), '');
      v_type := coalesce(nullif(v_check ->> 'type', ''), 'info');
      IF v_name IS NULL OR length(v_name) > 200 OR v_type NOT IN ('pass', 'warning', 'fail', 'info') THEN
        CONTINUE;
      END IF;
      INSERT INTO api.instrument_qc_checks (workspace_id, run_id, check_name, check_type, message, detail)
      VALUES (
        p_workspace_id, p_run_id, v_name, v_type, nullif(v_check ->> 'message', ''),
        jsonb_strip_nulls(jsonb_build_object(
          'sampleId', v_sample.id,
          'sampleIdentifier', v_sample.identifier,
          'value', v_check -> 'value',
          'unit', v_check ->> 'unit')));
      v_checks := v_checks + 1;
      v_value := CASE WHEN jsonb_typeof(v_check -> 'value') = 'number' THEN (v_check ->> 'value')::numeric
                      WHEN v_check ->> 'value' ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$' THEN (v_check ->> 'value')::numeric
                 END;
      IF v_value IS NOT NULL THEN
        v_readings := v_readings || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'sample', v_sample.id,
          'measurement', v_name,
          'value', v_value,
          'unit', nullif(v_check ->> 'unit', ''),
          'method', v_method,
          'measured_at', now(),
          'notes', nullif(v_check ->> 'message', ''))));
      END IF;
    END LOOP;
  END LOOP;
  PERFORM internal.write_result_rows(p_workspace_id, 'sample_measurement', v_readings);
  RETURN jsonb_build_object('linked', v_linked, 'checks', v_checks, 'unknown', v_unknown);
END;
$_$;
