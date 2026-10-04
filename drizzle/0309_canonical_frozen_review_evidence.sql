-- Preserve canonical identities and scientific metadata in the existing frozen
-- composition. Review reads this evidence, never the current Dataset or cache.
CREATE OR REPLACE FUNCTION internal.build_frozen_composed_sheet_grid (p_instance_state jsonb, p_definition_version_id uuid, p_dataset_versions jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = ''
  AS $$
DECLARE
  config jsonb;
  IDENTITY jsonb;
  columns jsonb := '[]';
  column_item jsonb;
  hidden text[] := '{}';
  ordered text[] := '{}';
  column_id text;
  ROWS jsonb := '[]';
  row_keys jsonb := '[]';
  cells jsonb;
  row_key text;
  local_row jsonb;
  root_binding text;
  root_version uuid;
  root_row record;
  join_item jsonb;
  left_field uuid;
  right_field uuid;
  right_version uuid;
  right_rows uuid[];
  left_key uuid;
  include_row boolean;
  sources jsonb;
  identity_values jsonb;
  identity_column text;
  identity_binding text;
  identity_field uuid;
  value_item jsonb;
  field jsonb;
  cell_value jsonb;
  binding_id text;
  source_field text;
BEGIN
  IF p_definition_version_id IS NULL THEN
    config := jsonb_build_object('columns', '[]'::jsonb);
  ELSE
    SELECT
      configuration
    INTO
      config
    FROM
      api.sheet_definition_versions
    WHERE
      id = p_definition_version_id
      AND lifecycle = 'published';
    IF config IS NULL THEN
      RAISE EXCEPTION 'frozen Sheet Definition missing'
        USING ERRCODE = 'SB092';
    END IF;
  END IF;
  SELECT
    coalesce(array_agg(value), '{}')
  INTO
    hidden
  FROM
    jsonb_array_elements_text(coalesce(p_instance_state -> 'presentation' -> 'hiddenColumnIds', '[]'));
  ordered := ARRAY (
    SELECT
      value
    FROM
      jsonb_array_elements_text(coalesce(p_instance_state -> 'presentation' -> 'columnOrder', config -> 'presentation' -> 'columnOrder', '[]')));
  FOR column_item IN
  SELECT
    value
  FROM
    jsonb_array_elements(config -> 'columns')
    LOOP
      column_id := column_item ->> 'id';
      IF column_id = ANY (hidden) THEN
        CONTINUE;
      END IF;
      IF column_id <> ALL (ordered) THEN
        ordered := array_append(ordered, column_id);
      END IF;
    END LOOP;
  FOR column_item IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(p_instance_state -> 'localFields', '[]'))
    LOOP
      column_id := column_item ->> 'fieldId';
      IF column_id = ANY (hidden) THEN
        CONTINUE;
      END IF;
      IF column_id <> ALL (ordered) THEN
        ordered := array_append(ordered, column_id);
      END IF;
    END LOOP;
  FOR column_item IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(p_instance_state -> 'instanceCalculations', '[]'))
  WHERE
    value ->> 'lifecycle' = 'active' LOOP
      column_id := column_item ->> 'id';
      IF column_id = ANY (hidden) THEN
        CONTINUE;
      END IF;
      IF column_id <> ALL (ordered) THEN
        ordered := array_append(ordered, column_id);
      END IF;
    END LOOP;
  FOREACH column_id IN ARRAY ordered LOOP
    IF column_id = ANY (hidden) THEN
      CONTINUE;
    END IF;
    SELECT
      value
    INTO
      column_item
    FROM
      jsonb_array_elements(config -> 'columns')
    WHERE
      value ->> 'id' = column_id;
    IF column_item IS NULL THEN
      SELECT
        value
      INTO
        field
      FROM
        jsonb_array_elements(coalesce(p_instance_state -> 'localFields', '[]'))
      WHERE
        value ->> 'fieldId' = column_id;
      IF field IS NULL THEN
        SELECT
          value -> 'outputField'
        INTO
          field
        FROM
          jsonb_array_elements(coalesce(p_instance_state -> 'instanceCalculations', '[]'))
        WHERE
          value ->> 'id' = column_id
          AND value ->> 'lifecycle' = 'active';
      END IF;
      IF field IS NULL THEN
        CONTINUE;
      END IF;
      column_item := jsonb_build_object('id', column_id, 'field', field, 'source', jsonb_build_object('kind', 'local'));
    ELSE
      field := column_item -> 'field';
    END IF;
    columns := columns || jsonb_build_array(column_item || jsonb_build_object('label', coalesce(nullif (field ->> 'label', ''), field ->> 'key', 'Column')));
  END LOOP;
  IDENTITY := p_instance_state -> 'resolvedRowIdentity';
  IF IDENTITY IS NULL OR IDENTITY = 'null'::jsonb THEN
    IDENTITY := config -> 'rowIdentity';
    SELECT
      value
    INTO
      column_item
    FROM
      jsonb_array_elements(config -> 'columns')
    WHERE
      value ->> 'id' = IDENTITY -> 'columnIds' ->> 0;
    IDENTITY := IDENTITY || jsonb_build_object('formatVersion', 1, 'logicalTypes', (
        SELECT
          jsonb_agg(col -> 'field' ->> 'logicalType' ORDER BY ids.ordinality)
        FROM jsonb_array_elements(IDENTITY -> 'columnIds')
        WITH ORDINALITY ids
        JOIN LATERAL jsonb_array_elements(config -> 'columns') col ON col ->> 'id' = ids.value #>> '{}'), 'sourceBindingId', CASE WHEN IDENTITY ->> 'kind' = 'source' THEN
        column_item -> 'source' ->> 'bindingId'
      END, 'sourceFieldId', CASE WHEN IDENTITY ->> 'kind' = 'source' THEN
        column_item -> 'source' ->> 'sourceFieldId'
      END);
  END IF;
  IF IDENTITY ->> 'kind' IN ('source', 'composite') THEN
    root_binding := coalesce((config -> 'joins') -> 0 ->> 'leftBindingId', (config -> 'bindings') -> 0 ->> 'id');
    SELECT
      (value ->> 'datasetVersionId')::uuid
    INTO
      root_version
    FROM
      jsonb_array_elements(coalesce(p_dataset_versions, '[]'))
    WHERE
      value ->> 'bindingId' = root_binding;
    IF root_version IS NOT NULL THEN
      FOR root_row IN
      SELECT
        row_id,
        revision
      FROM
        api.dataset_version_rows
      WHERE
        dataset_version_id = root_version
      ORDER BY
        row_id
      LIMIT 200 LOOP
        include_row := TRUE;
        sources := jsonb_build_array(jsonb_build_object('bindingId', root_binding, 'values', internal.dataset_version_source_values (root_version, root_row.row_id)));
        FOR join_item IN
        SELECT
          value
        FROM
          jsonb_array_elements(coalesce(config -> 'joins', '[]'))
          LOOP
            SELECT
              c.value -> 'source' ->> 'sourceFieldId'
            INTO
              source_field
            FROM
              jsonb_array_elements(config -> 'columns') c
WHERE
  c.value ->> 'id' = join_item ->> 'leftColumnId';
            left_field := source_field::uuid;
            SELECT
              (c.value -> 'source' ->> 'sourceFieldId')::uuid
            INTO
              right_field
            FROM
              jsonb_array_elements(config -> 'columns') c
WHERE
  c.value ->> 'id' = join_item ->> 'rightColumnId';
            SELECT
              (value ->> 'datasetVersionId')::uuid
            INTO
              right_version
            FROM
              jsonb_array_elements(coalesce(p_dataset_versions, '[]'))
            WHERE
              value ->> 'bindingId' = join_item ->> 'rightBindingId';
            SELECT
              reference_id
            INTO
              left_key
            FROM
              api.dataset_version_values
            WHERE
              dataset_version_id = root_version
              AND row_id = root_row.row_id
              AND field_id = left_field
            ORDER BY
              ordinal
            LIMIT 1;
            IF left_key IS NULL THEN
              IF join_item ->> 'joinType' = 'inner' THEN
                include_row := FALSE;
              END IF;
              CONTINUE;
            END IF;
            SELECT
              array_agg(r.row_id ORDER BY r.row_id)
            INTO
              right_rows
            FROM
              api.dataset_version_rows r
              JOIN api.dataset_version_values rv ON rv.dataset_version_id = r.dataset_version_id
                AND rv.row_id = r.row_id
                AND rv.field_id = right_field
            WHERE
              r.dataset_version_id = right_version
              AND rv.reference_id = left_key;
            IF coalesce(array_length(right_rows, 1), 0) = 1 THEN
              sources := sources || jsonb_build_array(jsonb_build_object('bindingId', join_item ->> 'rightBindingId', 'values', internal.dataset_version_source_values (right_version, right_rows[1])));
            ELSIF join_item ->> 'joinType' = 'inner' THEN
              include_row := FALSE;
            ELSE
              sources := sources || jsonb_build_array(jsonb_build_object('bindingId', join_item ->> 'rightBindingId', 'values', '{}'::jsonb));
            END IF;
          END LOOP;
        IF NOT include_row THEN
          CONTINUE;
        END IF;
        identity_values := '[]';
        FOR identity_column IN
        SELECT
          value
        FROM
          jsonb_array_elements_text(IDENTITY -> 'columnIds')
          LOOP
            SELECT
              c.value -> 'source' ->> 'bindingId',
              (c.value -> 'source' ->> 'sourceFieldId')::uuid
            INTO
              identity_binding,
              identity_field
            FROM
              jsonb_array_elements(config -> 'columns') c
WHERE
  c.value ->> 'id' = identity_column;
            SELECT
              s.value -> 'values' -> identity_field::text
            INTO
              value_item
            FROM
              jsonb_array_elements(sources) s
WHERE
  s.value ->> 'bindingId' = identity_binding;
            identity_values := identity_values || jsonb_build_array(coalesce(value_item, 'null'));
          END LOOP;
        row_key := internal.sheet_row_identity_key (IDENTITY, identity_values);
        cells := '[]';
        FOR column_item IN
        SELECT
          value
        FROM
          jsonb_array_elements(columns)
          LOOP
            column_id := column_item ->> 'id';
            IF column_item -> 'source' ->> 'kind' = 'bound' THEN
              binding_id := column_item -> 'source' ->> 'bindingId';
              source_field := column_item -> 'source' ->> 'sourceFieldId';
              SELECT
                s.value -> 'values' -> source_field
              INTO
                cell_value
              FROM
                jsonb_array_elements(sources) s
WHERE
  s.value ->> 'bindingId' = binding_id;
            ELSE
              cell_value := p_instance_state -> 'localValues' -> row_key -> column_id;
            END IF;
            cells := cells || jsonb_build_array(cell_value);
          END LOOP;
        ROWS := ROWS || jsonb_build_array(cells);
        row_keys := row_keys || jsonb_build_array(row_key);
      END LOOP;
    END IF;
  END IF;
  FOR row_key,
  local_row IN
  SELECT
    key,
    value
  FROM
    jsonb_each(coalesce(p_instance_state -> 'localValues', '{}'))
  ORDER BY
    key LOOP
      IF row_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        CONTINUE;
      END IF;
      cells := '[]';
      FOR column_item IN
      SELECT
        value
      FROM
        jsonb_array_elements(columns)
        LOOP
          cells := cells || jsonb_build_array(local_row -> (column_item ->> 'id'));
        END LOOP;
      ROWS := ROWS || jsonb_build_array(cells);
      row_keys := row_keys || jsonb_build_array(row_key);
    END LOOP;
  RETURN jsonb_build_object('columns', columns, 'rows', ROWS, 'rowKeys', row_keys);
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.persist_revision_sheet_evidence (p_revision_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  revision api.revisions;
  item jsonb;
  binding jsonb;
  frozen jsonb;
  SNAPSHOT api.dataset_versions;
  dataset_row api.datasets;
  version_id uuid;
  seen jsonb := '{}';
  grid jsonb;
  config jsonb;
  calculation jsonb;
  calculations jsonb;
  artifacts jsonb;
  expected_expression jsonb;
  expected_scope text;
  results jsonb;
  fields jsonb;
  output_id text;
  column_position int;
  row_position int;
  result_item jsonb;
BEGIN
  SELECT
    *
  INTO
    revision
  FROM
    api.revisions
  WHERE
    id = p_revision_id;
  IF revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found'
      USING ERRCODE = '22023';
  END IF;
  FOR item IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(revision.canonical_snapshot -> 'sheetEvidence', '[]'))
    LOOP
      IF EXISTS (
        SELECT
          1
        FROM
          api.revision_sheet_evidence
        WHERE
          revision_id = revision.id
          AND block_id = (item ->> 'blockId')::uuid) THEN
      CONTINUE;
    END IF;
  frozen := '[]';
  FOR binding IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(item -> 'datasetBindings', '[]'))
    LOOP
      IF binding ->> 'datasetId' IS NULL THEN
        CONTINUE;
      END IF;
      version_id := NULL;
      IF binding ->> 'policyMode' = 'version' AND binding ->> 'datasetVersionId' IS NOT NULL THEN
        version_id := (binding ->> 'datasetVersionId')::uuid;
      ELSIF seen ? (binding ->> 'datasetId') THEN
        version_id := (seen ->> (binding ->> 'datasetId'))::uuid;
      ELSE
        SELECT
          *
        INTO
          dataset_row
        FROM
          api.datasets
        WHERE
          id = (binding ->> 'datasetId')::uuid
          AND workspace_id = revision.workspace_id;
        IF dataset_row.id IS NULL THEN
          RAISE EXCEPTION 'Dataset for Sheet evidence is missing'
            USING ERRCODE = 'SB092';
        END IF;
        SNAPSHOT := api.snapshot_dataset (dataset_row.id, (binding ->> 'datasetRevision')::bigint, 'Notebook revision sheet evidence');
        version_id := snapshot.id;
        seen := seen || jsonb_build_object(binding ->> 'datasetId', version_id);
      END IF;
      frozen := frozen || jsonb_build_array(jsonb_build_object('bindingId', binding ->> 'bindingId', 'datasetId', binding ->> 'datasetId', 'datasetVersionId', version_id, 'policyMode', binding ->> 'policyMode'));
    END LOOP;
  grid := internal.build_frozen_composed_sheet_grid (item -> 'instanceState', nullif (item ->> 'sourceDefinitionVersionId', '')::uuid, frozen);
  config := NULL;
  SELECT
    v.configuration
  INTO
    config
  FROM
    api.sheet_definition_versions v
    JOIN api.sheet_definitions d ON d.id = v.definition_id
  WHERE
    v.id = nullif (item ->> 'sourceDefinitionVersionId', '')::uuid
    AND d.workspace_id = revision.workspace_id;
  fields := coalesce((
    SELECT
      jsonb_agg(value -> 'field')
    FROM jsonb_array_elements(coalesce(config -> 'columns', '[]'))), '[]') || coalesce(item -> 'instanceState' -> 'localFields', '[]') || coalesce((
    SELECT
      jsonb_agg(value -> 'outputField')
    FROM jsonb_array_elements(coalesce(item -> 'instanceState' -> 'instanceCalculations', '[]'))
    WHERE
      value ->> 'lifecycle' = 'active'), '[]');
  artifacts := '[]';
  calculations := coalesce(config -> 'calculations', '[]') || coalesce(item -> 'instanceState' -> 'instanceCalculations', '[]');
  FOR calculation IN
  SELECT
    value
  FROM
    jsonb_array_elements(calculations)
    LOOP
      IF calculation ? 'outputColumnId' THEN
        IF coalesce(item -> 'instanceState' -> 'calculationOverrides' -> (calculation ->> 'id') ->> 'enabled', 'true') <> 'true' THEN
          CONTINUE;
        END IF;
        expected_scope := 'definition';
        expected_expression := coalesce(item -> 'instanceState' -> 'calculationOverrides' -> (calculation ->> 'id') -> 'expression', calculation -> 'expression');
      ELSE
        IF calculation ->> 'lifecycle' <> 'active' THEN
          CONTINUE;
        END IF;
        expected_scope := 'instance';
        expected_expression := calculation -> 'expression';
      END IF;
      SELECT
        coalesce(jsonb_agg(to_jsonb (r) || jsonb_build_object('calculationStatus', CASE WHEN internal.sheet_calculation_result_current ((item ->> 'instanceRevision')::bigint, r.instance_revision, r.source_revisions)
            AND r.expression = expected_expression
            AND r.scope = expected_scope
            AND (expected_scope <> 'definition'
                OR r.definition_version_id = nullif (item ->> 'sourceDefinitionVersionId', '')::uuid) THEN
                'current'
              ELSE
                'stale'
              END)
          ORDER BY r.row_key), '[]')
      INTO
        results
      FROM
        internal.sheet_instance_calculation_results r
      WHERE
        r.instance_id = (item ->> 'instanceId')::uuid
        AND r.workspace_id = revision.workspace_id
        AND r.calculation_id = (calculation ->> 'id')::uuid
        AND r.row_key IN (
          SELECT
            value
          FROM
            jsonb_array_elements_text(grid -> 'rowKeys'));
      artifacts := artifacts || jsonb_build_array(calculation || jsonb_build_object('scope', expected_scope, 'expression', expected_expression, 'results', results, 'expectedRowKeys', grid -> 'rowKeys'));
      output_id := coalesce(calculation ->> 'outputColumnId', calculation ->> 'id');
      SELECT
        ORDINALITY::int -1
      INTO
        column_position
      FROM
        jsonb_array_elements(grid -> 'columns')
  WITH ORDINALITY
