-- CORE-04.3 / 04.6: Model-scoped Sheet Record search and validate-without-commit.
-- Browser/session only. Not granted to api_client. Search is INVOKER so record
-- RLS applies. Validate is DEFINER with an explicit membership recheck and
-- never writes.

CREATE FUNCTION api.search_sheet_records(
  p_model_key text,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 25,
  p_include_archived boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_limit integer;
  v_q text;
  v_pattern text;
BEGIN
  IF NOT api.is_workspace_member(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'active workspace membership required' USING ERRCODE = '42501';
  END IF;
  IF p_model_key IS NULL OR length(btrim(p_model_key)) = 0 THEN
    RAISE EXCEPTION 'model key is required' USING ERRCODE = '22023';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
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
      WHERE r.kind = v_kind
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
$$;
REVOKE EXECUTE ON FUNCTION api.search_sheet_records(text, text, integer, boolean)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.search_sheet_records(text, text, integer, boolean)
  TO authenticated;

CREATE FUNCTION api.validate_sheet_record_batch(
  p_project_id uuid,
  p_model_key text,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  v_kind text;
  item jsonb;
  row_index integer := 0;
  results jsonb := '[]'::jsonb;
  errors jsonb;
  classification text;
  match_id uuid;
  existing api.records;
  custom jsonb;
  v_title text;
  v_row_key text;
  v_operation text;
  seen_keys text[] := '{}';
  seen_matches text[] := '{}';
  identifier_key text;
  duplicate_matches text[] := '{}';
BEGIN
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'active workspace membership required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.projects
     WHERE id = p_project_id AND workspace_id = workspace
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'model does not support Sheet Record batches' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0
     OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION '1 to 1000 batch rows are required' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(identifier), '{}')
    INTO duplicate_matches
    FROM (
      SELECT value->>'matchIdentifier' AS identifier
      FROM jsonb_array_elements(p_rows) value
      WHERE value->>'operation' = 'create'
        AND nullif(btrim(coalesce(value->>'matchIdentifier', '')), '') IS NOT NULL
      GROUP BY value->>'matchIdentifier'
      HAVING count(*) > 1
    ) d;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_index := row_index + 1;
    errors := '[]'::jsonb;
    classification := NULL;
    match_id := NULL;
    IF jsonb_typeof(item) <> 'object'
       OR jsonb_typeof(item->'rowKey') <> 'string'
       OR length(btrim(item->>'rowKey')) = 0
       OR item->>'operation' NOT IN ('create', 'link') THEN
      RAISE EXCEPTION 'invalid Sheet Record batch row shape' USING ERRCODE = '22023';
    END IF;
    v_row_key := item->>'rowKey';
    v_operation := item->>'operation';
    IF v_row_key = ANY (seen_keys) THEN
      RAISE EXCEPTION 'duplicate Sheet row key in batch' USING ERRCODE = '22023';
    END IF;
    seen_keys := array_append(seen_keys, v_row_key);

    IF v_operation = 'link' THEN
      BEGIN
        match_id := (item->>'recordId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'not-uuid',
          'message', 'Record reference identity is the Record UUID, not the Record ID or Name.'
        ));
        match_id := NULL;
      END;
      IF match_id IS NULL AND jsonb_array_length(errors) = 0 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'required',
          'message', 'Record reference is required.'
        ));
      ELSIF match_id IS NOT NULL THEN
        SELECT * INTO existing
          FROM api.records r
         WHERE r.id = match_id
           AND r.workspace_id = workspace
           AND r.kind = v_kind
           AND r.deleted_at IS NULL;
        IF existing.id IS NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'missing',
            'message', 'Record is not visible in this workspace and Model.'
          ));
        ELSIF existing.archived_at IS NOT NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'archived_target',
            'fieldName', 'recordId',
            'message', 'Archived Records cannot be newly linked from a Sheet.'
          ));
        ELSE
          classification := 'link';
        END IF;
      END IF;
    ELSE
      IF item ? 'identifier' THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'record_id_policy',
          'fieldName', 'identifier',
          'message', 'Sheet creation uses Model-generated PREFIX-YYYY-NNNN identifiers.'
        ));
      END IF;
      v_title := nullif(btrim(coalesce(item->>'title', '')), '');
      custom := coalesce(item->'values', '{}'::jsonb);
      IF jsonb_typeof(custom) <> 'object' THEN
        RAISE EXCEPTION 'invalid Sheet Record batch row shape' USING ERRCODE = '22023';
      END IF;
      identifier_key := nullif(btrim(coalesce(item->>'matchIdentifier', '')), '');
      IF identifier_key IS NOT NULL AND identifier_key = ANY (duplicate_matches) THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'duplicate_input_row',
          'fieldName', 'matchIdentifier',
          'message', 'Duplicate match identifier in this batch.'
        ));
      ELSIF identifier_key IS NOT NULL THEN
        seen_matches := array_append(seen_matches, identifier_key);
        SELECT * INTO existing
          FROM api.records r
         WHERE r.project_id = p_project_id
           AND r.kind = v_kind
           AND r.identifier = identifier_key
           AND r.deleted_at IS NULL;
        IF existing.id IS NOT NULL THEN
          IF existing.archived_at IS NOT NULL THEN
            errors := errors || jsonb_build_array(jsonb_build_object(
              'code', 'archived_target',
              'fieldName', 'matchIdentifier',
              'message', 'Matched Record is archived.'
            ));
          ELSE
            classification := 'existing';
            match_id := existing.id;
          END IF;
        END IF;
      END IF;
      IF classification IS NULL AND jsonb_array_length(errors) = 0 THEN
        IF v_title IS NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'required_value',
            'fieldName', 'title',
            'message', 'Record Name is required.'
          ));
        ELSE
          BEGIN
            PERFORM internal.validate_model_fields(workspace, p_model_key, custom, '{}'::jsonb);
            classification := 'create';
          EXCEPTION WHEN OTHERS THEN
            errors := errors || jsonb_build_array(jsonb_build_object(
              'code', SQLSTATE,
              'message', SQLERRM
            ));
          END;
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(errors) > 0 THEN
      classification := 'invalid';
      match_id := NULL;
    END IF;

    results := results || jsonb_build_array(jsonb_build_object(
      'rowIndex', row_index,
      'rowKey', v_row_key,
      'classification', classification,
      'recordId', match_id,
      'errors', errors
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(results) value
      WHERE value->>'classification' = 'invalid'
    ),
    'mutated', false,
    'rows', results
  );
END
$$;
REVOKE EXECUTE ON FUNCTION api.validate_sheet_record_batch(uuid, text, jsonb)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.validate_sheet_record_batch(uuid, text, jsonb)
  TO authenticated;
