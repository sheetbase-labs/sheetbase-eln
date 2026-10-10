-- DSET-05.4 — the import review RPC built its jsonb_set path with
-- `ARRAY[<integer>, 'flags']`, so Postgres inferred `integer[]` and rejected
-- the text element ("invalid input syntax for type integer: \"flags\").
-- Any file with an out-of-range row (or any flagged / high-CV row) therefore
-- failed the whole review with a 400. Rebuild the path as `text[]`. Function
-- body is otherwise unchanged from 0300.
CREATE OR REPLACE FUNCTION api.preview_dataset_import_rows(
  p_dataset_id uuid,
  p_rows jsonb,
  p_control_field_id uuid DEFAULT NULL,
  p_control_pattern text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  dataset api.datasets;
  item jsonb;
  row_index integer := 0;
  keys text[] := '{}';
  planned_map jsonb := '{}'::jsonb;
  out_rows jsonb := '[]'::jsonb;
  field api.dataset_schema_version_fields;
  effective jsonb;
  v_num numeric;
  lo numeric;
  hi numeric;
  rule jsonb;
  violated boolean;
  v_reason text;
  has_value boolean;
  unit_text text;
  v_planned_id uuid;
  v_outcome text;
  control_value text;
  hc_field api.dataset_schema_version_fields;
  hc jsonb;
  group_field_id uuid;
  max_cv numeric;
  min_reps integer;
  group_rec record;
  idx integer;
  flag jsonb;
BEGIN
  SELECT * INTO dataset FROM api.datasets d
   WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(d.workspace_id);
  IF dataset.id IS NULL THEN
    RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'rows must be an array' USING ERRCODE = '22023';
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(item -> 'plannedKey') = 'string' THEN
      keys := array_append(keys, item ->> 'plannedKey');
    END IF;
  END LOOP;
  IF array_length(keys, 1) IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(r.planned_key, r.id), '{}'::jsonb) INTO planned_map
      FROM api.dataset_rows r
     WHERE r.dataset_id = dataset.id AND r.status = 'planned'
       AND r.planned_key = ANY(keys);
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_index := row_index + 1;
    v_planned_id := NULL;
    v_outcome := 'new';
    control_value := NULL;
    IF jsonb_typeof(item -> 'plannedKey') = 'string' THEN
      v_planned_id := nullif(planned_map ->> (item ->> 'plannedKey'), '')::uuid;
    END IF;
    IF v_planned_id IS NOT NULL THEN v_outcome := 'planned'; END IF;

    IF p_control_field_id IS NOT NULL AND p_control_pattern IS NOT NULL
       AND item -> 'values' ? p_control_field_id::text THEN
      control_value := item -> 'values' ->> p_control_field_id::text;
      IF control_value IS NOT NULL AND control_value ~* p_control_pattern THEN
        v_outcome := 'skipped';
      END IF;
    END IF;

    out_rows := out_rows || jsonb_build_array(jsonb_build_object(
      'index', row_index,
      'outcome', v_outcome,
      'plannedKey', item ->> 'plannedKey',
      'plannedRowId', v_planned_id,
      'flags', '[]'::jsonb));

    FOR field IN
      SELECT * FROM api.dataset_schema_version_fields f
       WHERE f.schema_version_id = dataset.schema_version_id AND f.lifecycle = 'active'
       ORDER BY f.display_order
    LOOP
      effective := item -> 'values' -> field.field_id::text;

      rule := field.validation #> '{extensions,systemFlags,out_of_range}';
      violated := false;
      v_reason := NULL;
      v_num := NULL;
      IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
         AND field.logical_type IN ('integer', 'decimal')
         AND effective IS NOT NULL AND jsonb_typeof(effective) = 'number' THEN
        v_num := (effective #>> '{}')::numeric;
        IF rule ? 'min' THEN
          lo := (rule ->> 'min')::numeric;
          IF v_num < lo THEN
            violated := true;
            v_reason := format('Value %s is below the minimum %s', v_num, lo);
          END IF;
        END IF;
        IF NOT violated AND rule ? 'max' THEN
          hi := (rule ->> 'max')::numeric;
          IF v_num > hi THEN
            violated := true;
            v_reason := format('Value %s is above the maximum %s', v_num, hi);
          END IF;
        END IF;
      END IF;
      IF violated THEN
        flag := jsonb_build_object('fieldId', field.field_id, 'kind', 'out_of_range', 'reason', v_reason);
        out_rows := jsonb_set(out_rows, ARRAY[(row_index - 1)::text, 'flags'],
          (out_rows -> (row_index - 1) -> 'flags') || jsonb_build_array(flag));
      END IF;

      rule := field.validation #> '{extensions,systemFlags,missing_unit}';
      violated := false;
      v_reason := NULL;
      has_value := effective IS NOT NULL AND effective <> 'null'::jsonb;
      unit_text := nullif(btrim(coalesce(field.quantity ->> 'storageUnit', field.quantity ->> 'symbol')), '');
      IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
         AND coalesce((rule ->> 'requiresUnit')::boolean, false) IS TRUE
         AND field.logical_type IN ('integer', 'decimal')
         AND has_value AND unit_text IS NULL THEN
        violated := true;
        v_reason := format('No unit is recorded for %s', field.label);
      END IF;
      IF violated THEN
        flag := jsonb_build_object('fieldId', field.field_id, 'kind', 'missing_unit', 'reason', v_reason);
        out_rows := jsonb_set(out_rows, ARRAY[(row_index - 1)::text, 'flags'],
          (out_rows -> (row_index - 1) -> 'flags') || jsonb_build_array(flag));
      END IF;
    END LOOP;
  END LOOP;

  -- high_cv across the batch's replicate groups.
  FOR hc_field IN
    SELECT * FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = dataset.schema_version_id AND f.lifecycle = 'active'
       AND f.logical_type IN ('integer', 'decimal')
       AND jsonb_typeof(f.validation #> '{extensions,systemFlags,high_cv}') = 'object'
     ORDER BY f.display_order
  LOOP
    hc := hc_field.validation #> '{extensions,systemFlags,high_cv}';
    IF hc ->> 'groupByFieldId' IS NULL OR hc ->> 'maxCvPercent' IS NULL
       OR hc ->> 'groupByFieldId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR hc ->> 'maxCvPercent' !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      CONTINUE;
    END IF;
    group_field_id := (hc ->> 'groupByFieldId')::uuid;
    max_cv := (hc ->> 'maxCvPercent')::numeric;
    min_reps := greatest(coalesce((hc ->> 'minReplicates')::integer, 3), 2);
    FOR group_rec IN
      SELECT g.group_key, count(*) AS n, avg(g.val) AS mean, stddev_samp(g.val) AS sd,
             array_agg(g.idx) AS idxs
        FROM (
          SELECT (e.ord - 1) AS idx,
                 e.item -> 'values' ->> group_field_id::text AS group_key,
                 nullif(e.item -> 'values' ->> hc_field.field_id::text, '')::numeric AS val
            FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS e(item, ord)
        ) g
       WHERE g.group_key IS NOT NULL AND g.group_key <> '' AND g.val IS NOT NULL
       GROUP BY g.group_key
      HAVING count(*) >= min_reps
    LOOP
      IF group_rec.mean IS NOT NULL AND group_rec.mean <> 0 AND group_rec.sd IS NOT NULL
         AND abs(group_rec.sd / group_rec.mean) * 100 > max_cv THEN
        FOR idx IN SELECT unnest(group_rec.idxs) LOOP
          flag := jsonb_build_object(
            'fieldId', hc_field.field_id, 'kind', 'high_cv',
            'reason', format('Replicate CV %s%% exceeds %s%%', round(abs(group_rec.sd / group_rec.mean) * 100, 2), max_cv));
          out_rows := jsonb_set(out_rows, ARRAY[idx::text, 'flags'],
            (out_rows -> idx -> 'flags') || jsonb_build_array(flag));
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- Any row with a flag is classified flagged (skipped wins over flagged).
  FOR idx IN SELECT generate_series(0, jsonb_array_length(out_rows) - 1) LOOP
    IF (out_rows -> idx ->> 'outcome') <> 'skipped'
       AND jsonb_array_length(out_rows -> idx -> 'flags') > 0 THEN
      out_rows := jsonb_set(out_rows, ARRAY[idx::text, 'outcome'], '"flagged"'::jsonb);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rows', out_rows,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(out_rows),
      'added', (SELECT count(*) FROM jsonb_array_elements(out_rows) x
                 WHERE x ->> 'outcome' <> 'skipped'),
      'planned', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'planned'),
      'new', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'new'),
      'flagged', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'flagged'),
      'skipped', (SELECT count(*) FROM jsonb_array_elements(out_rows) x WHERE x ->> 'outcome' = 'skipped')));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.preview_dataset_import_rows(uuid, jsonb, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.preview_dataset_import_rows(uuid, jsonb, uuid, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