WHERE
  value ->> 'id' = output_id;
      IF column_position IS NOT NULL THEN
        FOR result_item IN
        SELECT
          value
        FROM
          jsonb_array_elements(results)
        WHERE
          value ->> 'calculationStatus' = 'current'
          AND value ->> 'result_kind' = 'value' LOOP
            SELECT
              ORDINALITY::int -1
            INTO
              row_position
            FROM
              jsonb_array_elements_text(grid -> 'rowKeys')
  WITH ORDINALITY
WHERE
  value = result_item ->> 'row_key';
            grid := jsonb_set(grid, ARRAY['rows', row_position::text, column_position::text], result_item -> 'value');
          END LOOP;
      END IF;
    END LOOP;
  grid := grid || jsonb_build_object('fields', fields, 'calculations', artifacts);
  INSERT INTO api.revision_sheet_evidence (workspace_id, revision_id, block_id, instance_id, source_definition_version_id, instance_revision, instance_state, dataset_versions, composed_grid)
    VALUES (revision.workspace_id, revision.id, (item ->> 'blockId')::uuid, (item ->> 'instanceId')::uuid, nullif (item ->> 'sourceDefinitionVersionId', '')::uuid, (item ->> 'instanceRevision')::bigint, item -> 'instanceState', frozen, grid)
  ON CONFLICT (revision_id, block_id)
    DO NOTHING;
