-- Numbers outside a field's allowed range are stored and flagged instead of
-- refused, in a sheet's own columns and in dataset rows alike. The lab enters
-- what the instrument read; the sheet shows the value in danger text and says
-- what is wrong when the cell is selected. Types, cardinality, text rules,
-- categories and references are still checked. Records keep their own rule.
--
-- The whole sheet state is checked on every write, so before this one stored
-- out-of-range value refused every later write to that sheet.

CREATE OR REPLACE FUNCTION internal.sheet_local_cell_error(p_workspace_id uuid, p_field jsonb, p_value jsonb) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE item jsonb; target_model text;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN
    RETURN CASE WHEN (p_field->>'nullable')::boolean OR p_field->'defaultValue'<>'null'::jsonb THEN NULL ELSE 'required_value' END;
  END IF;
  IF p_field->>'cardinality'='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value) NOT BETWEEN 1 AND 1000 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(CASE WHEN p_field->>'cardinality'='many' THEN p_value ELSE '[]'::jsonb END)
    UNION ALL SELECT p_value WHERE p_field->>'cardinality'='one'
  LOOP
    IF NOT internal.sheet_definition_scalar_matches(p_field->>'logicalType',item) THEN RETURN 'invalid_value'; END IF;
    IF p_field->>'logicalType'='text' AND
       ((p_field->'validation' ? 'minLength' AND length(item#>>'{}')<(p_field->'validation'->>'minLength')::integer)
        OR (p_field->'validation' ? 'maxLength' AND length(item#>>'{}')>(p_field->'validation'->>'maxLength')::integer)
        OR (p_field->'validation' ? 'pattern' AND item#>>'{}' !~ (p_field->'validation'->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    -- A number outside the allowed range is stored and flagged, not refused.
    IF p_field->>'logicalType'='category' AND
       (p_field->'category'->>'kind'<>'embedded' OR NOT EXISTS(
         SELECT 1 FROM jsonb_array_elements(p_field->'category'->'options') option
         WHERE option->>'id'=item#>>'{}' AND option->>'lifecycle'='active')) THEN RETURN 'invalid_category_option'; END IF;
    IF p_field->>'logicalType'='reference' THEN
      target_model:=p_field->'relationship'->'target'->>'modelKey';
      IF p_field->'relationship'->'target'->>'kind'<>'model' OR target_model IS NULL OR NOT EXISTS(
        SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind
        WHERE r.id=(item#>>'{}')::uuid AND r.workspace_id=p_workspace_id
          AND r.deleted_at IS NULL AND m.key=target_model
      ) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- Dataset rows: the batch check and the per-value guard.
CREATE OR REPLACE FUNCTION internal.dataset_batch_cell_error(p_workspace_id uuid, p_field api.dataset_schema_version_fields, p_value jsonb) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE item jsonb; target_model text;
BEGIN
  IF p_value IS NULL OR p_value='null'::jsonb THEN
    RETURN CASE WHEN p_field.nullable THEN NULL ELSE 'required_value' END;
  END IF;
  -- The canonical kernel deliberately has no many-valued defaults. Treat a
  -- malformed stored default as invalid rather than letting it satisfy required.
  IF p_field.cardinality='many' AND p_value IS NOT NULL AND p_value <> 'null'::jsonb
     AND p_value = p_field.default_value THEN RETURN 'invalid_default'; END IF;
  IF p_field.cardinality='many' THEN
    IF jsonb_typeof(p_value)<>'array' OR jsonb_array_length(p_value)=0 THEN RETURN 'invalid_cardinality'; END IF;
  ELSIF jsonb_typeof(p_value)='array' THEN RETURN 'invalid_cardinality'; END IF;
  FOR item IN
    SELECT value FROM jsonb_array_elements(CASE WHEN p_field.cardinality='many' THEN p_value ELSE '[]'::jsonb END)
    UNION ALL SELECT p_value WHERE p_field.cardinality='one'
  LOOP
    IF (p_field.logical_type='text' AND jsonb_typeof(item)<>'string') OR
       (p_field.logical_type IN ('integer','decimal') AND jsonb_typeof(item)<>'number') OR
       (p_field.logical_type='boolean' AND jsonb_typeof(item)<>'boolean') OR
       (p_field.logical_type IN ('date','timestamp','category','reference') AND jsonb_typeof(item)<>'string') THEN RETURN 'invalid_value_type'; END IF;
    BEGIN
      IF p_field.logical_type='integer' THEN PERFORM (item#>>'{}')::bigint;
      ELSIF p_field.logical_type='decimal' THEN PERFORM (item#>>'{}')::numeric;
      ELSIF p_field.logical_type='date' THEN PERFORM (item#>>'{}')::date;
      ELSIF p_field.logical_type='timestamp' THEN PERFORM (item#>>'{}')::timestamptz;
      ELSIF p_field.logical_type IN ('category','reference') THEN PERFORM (item#>>'{}')::uuid;
      END IF;
    EXCEPTION WHEN others THEN RETURN 'invalid_value'; END;
    IF p_field.logical_type='text' AND ((p_field.validation ? 'minLength' AND length(item#>>'{}')<(p_field.validation->>'minLength')::integer) OR (p_field.validation ? 'maxLength' AND length(item#>>'{}')>(p_field.validation->>'maxLength')::integer) OR (p_field.validation ? 'pattern' AND item#>>'{}' !~ (p_field.validation->>'pattern'))) THEN RETURN 'text_validation'; END IF;
    -- A number outside the allowed range is stored and flagged, not refused.
    IF p_field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_field.category->'options','[]'::jsonb)) option WHERE option->>'id'=item#>>'{}' AND option->>'lifecycle'='active') THEN RETURN 'invalid_category_option'; END IF;
    IF p_field.logical_type='reference' THEN
      target_model:=coalesce(p_field.relationship->'target'->>'modelKey',p_field.validation->>'targetModelKey');
      IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.records r JOIN api.model_kinds m ON m.record_kind=r.kind WHERE r.id=(item#>>'{}')::uuid AND r.workspace_id=p_workspace_id AND r.deleted_at IS NULL AND m.key=target_model) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION internal.validate_dataset_row_value() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE field api.dataset_schema_version_fields; slots integer; target_model text;
BEGIN
 SELECT f.* INTO field FROM api.dataset_rows r JOIN api.datasets d ON d.id=r.dataset_id JOIN api.dataset_schema_version_fields f ON f.schema_version_id=d.schema_version_id AND f.field_id=NEW.field_id WHERE r.id=NEW.row_id;
 IF field.id IS NULL OR field.lifecycle <> 'active' THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
 IF field.cardinality='one' AND NEW.ordinal<>0 THEN RAISE EXCEPTION 'scalar Dataset fields require ordinal zero' USING ERRCODE='22023'; END IF;
 slots := (NEW.text_value IS NOT NULL)::int+(NEW.integer_value IS NOT NULL)::int+(NEW.numeric_value IS NOT NULL)::int+(NEW.boolean_value IS NOT NULL)::int+(NEW.date_value IS NOT NULL)::int+(NEW.timestamp_value IS NOT NULL)::int+(NEW.category_option_id IS NOT NULL)::int+(NEW.reference_id IS NOT NULL)::int;
 IF slots <> 1 THEN RAISE EXCEPTION 'exactly one typed Dataset value is required' USING ERRCODE='22023'; END IF;
 IF (field.logical_type='text' AND NEW.text_value IS NULL) OR (field.logical_type='integer' AND NEW.integer_value IS NULL) OR (field.logical_type='decimal' AND NEW.numeric_value IS NULL) OR (field.logical_type='boolean' AND NEW.boolean_value IS NULL) OR (field.logical_type='date' AND NEW.date_value IS NULL) OR (field.logical_type='timestamp' AND NEW.timestamp_value IS NULL) OR (field.logical_type='category' AND NEW.category_option_id IS NULL) OR (field.logical_type='reference' AND NEW.reference_id IS NULL) THEN RAISE EXCEPTION 'Dataset value does not match field logical type' USING ERRCODE='22023'; END IF;
 IF field.logical_type='text' AND ((field.validation ? 'minLength' AND length(NEW.text_value)<(field.validation->>'minLength')::integer) OR (field.validation ? 'maxLength' AND length(NEW.text_value)>(field.validation->>'maxLength')::integer) OR (field.validation ? 'pattern' AND NEW.text_value !~ (field.validation->>'pattern'))) THEN RAISE EXCEPTION 'text validation failed' USING ERRCODE='SB071'; END IF;
 -- A number outside the allowed range is stored and flagged, not refused.
 IF field.logical_type='category' AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(field.category->'options','[]'::jsonb)) o WHERE o->>'id'=NEW.category_option_id::text AND o->>'lifecycle'='active') THEN RAISE EXCEPTION 'category option is not active for this field' USING ERRCODE='SB071'; END IF;
 IF field.logical_type='reference' THEN
   target_model := coalesce(field.relationship->'target'->>'modelKey',field.validation->>'targetModelKey');
   IF target_model IS NULL OR NOT EXISTS (SELECT 1 FROM api.dataset_rows r JOIN api.records record ON record.id=NEW.reference_id AND record.workspace_id=r.workspace_id JOIN api.model_kinds m ON m.record_kind=record.kind WHERE r.id=NEW.row_id AND m.key=target_model AND record.deleted_at IS NULL) THEN RAISE EXCEPTION 'reference does not target an active compatible Record' USING ERRCODE='SB071'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- A dataset field's default must still sit inside its own range.
CREATE OR REPLACE FUNCTION internal.assert_publishable_dataset_schema_version() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE field api.dataset_schema_version_fields; workspace_id uuid; error_code text;
BEGIN
  IF OLD.lifecycle='draft' AND NEW.lifecycle='active' THEN
    SELECT s.workspace_id INTO workspace_id FROM api.dataset_schema_definitions s WHERE s.id=NEW.schema_id;
    FOR field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id=NEW.id LOOP
      IF btrim(field.key)='' OR btrim(field.label)='' THEN RAISE EXCEPTION 'Dataset Schema field key and label must be nonblank' USING ERRCODE='SB071'; END IF;
      IF field.cardinality NOT IN ('one','many') OR field.logical_type NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference') THEN RAISE EXCEPTION 'invalid Dataset Schema field type metadata' USING ERRCODE='SB071'; END IF;
      IF field.cardinality='many' AND field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN RAISE EXCEPTION 'many Dataset fields cannot have defaults' USING ERRCODE='SB071'; END IF;
      IF jsonb_typeof(field.validation) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END IF;
      BEGIN
        IF (field.validation ? 'min' AND jsonb_typeof(field.validation->'min')<>'number') OR (field.validation ? 'max' AND jsonb_typeof(field.validation->'max')<>'number') OR (field.validation ? 'min' AND field.validation ? 'max' AND (field.validation->>'min')::numeric>(field.validation->>'max')::numeric) THEN RAISE EXCEPTION 'invalid Dataset numeric validation metadata' USING ERRCODE='SB071'; END IF;
        IF (field.validation ? 'minLength' AND (jsonb_typeof(field.validation->'minLength')<>'number' OR (field.validation->>'minLength') !~ '^[0-9]+$')) OR (field.validation ? 'maxLength' AND (jsonb_typeof(field.validation->'maxLength')<>'number' OR (field.validation->>'maxLength') !~ '^[0-9]+$')) OR (field.validation ? 'minLength' AND field.validation ? 'maxLength' AND (field.validation->>'minLength')::integer>(field.validation->>'maxLength')::integer) THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF;
        IF field.validation ? 'pattern' THEN IF jsonb_typeof(field.validation->'pattern')<>'string' THEN RAISE EXCEPTION 'invalid Dataset text validation metadata' USING ERRCODE='SB071'; END IF; PERFORM '' ~ (field.validation->>'pattern'); END IF;
      EXCEPTION WHEN invalid_regular_expression OR invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'invalid Dataset validation metadata' USING ERRCODE='SB071'; END;
      IF field.quantity IS NOT NULL AND (field.logical_type NOT IN ('integer','decimal') OR jsonb_typeof(field.quantity)<>'object' OR coalesce(btrim(field.quantity->>'kind'),'')='' OR coalesce(btrim(field.quantity->>'dimension'),'')='' OR coalesce(btrim(field.quantity->>'storageUnit'),'')='') THEN RAISE EXCEPTION 'invalid Dataset quantity metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='category' THEN
        IF jsonb_typeof(field.category)<>'object' OR field.category->>'kind'<>'embedded' OR jsonb_typeof(field.category->'options')<>'array' THEN RAISE EXCEPTION 'unsupported Dataset category metadata' USING ERRCODE='SB071'; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o WHERE jsonb_typeof(o)<>'object' OR coalesce(btrim(o->>'id'),'')='' OR coalesce(btrim(o->>'key'),'')='' OR coalesce(btrim(o->>'label'),'')='' OR o->>'lifecycle' NOT IN ('active','retired') OR coalesce(o->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'id' HAVING count(*)>1) OR EXISTS (SELECT 1 FROM jsonb_array_elements(field.category->'options') o GROUP BY o->>'key' HAVING count(*)>1) THEN RAISE EXCEPTION 'invalid Dataset category options' USING ERRCODE='SB071'; END IF;
      ELSIF field.category IS NOT NULL THEN RAISE EXCEPTION 'only category fields may have category metadata' USING ERRCODE='SB071'; END IF;
      IF field.logical_type='reference' THEN
        IF jsonb_typeof(field.relationship)<>'object' OR field.relationship->'target'->>'kind'<>'model' OR coalesce(btrim(field.relationship->'target'->>'modelKey'),'')='' OR field.relationship->>'cardinality'<>field.cardinality THEN RAISE EXCEPTION 'invalid Dataset relationship metadata' USING ERRCODE='SB071'; END IF;
      ELSIF field.relationship IS NOT NULL THEN RAISE EXCEPTION 'only reference fields may have relationship metadata' USING ERRCODE='SB071'; END IF;
      IF field.default_value IS NOT NULL AND field.default_value<>'null'::jsonb THEN
        error_code:=internal.dataset_batch_cell_error(workspace_id,field,field.default_value);
        IF error_code IS NOT NULL THEN RAISE EXCEPTION 'invalid Dataset field default: %',error_code USING ERRCODE='SB071'; END IF;
        -- Stored values may fall outside the range and are flagged; a field's own
        -- default must still sit inside it.
        IF field.logical_type IN ('integer','decimal') AND jsonb_typeof(field.default_value)='number' AND ((field.validation ? 'min' AND (field.default_value#>>'{}')::numeric<(field.validation->>'min')::numeric) OR (field.validation ? 'max' AND (field.default_value#>>'{}')::numeric>(field.validation->>'max')::numeric)) THEN RAISE EXCEPTION 'invalid Dataset field default: numeric_validation' USING ERRCODE='SB071'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $_$;

-- A value outside its field's allowed range raises the same out-of-range flag
-- a field's own flag rule does, on import preview and on every write.
CREATE OR REPLACE FUNCTION api.preview_dataset_import_rows(p_dataset_id uuid, p_rows jsonb, p_control_field_id uuid DEFAULT NULL::uuid, p_control_pattern text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
 IF p_dataset_id IS NOT NULL THEN PERFORM internal.assert_object_access('dataset',p_dataset_id,'view'); END IF;
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

      rule := coalesce(
        field.validation #> '{extensions,systemFlags,out_of_range}',
        -- The field's own allowed range flags a value outside it, too.
        CASE WHEN field.logical_type IN ('integer', 'decimal')
              AND (field.validation ? 'min' OR field.validation ? 'max')
          THEN jsonb_strip_nulls(jsonb_build_object('min', field.validation -> 'min', 'max', field.validation -> 'max'))
        END);
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
END $_$;

CREATE OR REPLACE FUNCTION internal.sync_dataset_value_system_flags(p_dataset_id uuid, p_row_id uuid, p_schema_version_id uuid, p_provided jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  field api.dataset_schema_version_fields;
  rule jsonb;
  effective jsonb;
  v_num numeric;
  lo numeric;
  hi numeric;
  violated boolean;
  v_reason text;
  workspace uuid;
  has_value boolean;
  unit_text text;
BEGIN
  SELECT d.workspace_id INTO workspace FROM api.datasets d
    WHERE d.id = p_dataset_id AND d.workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(d.workspace_id) AND api.has_write_actor();
  IF workspace IS NULL THEN RETURN; END IF;
  FOR field IN
    SELECT * FROM api.dataset_schema_version_fields f
    WHERE f.schema_version_id = p_schema_version_id AND f.lifecycle = 'active'
    ORDER BY f.display_order
  LOOP
    -- out_of_range: exactly the existing soft min/max rule, now with provenance.
    rule := coalesce(
        field.validation #> '{extensions,systemFlags,out_of_range}',
        -- The field's own allowed range flags a value outside it, too.
        CASE WHEN field.logical_type IN ('integer', 'decimal')
              AND (field.validation ? 'min' OR field.validation ? 'max')
          THEN jsonb_strip_nulls(jsonb_build_object('min', field.validation -> 'min', 'max', field.validation -> 'max'))
        END);
    violated := false;
    v_reason := NULL;
    v_num := NULL;
    effective := NULL;
    IF p_provided ? field.field_id::text THEN
      effective := p_provided -> field.field_id::text;
    ELSE
      SELECT coalesce(to_jsonb(v.numeric_value), to_jsonb(v.integer_value))
        INTO effective
        FROM api.dataset_row_values v
        WHERE v.row_id = p_row_id AND v.field_id = field.field_id
        ORDER BY v.ordinal LIMIT 1;
      IF effective IS NULL THEN effective := field.default_value; END IF;
    END IF;
    IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
       AND field.logical_type IN ('integer','decimal')
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
    PERFORM internal.apply_system_flag(
      workspace, p_dataset_id, p_row_id, field.field_id, 'out_of_range',
      coalesce(v_reason, 'Out of range rule now passes'),
      to_jsonb(v_num),
      jsonb_strip_nulls(jsonb_build_object('min', rule -> 'min', 'max', rule -> 'max')),
      violated);

    -- missing_unit: opt-in per field, numeric fields only, and pinned to the
    -- Schema's unit metadata rather than the value.
    rule := field.validation #> '{extensions,systemFlags,missing_unit}';
    violated := false;
    v_reason := NULL;
    has_value := (p_provided ? field.field_id::text
                  AND p_provided -> field.field_id::text <> 'null'::jsonb)
                 OR internal.dataset_row_field_value_text(p_row_id, field.field_id) IS NOT NULL;
    unit_text := nullif(btrim(coalesce(field.quantity ->> 'storageUnit', field.quantity ->> 'symbol')), '');
    IF rule IS NOT NULL AND jsonb_typeof(rule) = 'object'
       AND coalesce((rule ->> 'requiresUnit')::boolean, false) IS TRUE
       AND field.logical_type IN ('integer','decimal')
       AND has_value AND unit_text IS NULL THEN
      violated := true;
      v_reason := format('No unit is recorded for %s', field.label);
    END IF;
    PERFORM internal.apply_system_flag(
      workspace, p_dataset_id, p_row_id, field.field_id, 'missing_unit',
      coalesce(v_reason, 'Unit now recorded'),
      to_jsonb(unit_text),
      jsonb_build_object('requiresUnit', true),
      violated);
  END LOOP;
END $$;
