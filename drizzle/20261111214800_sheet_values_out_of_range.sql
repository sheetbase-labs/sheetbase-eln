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