END LOOP;
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.evaluate_check_item (p_envelope jsonb, p_check_item jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  rule_type text := p_check_item -> 'rule' ->> 'type';
  item_status text := 'pass';
  evidence jsonb := '{}';
  field_text text;
  field_value jsonb;
  array_len int;
  min_count int;
  path_text text;
  table_item jsonb;
  column_item jsonb;
  logical_type text;
  total_columns int := 0;
  invalid_columns jsonb := '[]';
  formula_item jsonb;
  calc_item jsonb;
  sheet jsonb;
  artifact jsonb;
  total_formulas int := 0;
  unsupported_formulas jsonb := '[]';
  stale_formulas jsonb := '[]';
  missing_results jsonb := '[]';
  formula_version_text text;
  calc_version_text text;
  tables jsonb := coalesce(p_envelope -> 'scientificTables', '[]');
  formulas jsonb := coalesce(p_envelope -> 'formulas', '[]');
  result_status text;
  link_item jsonb;
  link_type text;
  found_link_types text[] := '{}';
  required_link_types text[] := '{}';
  missing_link_types text[] := '{}';
  required_type text;
BEGIN
  -- Normalize frozen canonical evidence into the existing check vocabulary.
  -- No Dataset, Instance or calculation cache reads occur during review.
  FOR sheet IN
  SELECT
    value
  FROM
    jsonb_array_elements(coalesce(p_envelope -> 'sheetEvidence', '[]'))
    LOOP
      tables := tables || jsonb_build_array(jsonb_build_object('id', sheet ->> 'blockId', 'columns', coalesce(sheet -> 'composedGrid' -> 'fields', sheet -> 'instanceState' -> 'localFields', '[]')));
      FOR artifact IN
      SELECT
        value
      FROM
        jsonb_array_elements(coalesce(sheet -> 'composedGrid' -> 'calculations', sheet -> 'instanceState' -> 'instanceCalculations', '[]'))
        LOOP
          IF artifact ->> 'lifecycle' = 'retired' THEN
            CONTINUE;
          END IF;
          result_status := 'completed';
          IF artifact -> 'results' IS NULL OR jsonb_array_length(artifact -> 'results') = 0 OR EXISTS (
            SELECT
              1
            FROM
              jsonb_array_elements_text(coalesce(artifact -> 'expectedRowKeys', '[]')) k
            WHERE
              NOT EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(coalesce(artifact -> 'results', '[]')) r
              WHERE
                r ->> 'row_key' = k.value)) THEN
            result_status := 'missing';
          ELSIF EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(artifact -> 'results') r
              WHERE
                r ->> 'calculationStatus' IS DISTINCT FROM 'current') THEN
            result_status := 'stale';
          ELSIF EXISTS (
              SELECT
                1
              FROM
                jsonb_array_elements(artifact -> 'results') r
              WHERE
                r ->> 'result_kind' IS DISTINCT FROM 'value') THEN
            result_status := 'error';
          END IF;
          formulas := formulas || jsonb_build_array(jsonb_build_object('id', (sheet ->> 'blockId') || ':' || (artifact ->> 'id'), 'status', CASE WHEN artifact -> 'expression' ->> 'language' = 'sheetbase-formula-v1'
                AND NOT EXISTS (
                  SELECT
                    1
                  FROM jsonb_array_elements(coalesce(artifact -> 'results', '[]')) r
                WHERE
                  r ->> 'result_kind' = 'error') THEN
                'supported'
              ELSE
                'unsupported'
              END, 'version', sheet -> 'instanceRevision', 'calculation', CASE WHEN result_status = 'missing' THEN
                NULL
              ELSE
                jsonb_build_object('formula_version', sheet -> 'instanceRevision', 'status', result_status)
              END));
        END LOOP;
    END LOOP;
  IF rule_type = 'completeness-title' THEN
    field_text := p_envelope -> 'record' ->> 'title';
    IF field_text IS NULL OR btrim(field_text) = '' THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('title', to_jsonb (field_text));
  ELSIF rule_type = 'min-count' THEN
    path_text := p_check_item -> 'rule' ->> 'path';
    field_value := p_envelope -> path_text;
    array_len := CASE WHEN jsonb_typeof(field_value) = 'array' THEN
      jsonb_array_length(field_value)
    ELSE
      0
    END;
    min_count := coalesce((p_check_item -> 'rule' ->> 'minCount')::int, 0);
    IF array_len < min_count THEN
      item_status := 'fail';
    END IF;
    evidence := jsonb_build_object('path', path_text, 'count', array_len, 'minCount', min_count);
  ELSIF rule_type = 'schema-valid-columns' THEN
    FOR table_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(tables)
      LOOP
        FOR column_item IN
        SELECT
          value
        FROM
          jsonb_array_elements(coalesce(table_item -> 'columns', '[]'))
          LOOP
            total_columns := total_columns + 1;
            logical_type := coalesce(column_item ->> 'logicalType', column_item ->> 'logical_type');
            IF logical_type IS NULL OR logical_type NOT IN ('text', 'integer', 'decimal', 'boolean', 'date', 'timestamp', 'category', 'reference') THEN
              item_status := 'fail';
              invalid_columns := invalid_columns || jsonb_build_array(jsonb_build_object('tableId', table_item ->> 'id', 'columnId', coalesce(column_item ->> 'id', column_item ->> 'fieldId'), 'fieldName', coalesce(column_item ->> 'fieldName', column_item ->> 'field_name', column_item ->> 'key'), 'logicalType', to_jsonb (logical_type)));
            END IF;
          END LOOP;
      END LOOP;
    evidence := jsonb_build_object('totalColumns', total_columns, 'invalidColumns', invalid_columns);
  ELSIF rule_type = 'formula-supported' THEN
    FOR formula_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(formulas)
      LOOP
        total_formulas := total_formulas + 1;
        IF formula_item ->> 'status' IS DISTINCT FROM 'supported' THEN
          item_status := 'fail';
          unsupported_formulas := unsupported_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'status', formula_item ->> 'status'));
        END IF;
      END LOOP;
    evidence := jsonb_build_object('totalFormulas', total_formulas, 'unsupportedFormulas', unsupported_formulas);
  ELSIF rule_type = 'formula-no-stale' THEN
    FOR formula_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(formulas)
      LOOP
        total_formulas := total_formulas + 1;
        calc_item := formula_item -> 'calculation';
        formula_version_text := formula_item ->> 'version';
        IF calc_item IS NULL OR jsonb_typeof(calc_item) = 'null' THEN
          item_status := 'fail';
          missing_results := missing_results || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'reason', 'no_cached_result'));
        ELSE
          calc_version_text := calc_item ->> 'formula_version';
          IF calc_version_text IS DISTINCT FROM formula_version_text THEN
            item_status := 'fail';
            stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'formulaVersion', formula_version_text, 'cachedVersion', calc_version_text, 'reason', 'version_mismatch'));
          ELSIF calc_item ->> 'status' IS DISTINCT FROM 'completed' THEN
            item_status := 'fail';
            stale_formulas := stale_formulas || jsonb_build_array(jsonb_build_object('id', formula_item ->> 'id', 'calculationStatus', calc_item ->> 'status', 'reason', 'incomplete'));
          END IF;
        END IF;
      END LOOP;
    evidence := jsonb_build_object('totalFormulas', total_formulas, 'staleFormulas', stale_formulas, 'missingResults', missing_results);
  ELSIF rule_type = 'required-links' THEN
    FOR required_type IN
    SELECT
      value
    FROM
      jsonb_array_elements_text(coalesce(p_check_item -> 'rule' -> 'linkTypes', '[]'))
      LOOP
        required_link_types := array_append(required_link_types, required_type);
      END LOOP;
    FOR link_item IN
    SELECT
      value
    FROM
      jsonb_array_elements(coalesce(p_envelope -> 'links', '[]'))
      LOOP
        link_type := coalesce(link_item ->> 'linkType', link_item ->> 'link_type');
        IF link_type IS NOT NULL AND NOT (link_type = ANY (found_link_types)) THEN
          found_link_types := array_append(found_link_types, link_type);
        END IF;
      END LOOP;
    FOREACH required_type IN ARRAY required_link_types LOOP
      IF NOT (required_type = ANY (found_link_types)) THEN
        item_status := 'fail';
        missing_link_types := array_append(missing_link_types, required_type);
      END IF;
    END LOOP;
    evidence := jsonb_build_object('requiredLinkTypes', to_jsonb (required_link_types), 'foundLinkTypes', to_jsonb (found_link_types), 'missingLinkTypes', to_jsonb (missing_link_types));
  ELSE
    item_status := 'fail';
    evidence := jsonb_build_object('error', 'unknown rule type', 'ruleType', rule_type);
  END IF;
  RETURN jsonb_build_object('key', p_check_item ->> 'key', 'category', p_check_item ->> 'category', 'severity', p_check_item ->> 'severity', 'label', p_check_item ->> 'label', 'status', item_status, 'evidence', evidence);
