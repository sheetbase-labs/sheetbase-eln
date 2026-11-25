-- One kind of result, read across every dataset that holds it.
--
-- A measurement table says what a result looks like (ViCell viability, ddPCR
-- titre). Many datasets are built on it, and its subtypes. These two reads let
-- a person, a token, the assistant, an analysis and a pipeline ask for the
-- rows of one table across all of those datasets in one call, live or pinned to
-- snapshots, with the dataset and snapshot each row came from.
--
-- Both only show datasets the caller may open (internal.can_access_object), the
-- same rule as the dataset page. Fields are matched by their stable field id, so
-- datasets still on an older version of the table line up under the columns of
-- its latest published version; a field a dataset did not have yet reads as
-- missing.

-- The datasets that hold a measurement table's results, with the snapshots each
-- has, so a caller can choose what to read.
CREATE OR REPLACE FUNCTION api.measurement_table_sources(p_schema_definition_id uuid, p_include_subtypes boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE ws uuid := api.current_workspace_id(); def api.dataset_schema_definitions; result jsonb;
BEGIN
  SELECT * INTO def FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id;
  IF def.id IS NULL OR def.workspace_id IS DISTINCT FROM ws OR NOT api.is_workspace_member(ws) THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  WITH RECURSIVE tbl AS (
    SELECT id FROM api.dataset_schema_definitions WHERE id = def.id
    UNION ALL
    SELECT c.id FROM api.dataset_schema_definitions c JOIN tbl ON c.parent_id = tbl.id WHERE coalesce(p_include_subtypes, true)
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'datasetId', d.id,
      'displayId', d.display_id,
      'name', d.name,
      'tableId', sv.schema_id,
      'tableKey', sd.key,
      'schemaVersion', sv.version,
      'revision', d.revision,
      'rowCount', (SELECT count(*) FROM api.dataset_rows r WHERE r.dataset_id = d.id AND r.status = 'recorded'),
      'snapshots', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'datasetVersionId', dv.id, 'label', dv.label, 'createdAt', dv.created_at,
          'sourceRevision', dv.source_dataset_revision,
          'rowCount', (SELECT count(*) FROM api.dataset_version_rows vr WHERE vr.dataset_version_id = dv.id))
          ORDER BY dv.created_at DESC)
        FROM api.dataset_versions dv
        WHERE dv.dataset_id = d.id
          AND NOT EXISTS (SELECT 1 FROM api.dataset_version_prunes p WHERE p.dataset_version_id = dv.id)), '[]'::jsonb)
    ) ORDER BY d.display_id, d.name), '[]'::jsonb)
  INTO result
  FROM api.datasets d
  JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
  JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
  WHERE d.workspace_id = ws AND d.lifecycle = 'active'
    AND sv.schema_id IN (SELECT id FROM tbl)
    AND internal.can_access_object('dataset', d.id, 'view');
  RETURN result;
