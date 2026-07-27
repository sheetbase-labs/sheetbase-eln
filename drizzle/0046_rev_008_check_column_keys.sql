-- REV-008: the canonical snapshot built by internal.build_revision_envelope
-- serializes scientific_columns with to_jsonb(column_row), so each column
-- carries the physical snake_case keys (field_name, logical_type), not the
-- camelCase keys (fieldName, logicalType) the synthetic review-check fixtures
-- use. The schema-valid-columns check read only the camelCase keys, so for
-- every real DB revision it saw logicalType = NULL and marked every column
-- invalid — a false blocking failure that blocked approval/signing of real
-- experiments. Read both shapes so the check works against real snapshots
-- while remaining compatible with the existing camelCase fixtures.
CREATE OR REPLACE FUNCTION "internal"."evaluate_check_item"(
  p_envelope jsonb,
  p_check_item jsonb
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  rule_type text := p_check_item->'rule'->>'type';
  item_status text := 'pass';
  evidence jsonb := '{}'::jsonb;

  field_text text;
  field_value jsonb;
  array_len int;
  min_count int;
  path_text text;

  table_item jsonb;
  column_item jsonb;
  logical_type text;
  total_columns int := 0;
  invalid_columns jsonb := '[]'::jsonb;

  formula_item jsonb;
  calc_item jsonb;
  total_formulas int := 0;
  unsupported_formulas jsonb := '[]'::jsonb;
  stale_formulas jsonb := '[]'::jsonb;
  missing_results jsonb := '[]'::jsonb;
  formula_version_text text;
  calc_version_text text;

  link_item jsonb;
  link_type text;
  found_link_types text[] := ARRAY[]::text[];
  required_link_types text[] := ARRAY[]::text[];
  missing_link_types text[] := ARRAY[]::text[];
  required_type text;
BEGIN
  IF rule_type = 'completeness-title' THEN
    field_text := p_envelope->'record'->>'title';
    IF field_text IS NULL OR btrim(field_text) = '' THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('title', to_jsonb(field_text));

  ELSIF rule_type = 'min-count' THEN
    path_text := p_check_item->'rule'->>'path';
    field_value := p_envelope->path_text;
    array_len := CASE WHEN jsonb_typeof(field_value) = 'array'
      THEN jsonb_array_length(field_value) ELSE 0 END;
    min_count := COALESCE((p_check_item->'rule'->>'minCount')::int, 0);
    IF array_len < min_count THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object(
      'path', path_text,
      'count', array_len,
      'minCount', min_count
    );

  ELSIF rule_type = 'schema-valid-columns' THEN
    FOR table_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'scientificTables') = 'array'
          THEN p_envelope->'scientificTables' ELSE '[]'::jsonb END
      )
    LOOP
      FOR column_item IN
        SELECT value FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(table_item->'columns') = 'array'
            THEN table_item->'columns' ELSE '[]'::jsonb END
        )
      LOOP
        total_columns := total_columns + 1;
        -- Read both the camelCase (fixture) and snake_case (real
        -- to_jsonb(column_row) snapshot) column key shapes.
        logical_type := coalesce(
          column_item->>'logicalType',
          column_item->>'logical_type'
        );
        IF logical_type IS NULL
           OR logical_type NOT IN (
             'text','integer','decimal','boolean','date','timestamp','category','reference'
           ) THEN
          item_status := 'fail';
          invalid_columns := invalid_columns || jsonb_build_array(jsonb_build_object(
            'tableId', table_item->>'id',
            'columnId', column_item->>'id',
            'fieldName', coalesce(column_item->>'fieldName', column_item->>'field_name'),
            'logicalType', to_jsonb(logical_type)
          ));
        END IF;
      END LOOP;
    END LOOP;
    evidence := jsonb_build_object(
      'totalColumns', total_columns,
      'invalidColumns', invalid_columns
    );

  ELSIF rule_type = 'formula-supported' THEN
    FOR formula_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'formulas') = 'array'
          THEN p_envelope->'formulas' ELSE '[]'::jsonb END
      )
    LOOP
      total_formulas := total_formulas + 1;
      IF formula_item->>'status' <> 'supported' THEN
        item_status := 'fail';
        unsupported_formulas := unsupported_formulas || jsonb_build_array(jsonb_build_object(
          'id', formula_item->>'id',
          'status', formula_item->>'status'
        ));
      END IF;
    END LOOP;
    evidence := jsonb_build_object(
      'totalFormulas', total_formulas,
      'unsupportedFormulas', unsupported_formulas
    );

  ELSIF rule_type = 'formula-no-stale' THEN
    FOR formula_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'formulas') = 'array'
          THEN p_envelope->'formulas' ELSE '[]'::jsonb END
      )
    LOOP
      total_formulas := total_formulas + 1;
      calc_item := formula_item->'calculation';
      formula_version_text := formula_item->>'version';

      IF calc_item IS NULL OR jsonb_typeof(calc_item) = 'null' THEN
        item_status := 'fail';
        missing_results := missing_results || jsonb_build_array(jsonb_build_object(
          'id', formula_item->>'id',
          'reason', 'no_cached_result'
        ));
      ELSE
        calc_version_text := calc_item->>'formula_version';
        IF calc_version_text IS DISTINCT FROM formula_version_text THEN
          item_status := 'fail';
          stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object(
            'id', formula_item->>'id',
            'formulaVersion', formula_version_text,
            'cachedVersion', calc_version_text,
            'reason', 'version_mismatch'
          ));
        ELSIF calc_item->>'status' <> 'completed' THEN
          item_status := 'fail';
          stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object(
            'id', formula_item->>'id',
            'calculationStatus', calc_item->>'status',
            'reason', 'incomplete'
          ));
        END IF;
      END IF;
    END LOOP;
    evidence := jsonb_build_object(
      'totalFormulas', total_formulas,
      'staleFormulas', stale_formulas,
      'missingResults', missing_results
    );

  ELSIF rule_type = 'required-links' THEN
    FOR required_type IN
      SELECT value FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(p_check_item->'rule'->'linkTypes') = 'array'
          THEN p_check_item->'rule'->'linkTypes' ELSE '[]'::jsonb END
      )
    LOOP
      required_link_types := array_append(required_link_types, required_type);
    END LOOP;

    FOR link_item IN
      SELECT value FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(p_envelope->'links') = 'array'
          THEN p_envelope->'links' ELSE '[]'::jsonb END
      )
    LOOP
      link_type := coalesce(link_item->>'linkType', link_item->>'link_type');
      IF link_type IS NOT NULL AND NOT (link_type = ANY(found_link_types)) THEN
        found_link_types := array_append(found_link_types, link_type);
      END IF;
    END LOOP;

    FOREACH required_type IN ARRAY required_link_types LOOP
      IF NOT (required_type = ANY(found_link_types)) THEN
        item_status := 'fail';
        missing_link_types := array_append(missing_link_types, required_type);
      END IF;
    END LOOP;

    evidence := jsonb_build_object(
      'requiredLinkTypes', to_jsonb(required_link_types),
      'foundLinkTypes', to_jsonb(found_link_types),
      'missingLinkTypes', to_jsonb(missing_link_types)
    );

  ELSE
    item_status := 'fail';
    evidence := jsonb_build_object('error', 'unknown rule type', 'ruleType', rule_type);
  END IF;

  RETURN jsonb_build_object(
    'key', p_check_item->>'key',
    'category', p_check_item->>'category',
    'severity', p_check_item->>'severity',
    'label', p_check_item->>'label',
    'status', item_status,
    'evidence', evidence
  );
END;
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
