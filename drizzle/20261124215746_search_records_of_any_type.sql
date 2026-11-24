-- Link pickers and sheet cells accept records of any record type.
--
-- Only the built-in kinds were found and accepted. A column can link to a record
-- type the lab defined too (a cell bank, a construct), so search and check those
-- the same way (internal.record_matches_model).

CREATE OR REPLACE FUNCTION api.search_sheet_records(p_model_key text, p_query text DEFAULT ''::text, p_limit integer DEFAULT 25, p_include_archived boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_limit integer;
  v_q text;
  v_pattern text;
BEGIN
  PERFORM api.require_capability(api.current_workspace_id(), 'record.link');
  IF p_model_key IS NULL OR length(btrim(p_model_key)) = 0 THEN
    RAISE EXCEPTION 'model key is required' USING ERRCODE = '22023';
  END IF;
  -- A built-in kind (sample, material...) or a record type the workspace
  -- defined (cell_bank, a subtype...): whatever a measurement table column
  -- can link to.
  IF NOT internal.record_model_key_exists(api.current_workspace_id(), p_model_key) THEN
    RAISE EXCEPTION 'model does not support Sheet Record search' USING ERRCODE = '22023';
  END IF;
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_q := btrim(coalesce(p_query, ''));
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(s)::jsonb)
    FROM (
      SELECT
        r.id,
        r.kind,
        r.identifier,
        r.title,
        r.status,
        (r.archived_at IS NOT NULL) AS archived
      FROM api.records r
      WHERE r.workspace_id = api.current_workspace_id()
        AND internal.record_matches_model(r.id, r.workspace_id, p_model_key)
        AND r.deleted_at IS NULL
        AND (p_include_archived OR r.archived_at IS NULL)
        AND (
          v_q = ''
          OR r.identifier ILIKE v_pattern ESCAPE '\'
          OR r.title ILIKE v_pattern ESCAPE '\'
          OR EXISTS (
            SELECT 1
            FROM jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
            WHERE e.value ILIKE v_pattern ESCAPE '\'
          )
        )
      ORDER BY
        CASE WHEN r.identifier = v_q THEN 0 ELSE 1 END,
        r.identifier
      LIMIT v_limit
    ) s
  ), '[]'::jsonb);
END
$function$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.sheet_local_cell_error(p_workspace_id uuid, p_field jsonb, p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      IF p_field->'relationship'->'target'->>'kind'<>'model' OR target_model IS NULL OR NOT internal.record_matches_model((item#>>'{}')::uuid,p_workspace_id,target_model) THEN RETURN 'invalid_reference'; END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END $function$;