END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.run_revision_checks (p_revision_id uuid, p_check_definition_key text, p_check_definition_version integer, p_confirmed boolean, p_idempotency_key text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
  AS $$
DECLARE
  claimed_workspace uuid;
  actor text;
  session_id text;
  actor_role text;
  revision_row api.revisions;
  definition_row internal.review_check_definitions;
  check_item jsonb;
  item_result jsonb;
  results jsonb := '[]';
  envelope jsonb;
  sheets jsonb;
  overall_status text := 'pass';
  pass_count int := 0;
  blocking_failures int := 0;
  warning_failures int := 0;
  info_failures int := 0;
  input_digest text;
  definition_digest text;
  existing_result api.review_check_results;
  run_at timestamptz := clock_timestamp();
  result_row api.review_check_results;
BEGIN
  BEGIN
    claimed_workspace := nullif (api.claim_probe () ->> 'workspace_id', '')::uuid;
    actor := nullif (api.claim_probe () ->> 'sub', '');
    session_id := nullif (api.claim_probe () ->> 'session_id', '');
    actor_role := nullif (api.claim_probe () ->> 'role', '');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END;
  IF claimed_workspace IS NULL OR actor IS NULL OR session_id IS NULL OR actor_role <> 'authenticated' OR p_confirmed IS DISTINCT FROM TRUE OR NOT api.is_workspace_member (claimed_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
    END IF;
    IF p_check_definition_key IS NULL OR p_check_definition_key !~ '^[a-z0-9][a-z0-9_-]{0,127}$' OR coalesce(p_check_definition_version, 0) < 1 THEN
      RAISE EXCEPTION 'versioned check definition is required' USING ERRCODE = '22023';
      END IF;
      IF p_idempotency_key IS NULL OR length(p_idempotency_key)
        NOT BETWEEN 1 AND 128 THEN
        RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
        END IF;
        SELECT
          *
        INTO
          definition_row
        FROM
          internal.review_check_definitions
        WHERE
          definition_key = p_check_definition_key
          AND version = p_check_definition_version;
          IF definition_row.definition_key IS NULL THEN
            RAISE EXCEPTION 'unknown check definition version' USING ERRCODE = '22023';
            END IF;
            SELECT
              *
            INTO
              revision_row
            FROM
              api.revisions
            WHERE
              id = p_revision_id
              AND workspace_id = claimed_workspace;
              IF revision_row.id IS NULL THEN
                RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
                END IF;
                -- Verify the signed envelope before supplementing it, including replay.
                input_digest := internal.revision_integrity_digest (revision_row.canonical_snapshot);
                IF input_digest <> revision_row.integrity_digest THEN
                  RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE = 'SB001';
                  END IF;
                  definition_digest := encode(sha256 (convert_to(definition_row.definition::text, 'UTF8')), 'hex');
                  SELECT
                    *
                  INTO
                    existing_result
                  FROM
                    api.review_check_results
                  WHERE
                    workspace_id = claimed_workspace
                    AND run_by_user_id = actor
                    AND idempotency_key = p_idempotency_key;
                    IF existing_result.id IS NOT NULL THEN
                      IF existing_result.revision_id <> p_revision_id OR existing_result.check_definition_key <> p_check_definition_key OR existing_result.check_definition_version <> p_check_definition_version THEN
                        RAISE EXCEPTION 'idempotency key was used for a different check run' USING ERRCODE = '23505';
                        END IF;
                        RETURN jsonb_build_object('id', existing_result.id, 'overallStatus', existing_result.overall_status, 'passCount', existing_result.pass_count, 'blockingFailureCount', existing_result.blocking_failure_count, 'warningFailureCount', existing_result.warning_failure_count, 'infoFailureCount', existing_result.info_failure_count, 'idempotent', TRUE);
                      END IF;
                      envelope := revision_row.canonical_snapshot;
                      SELECT
                        jsonb_agg(jsonb_build_object('blockId', e.block_id, 'instanceId', e.instance_id, 'instanceRevision', e.instance_revision, 'sourceDefinitionVersionId', e.source_definition_version_id, 'instanceState', e.instance_state, 'datasetBindings', e.dataset_versions, 'composedGrid', e.composed_grid)
                        ORDER BY e.block_id)
                      INTO
                        sheets
                      FROM
                        api.revision_sheet_evidence e
                      WHERE
                        e.revision_id = revision_row.id
                        AND e.workspace_id = claimed_workspace;
                        IF sheets IS NOT NULL THEN
                          envelope := envelope || jsonb_build_object('sheetEvidence', sheets);
                          END IF;
                          FOR check_item IN
                          SELECT
                            t.value
                          FROM
                            jsonb_array_elements(definition_row.definition -> 'checks')
  WITH ORDINALITY t (value, ord)
ORDER BY
  t.ord LOOP
    item_result := internal.evaluate_check_item (envelope, check_item);
    results := results || jsonb_build_array(item_result);
    IF item_result ->> 'status' = 'pass' THEN
      pass_count := pass_count + 1;
    ELSIF item_result ->> 'severity' = 'blocking' THEN
      blocking_failures := blocking_failures + 1;
    ELSIF item_result ->> 'severity' = 'warning' THEN
      warning_failures := warning_failures + 1;
    ELSIF item_result ->> 'severity' = 'informational' THEN
      info_failures := info_failures + 1;
      END IF;
    END LOOP;
    IF blocking_failures > 0 THEN
      overall_status := 'fail';
    ELSIF warning_failures > 0 THEN
      overall_status := 'warning';
      END IF;
    INSERT INTO api.review_check_results (workspace_id, record_id, revision_id, check_definition_key, check_definition_version, revision_integrity_digest, check_definition_digest, input_digest, overall_status, pass_count, blocking_failure_count, warning_failure_count, info_failure_count, results, run_by_user_id, run_session_id, run_role, run_at, idempotency_key, created_at)
      VALUES (claimed_workspace, revision_row.record_id, revision_row.id, p_check_definition_key, p_check_definition_version, revision_row.integrity_digest, definition_digest, input_digest, overall_status, pass_count, blocking_failures, warning_failures, info_failures, results, actor, session_id, actor_role, run_at, p_idempotency_key, run_at)
    RETURNING
      *
    INTO
      result_row;
      RETURN jsonb_build_object('id', result_row.id, 'revisionId', result_row.revision_id, 'checkDefinitionKey', result_row.check_definition_key, 'checkDefinitionVersion', result_row.check_definition_version, 'revisionIntegrityDigest', result_row.revision_integrity_digest, 'checkDefinitionDigest', result_row.check_definition_digest, 'inputDigest', result_row.input_digest, 'overallStatus', result_row.overall_status, 'passCount', result_row.pass_count, 'blockingFailureCount', result_row.blocking_failure_count, 'warningFailureCount', result_row.warning_failure_count, 'infoFailureCount', result_row.info_failure_count, 'results', result_row.results, 'runAt', result_row.run_at, 'idempotent', FALSE);
EXCEPTION
  WHEN unique_violation THEN
    SELECT
      *
    INTO
      existing_result
    FROM
      api.review_check_results
    WHERE
      workspace_id = claimed_workspace
      AND run_by_user_id = actor
      AND idempotency_key = p_idempotency_key;
      IF existing_result.id IS NOT NULL AND existing_result.revision_id = p_revision_id AND existing_result.check_definition_key = p_check_definition_key AND existing_result.check_definition_version = p_check_definition_version THEN
        RETURN jsonb_build_object('id', existing_result.id, 'overallStatus', existing_result.overall_status, 'passCount', existing_result.pass_count, 'blockingFailureCount', existing_result.blocking_failure_count, 'warningFailureCount', existing_result.warning_failure_count, 'infoFailureCount', existing_result.info_failure_count, 'idempotent', TRUE);
        END IF;
        RAISE;
END
$$;

--> statement-breakpoint
NOTIFY pgrst,
'reload schema';