END $function$;
--> statement-breakpoint
ALTER FUNCTION api.measurement_table_sources(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.measurement_table_sources(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.measurement_table_sources(uuid, boolean) TO authenticated;
--> statement-breakpoint
-- The rows of a measurement table across datasets.
--
-- p_query (all keys optional):
--   mode             'live' (default) reads each dataset as it is now;
--                    'latest_snapshot' reads each dataset's newest snapshot and
--                    leaves out (and reports) datasets that have none.
--   datasets         [dataset id]: only these datasets.
--   pins             { dataset id: dataset version id }: read that snapshot of
--                    that dataset whatever the mode says.
--   includeSubtypes  true (default): datasets on a subtype of the table count.
--   recordId         only rows that link to this record in any link column.
--   filters          [{ field, operator, value }] (at most 8); field is a column
--                    key or field id; operator eq, gt, gte, lt or lte.
--   sort             { field, direction }; direction asc or desc.
-- Rows come back with the dataset and snapshot they were read from and their
-- values keyed by the column keys of the latest published version.
CREATE OR REPLACE FUNCTION api.query_measurement_table_rows(p_schema_definition_id uuid, p_query jsonb DEFAULT '{}'::jsonb, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  ws uuid := api.current_workspace_id();
  def api.dataset_schema_definitions;
  latest api.dataset_schema_versions;
  mode text;
  include_sub boolean;
  wanted jsonb;
  pins jsonb;
  pin_key text;
  sources jsonb;
  skipped jsonb;
  columns jsonb;
  filter_item jsonb;
  field api.dataset_schema_version_fields;
  filter_sql text := '';
  sort_sql text := '';
  sort_direction text := 'ASC';
  sort_item jsonb;
  value_column text;
  value_text text;
  operator text;
  record_id uuid;
  src_sql text;
  val_expr constant text := 'coalesce(to_jsonb(v.text_value),to_jsonb(v.integer_value),to_jsonb(v.numeric_value),to_jsonb(v.boolean_value),to_jsonb(v.date_value),to_jsonb(v.timestamp_value),to_jsonb(v.category_option_id),to_jsonb(v.reference_id))';
  total bigint;
  unavailable boolean;
  page jsonb;
BEGIN
  SELECT * INTO def FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id;
  IF def.id IS NULL OR def.workspace_id IS DISTINCT FROM ws OR NOT api.is_workspace_member(ws) THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object'
     OR p_query - ARRAY['mode','datasets','pins','includeSubtypes','recordId','filters','sort'] <> '{}'::jsonb
     OR (p_query ? 'filters' AND jsonb_typeof(p_query->'filters') IS DISTINCT FROM 'array')
     OR (p_query ? 'datasets' AND jsonb_typeof(p_query->'datasets') IS DISTINCT FROM 'array')
     OR (p_query ? 'pins' AND jsonb_typeof(p_query->'pins') IS DISTINCT FROM 'object')
     OR (p_query ? 'sort' AND jsonb_typeof(p_query->'sort') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'invalid measurement table query shape' USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'query limit must be 1 to 1000 and offset non-negative' USING ERRCODE = '22023';
  END IF;
  IF coalesce(jsonb_array_length(p_query->'filters'), 0) > 8 THEN
    RAISE EXCEPTION 'a measurement table query supports at most eight filters' USING ERRCODE = '22023';
  END IF;
  mode := coalesce(p_query->>'mode', 'live');
  IF mode NOT IN ('live', 'latest_snapshot') THEN
    RAISE EXCEPTION 'mode must be live or latest_snapshot' USING ERRCODE = '22023';
  END IF;
  BEGIN
    include_sub := coalesce((p_query->>'includeSubtypes')::boolean, true);
    record_id := (p_query->>'recordId')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid measurement table query value' USING ERRCODE = '22023';
  END;
  wanted := p_query->'datasets';
  pins := coalesce(p_query->'pins', '{}'::jsonb);

  SELECT * INTO latest FROM api.dataset_schema_versions
   WHERE schema_id = def.id AND lifecycle = 'active' ORDER BY version DESC LIMIT 1;
  IF latest.id IS NULL THEN
    RAISE EXCEPTION 'measurement table has no published version' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('fieldId', f.field_id, 'key', f.key, 'label', f.label,
           'logicalType', f.logical_type, 'cardinality', f.cardinality, 'quantity', f.quantity,
           'relationship', f.relationship) ORDER BY f.display_order, f.key), '[]'::jsonb)
    INTO columns
    FROM api.dataset_schema_version_fields f WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active';

  -- A dataset named but not visible reads exactly like one that is not on this
  -- table, so the call never says whether a hidden dataset exists.
  WITH RECURSIVE tbl AS (
    SELECT id FROM api.dataset_schema_definitions WHERE id = def.id
    UNION ALL
    SELECT c.id FROM api.dataset_schema_definitions c JOIN tbl ON c.parent_id = tbl.id WHERE include_sub
  ), cand AS (
    SELECT d.id, d.display_id, d.name, d.revision, sv.version AS schema_version
      FROM api.datasets d JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
     WHERE d.workspace_id = ws AND d.lifecycle = 'active'
       AND sv.schema_id IN (SELECT id FROM tbl)
       AND internal.can_access_object('dataset', d.id, 'view')
  )
  SELECT
    EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(wanted, '[]'::jsonb)) w WHERE w NOT IN (SELECT id::text FROM cand))
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(pins) k WHERE k NOT IN (SELECT id::text FROM cand))
  INTO STRICT unavailable;
  IF unavailable THEN
    RAISE EXCEPTION 'a dataset is not available for this measurement table' USING ERRCODE = '42501';
  END IF;

  FOR pin_key IN SELECT jsonb_object_keys(pins) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM api.dataset_versions dv
       WHERE dv.id::text = pins->>pin_key AND dv.dataset_id::text = pin_key
         AND NOT EXISTS (SELECT 1 FROM api.dataset_version_prunes p WHERE p.dataset_version_id = dv.id)) THEN
      RAISE EXCEPTION 'snapshot not found for that dataset' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  WITH RECURSIVE tbl AS (
    SELECT id FROM api.dataset_schema_definitions WHERE id = def.id
    UNION ALL
    SELECT c.id FROM api.dataset_schema_definitions c JOIN tbl ON c.parent_id = tbl.id WHERE include_sub
  ), cand AS (
    SELECT d.id, d.display_id, d.name, d.revision, d.schema_version_id
      FROM api.datasets d JOIN api.dataset_schema_versions sv ON sv.id = d.schema_version_id
     WHERE d.workspace_id = ws AND d.lifecycle = 'active'
       AND sv.schema_id IN (SELECT id FROM tbl)
       AND internal.can_access_object('dataset', d.id, 'view')
       AND (wanted IS NULL OR d.id::text IN (SELECT jsonb_array_elements_text(wanted)))
  ), chosen AS (
    SELECT c.*,
           CASE WHEN pins ? c.id::text THEN (pins->>c.id::text)::uuid
                WHEN mode = 'latest_snapshot' THEN (
                  SELECT dv.id FROM api.dataset_versions dv
                   WHERE dv.dataset_id = c.id
                     AND NOT EXISTS (SELECT 1 FROM api.dataset_version_prunes p WHERE p.dataset_version_id = dv.id)
                   ORDER BY dv.created_at DESC LIMIT 1) END AS version_id
      FROM cand c
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'datasetId', ch.id, 'displayId', ch.display_id, 'name', ch.name,
      'datasetVersionId', ch.version_id, 'snapshotLabel', dv.label, 'live', ch.version_id IS NULL,
      'schemaVersion', sv.version, 'revision', coalesce(dv.source_dataset_revision, ch.revision))
      ORDER BY ch.display_id, ch.name) FILTER (WHERE mode = 'live' OR ch.version_id IS NOT NULL), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('datasetId', ch.id, 'displayId', ch.display_id, 'name', ch.name, 'reason', 'no_snapshot')
      ORDER BY ch.display_id, ch.name) FILTER (WHERE mode = 'latest_snapshot' AND ch.version_id IS NULL), '[]'::jsonb)
  INTO sources, skipped
  FROM chosen ch
  LEFT JOIN api.dataset_versions dv ON dv.id = ch.version_id
  JOIN api.dataset_schema_versions sv ON sv.id = coalesce(dv.schema_version_id, ch.schema_version_id);

  -- One row per (dataset or snapshot, row): live rows from the dataset, snapshot
  -- rows from the frozen copy. Planned rows hold no values yet and are left out.
  src_sql := format($q$(
    SELECT s.dataset_id, s.version_id, s.display_id, s.name AS dname, s.snapshot_label, s.revision AS dataset_revision, s.schema_version,
           r.id AS row_id, r.revision
      FROM jsonb_to_recordset(%1$L::jsonb) AS s(dataset_id uuid, version_id uuid, display_id text, name text, snapshot_label text, revision bigint, schema_version integer)
      JOIN api.dataset_rows r ON r.dataset_id = s.dataset_id AND r.status = 'recorded'
     WHERE s.version_id IS NULL
    UNION ALL
    SELECT s.dataset_id, s.version_id, s.display_id, s.name, s.snapshot_label, s.revision, s.schema_version,
           vr.row_id, vr.revision
      FROM jsonb_to_recordset(%1$L::jsonb) AS s(dataset_id uuid, version_id uuid, display_id text, name text, snapshot_label text, revision bigint, schema_version integer)
      JOIN api.dataset_version_rows vr ON vr.dataset_version_id = s.version_id
     WHERE s.version_id IS NOT NULL
  )$q$, (SELECT coalesce(jsonb_agg(jsonb_build_object(
           'dataset_id', e->>'datasetId', 'version_id', e->>'datasetVersionId', 'display_id', e->>'displayId',
           'name', e->>'name', 'snapshot_label', e->>'snapshotLabel', 'revision', e->>'revision',
           'schema_version', e->>'schemaVersion')), '[]'::jsonb) FROM jsonb_array_elements(sources) e));

  IF record_id IS NOT NULL THEN
    filter_sql := filter_sql || format($q$ AND EXISTS (
      SELECT 1 FROM api.dataset_schema_version_fields lf
       WHERE lf.schema_version_id = %1$L::uuid AND lf.logical_type = 'reference' AND lf.lifecycle = 'active'
         AND ((s.version_id IS NULL AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = lf.field_id AND v.reference_id = %2$L::uuid))
           OR (s.version_id IS NOT NULL AND EXISTS (SELECT 1 FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = lf.field_id AND v.reference_id = %2$L::uuid))))$q$,
      latest.id, record_id);
  END IF;

  FOR filter_item IN SELECT value FROM jsonb_array_elements(coalesce(p_query->'filters', '[]'::jsonb)) LOOP
    IF jsonb_typeof(filter_item) <> 'object' OR filter_item - ARRAY['field','operator','value'] <> '{}'::jsonb
       OR jsonb_typeof(filter_item->'field') IS DISTINCT FROM 'string'
       OR jsonb_typeof(filter_item->'operator') IS DISTINCT FROM 'string' OR NOT filter_item ? 'value' THEN
      RAISE EXCEPTION 'invalid measurement table filter shape' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO field FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active'
       AND (f.key = filter_item->>'field' OR f.field_id::text = filter_item->>'field') LIMIT 1;
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown column in measurement table filter' USING ERRCODE = '22023'; END IF;
    operator := filter_item->>'operator';
    IF operator NOT IN ('eq','gt','gte','lt','lte') OR (operator <> 'eq' AND field.logical_type NOT IN ('integer','decimal','date','timestamp')) THEN
      RAISE EXCEPTION 'unsupported measurement table filter operator' USING ERRCODE = '22023';
    END IF;
    value_text := filter_item->'value' #>> '{}';
    BEGIN
      IF field.logical_type = 'integer' THEN PERFORM value_text::bigint;
      ELSIF field.logical_type = 'decimal' THEN PERFORM value_text::numeric;
      ELSIF field.logical_type = 'boolean' THEN PERFORM value_text::boolean;
      ELSIF field.logical_type = 'date' THEN PERFORM value_text::date;
      ELSIF field.logical_type = 'timestamp' THEN PERFORM value_text::timestamptz;
      ELSIF field.logical_type IN ('category','reference') THEN PERFORM value_text::uuid;
      END IF;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'measurement table filter value does not match the column type' USING ERRCODE = '22023';
    END;
    value_column := CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value'
      WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value'
      WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END;
    filter_sql := filter_sql || format($q$ AND ((s.version_id IS NULL AND EXISTS (SELECT 1 FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = %1$L::uuid AND v.%2$I %3$s %4$L::%5$s))
        OR (s.version_id IS NOT NULL AND EXISTS (SELECT 1 FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = %1$L::uuid AND v.%2$I %3$s %4$L::%5$s)))$q$,
      field.field_id, value_column,
      CASE operator WHEN 'eq' THEN '=' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' ELSE '<=' END,
      value_text,
      CASE field.logical_type WHEN 'integer' THEN 'bigint' WHEN 'decimal' THEN 'numeric' WHEN 'boolean' THEN 'boolean' WHEN 'date' THEN 'date'
        WHEN 'timestamp' THEN 'timestamptz' WHEN 'category' THEN 'uuid' WHEN 'reference' THEN 'uuid' ELSE 'text' END);
  END LOOP;

  IF p_query ? 'sort' THEN
    sort_item := p_query->'sort';
    IF sort_item - ARRAY['field','direction'] <> '{}'::jsonb
       OR jsonb_typeof(sort_item->'field') IS DISTINCT FROM 'string'
       OR sort_item->>'direction' NOT IN ('asc','desc') THEN
      RAISE EXCEPTION 'invalid measurement table sort shape' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO field FROM api.dataset_schema_version_fields f
     WHERE f.schema_version_id = latest.id AND f.lifecycle = 'active'
       AND (f.key = sort_item->>'field' OR f.field_id::text = sort_item->>'field') LIMIT 1;
    IF field.id IS NULL THEN RAISE EXCEPTION 'unknown column in measurement table sort' USING ERRCODE = '22023'; END IF;
    value_column := CASE field.logical_type WHEN 'text' THEN 'text_value' WHEN 'integer' THEN 'integer_value' WHEN 'decimal' THEN 'numeric_value'
      WHEN 'boolean' THEN 'boolean_value' WHEN 'date' THEN 'date_value' WHEN 'timestamp' THEN 'timestamp_value'
      WHEN 'category' THEN 'category_option_id' ELSE 'reference_id' END;
    sort_sql := format($q$CASE WHEN s.version_id IS NULL
        THEN (SELECT v.%1$I FROM api.dataset_row_values v WHERE v.row_id = s.row_id AND v.field_id = %2$L::uuid ORDER BY v.ordinal LIMIT 1)
        ELSE (SELECT v.%1$I FROM api.dataset_version_values v WHERE v.dataset_version_id = s.version_id AND v.row_id = s.row_id AND v.field_id = %2$L::uuid ORDER BY v.ordinal LIMIT 1) END %3$s NULLS LAST, $q$,
      value_column, field.field_id, upper(sort_item->>'direction'));
  END IF;

  EXECUTE format('SELECT count(*) FROM %s s WHERE true %s', src_sql, filter_sql) INTO total;

  EXECUTE format($q$SELECT coalesce(jsonb_agg(jsonb_build_object(
      'rowId', p.row_id, 'datasetId', p.dataset_id, 'datasetDisplayId', p.display_id, 'datasetName', p.dname,
      'datasetVersionId', p.version_id, 'snapshotLabel', p.snapshot_label, 'live', p.version_id IS NULL,
      'datasetRevision', p.dataset_revision, 'schemaVersion', p.schema_version, 'revision', p.revision,
      'values', (SELECT coalesce(jsonb_object_agg(f.key,
          CASE WHEN f.cardinality = 'many' THEN coalesce(CASE WHEN p.version_id IS NULL
                 THEN (SELECT jsonb_agg(%1$s ORDER BY v.ordinal) FROM api.dataset_row_values v WHERE v.row_id = p.row_id AND v.field_id = f.field_id)
                 ELSE (SELECT jsonb_agg(%1$s ORDER BY v.ordinal) FROM api.dataset_version_values v WHERE v.dataset_version_id = p.version_id AND v.row_id = p.row_id AND v.field_id = f.field_id) END, '[]'::jsonb)
          ELSE CASE WHEN p.version_id IS NULL
                 THEN (SELECT %1$s FROM api.dataset_row_values v WHERE v.row_id = p.row_id AND v.field_id = f.field_id ORDER BY v.ordinal LIMIT 1)
                 ELSE (SELECT %1$s FROM api.dataset_version_values v WHERE v.dataset_version_id = p.version_id AND v.row_id = p.row_id AND v.field_id = f.field_id ORDER BY v.ordinal LIMIT 1) END
          END), '{}'::jsonb)
        FROM api.dataset_schema_version_fields f WHERE f.schema_version_id = %2$L::uuid AND f.lifecycle = 'active'))
      ORDER BY p.rn), '[]'::jsonb)
    FROM (SELECT s.*, row_number() OVER (ORDER BY %3$s s.display_id, s.dname, s.version_id NULLS FIRST, s.row_id) AS rn
            FROM %4$s s WHERE true %5$s ORDER BY rn LIMIT %6$s OFFSET %7$s) p$q$,
    val_expr, latest.id, sort_sql, src_sql, filter_sql, p_limit, p_offset) INTO page;

  RETURN jsonb_build_object(
    'tableId', def.id, 'tableKey', def.key, 'tableName', def.name,
    'schemaVersionId', latest.id, 'schemaVersion', latest.version,
    'mode', mode, 'columns', columns, 'sources', sources, 'skipped', skipped,
    'offset', p_offset, 'limit', p_limit, 'totalCount', total, 'hasMore', p_offset + p_limit < total,
    'rows', page);
