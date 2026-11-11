-- A sheet's own number columns keep a value outside the allowed range and
-- flag it, instead of refusing the write. The lab enters what the instrument
-- read; the sheet shows the value in danger text and says what is wrong when
-- the cell is selected. Types, cardinality, text rules, categories and
-- references are still checked. Dataset rows keep their own rule.
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