END $function$;
--> statement-breakpoint
ALTER FUNCTION api.query_measurement_table_rows(uuid, jsonb, integer, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.query_measurement_table_rows(uuid, jsonb, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.query_measurement_table_rows(uuid, jsonb, integer, integer) TO authenticated;
--> statement-breakpoint
-- A pipeline step may read results across datasets.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('query_measurement_table_rows', '{"operation":"query_measurement_table_rows","rpc":"query_measurement_table_rows","label":"Read one kind of result across datasets","description":"One read for the rows of a measurement table across all the datasets you can open, live or pinned to snapshots, with the dataset and snapshot each row came from. Values are keyed by the column keys of the table’s latest published version; datasets still on an older version line up by field, and a column a dataset did not have reads as missing. `p_query` may hold `mode` (`live`, the default, or `latest_snapshot`, which leaves out and reports datasets with no snapshot), `datasets` (only these dataset ids), `pins` (`{ dataset id: dataset version id }`, read that snapshot whatever the mode), `includeSubtypes` (default true), `recordId` (only rows that link to this record in any link column), `filters` (up to eight `{ field, operator, value }`, `field` a column key or field id, `operator` `eq`, `gt`, `gte`, `lt` or `lte`) and `sort` (`{ field, direction }`). `p_limit` is 1 to 1000 (default 200). Returns `{ tableId, tableKey, columns, sources, skipped, totalCount, hasMore, rows }`; each row has `rowId`, `datasetId`, `datasetDisplayId`, `datasetName`, `datasetVersionId`, `snapshotLabel`, `live`, `datasetRevision` and `values`.","arguments":[{"name":"p_schema_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_query","type":"jsonb","required":false,"nullable":false},{"name":"p_limit","type":"integer","required":false,"nullable":false},{"name":"p_offset","type":"integer","required":false,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
