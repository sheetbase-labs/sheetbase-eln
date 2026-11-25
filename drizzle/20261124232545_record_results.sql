-- Every result on a record: each dataset row whose link column holds the record,
-- grouped by the measurement table it follows. Live rows by default; with
-- p_include_snapshots the rows kept in snapshots too, each marked with its
-- snapshot. Reads the link values through an index on the linked record, so a
-- record page costs the rows that link to it, not the size of every dataset.
CREATE INDEX IF NOT EXISTS idx_dataset_row_values_linked_record
  ON api.dataset_row_values (reference_id, row_id) WHERE reference_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_dataset_version_values_linked_record
  ON api.dataset_version_values (reference_id, dataset_version_id, row_id) WHERE reference_id IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_results(
  p_record_id uuid,
  p_include_snapshots boolean DEFAULT false,
  p_limit integer DEFAULT 500,
  p_offset integer DEFAULT 0
) RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_workspace uuid;
  v_total bigint;
  v_rows jsonb;
BEGIN
  PERFORM internal.assert_object_access('record', p_record_id, 'view');
  v_workspace := api.current_workspace_id();
  IF v_workspace IS NULL OR NOT EXISTS (
    SELECT 1 FROM api.records WHERE id = p_record_id AND workspace_id = v_workspace AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 1000 OR p_offset IS NULL OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid results window' USING ERRCODE = '22023';
  END IF;

  -- Which datasets hold a row linking here, and the person may see.
  WITH hits AS MATERIALIZED (
    SELECT row_number() OVER (ORDER BY h.recorded_at DESC NULLS LAST, h.row_id, h.version_id)::integer AS hit,
           h.dataset_id, h.row_id, h.version_id, h.version_label, h.schema_version_id, h.recorded_at, h.status
      FROM (
        SELECT DISTINCT r.dataset_id, r.id AS row_id, NULL::uuid AS version_id, NULL::text AS version_label,
               d.schema_version_id, r.updated_at AS recorded_at, r.status
          FROM api.dataset_row_values lv
          JOIN api.dataset_rows r ON r.id = lv.row_id
          JOIN api.datasets d ON d.id = r.dataset_id AND d.workspace_id = v_workspace AND d.lifecycle = 'active'
         WHERE lv.reference_id = p_record_id
        UNION ALL
        SELECT DISTINCT v.dataset_id, vv.row_id, v.id, v.label,
               v.schema_version_id, v.created_at, 'recorded'::text
          FROM api.dataset_version_values vv
          JOIN api.dataset_versions v ON v.id = vv.dataset_version_id AND v.workspace_id = v_workspace
          JOIN api.datasets d ON d.id = v.dataset_id AND d.lifecycle = 'active'
         WHERE p_include_snapshots AND vv.reference_id = p_record_id
      ) h
     WHERE internal.can_access_object('dataset', h.dataset_id, 'view')
  )
  SELECT (SELECT count(*) FROM hits), coalesce(jsonb_agg(item ORDER BY hit), '[]'::jsonb) INTO v_total, v_rows
    FROM (
      SELECT h.hit,
        jsonb_build_object(
          'rowId', h.row_id,
          'datasetId', d.id,
          'datasetDisplayId', d.display_id,
          'datasetName', d.name,
          'tableId', sd.id,
          'tableKey', sd.key,
          'tableName', sd.name,
          'tableVersion', sv.version,
          'source', CASE WHEN h.version_id IS NULL THEN 'live' ELSE 'snapshot' END,
          'snapshotId', h.version_id,
          'snapshotLabel', h.version_label,
          'status', h.status,
          'recordedAt', h.recorded_at,
          'values', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                     'fieldId', f.field_id,
                     'key', f.key,
                     'label', f.label,
                     'type', f.logical_type,
                     'unit', coalesce(f.quantity->>'symbol', f.quantity->>'storageUnit'),
                     'linksHere', f.logical_type = 'reference' AND x.vals @> to_jsonb(p_record_id::text),
                     'value', CASE WHEN f.cardinality = 'many' THEN x.vals ELSE x.vals->0 END
                   ) ORDER BY f.display_order)
              FROM api.dataset_schema_version_fields f
              JOIN LATERAL (
                SELECT jsonb_agg(
                         CASE f.logical_type
                           WHEN 'text' THEN to_jsonb(c.text_value)
                           WHEN 'integer' THEN to_jsonb(c.integer_value)
                           WHEN 'decimal' THEN to_jsonb(c.numeric_value)
                           WHEN 'boolean' THEN to_jsonb(c.boolean_value)
                           WHEN 'date' THEN to_jsonb(c.date_value)
                           WHEN 'timestamp' THEN to_jsonb(c.timestamp_value)
                           WHEN 'category' THEN to_jsonb(coalesce(
                             (SELECT o->>'label' FROM jsonb_array_elements(coalesce(f.category->'options', '[]'::jsonb)) o
                               WHERE o->>'id' = c.category_option_id::text LIMIT 1),
                             c.category_option_id::text))
                           WHEN 'reference' THEN to_jsonb(c.reference_id::text)
                           ELSE to_jsonb(coalesce(c.numeric_value::text, c.integer_value::text, c.text_value))
                         END
                         ORDER BY c.ordinal) AS vals
                  FROM (
                    SELECT t.ordinal, t.text_value, t.integer_value, t.numeric_value, t.boolean_value, t.date_value,
                           t.timestamp_value, t.category_option_id, t.reference_id
                      FROM api.dataset_row_values t
                     WHERE h.version_id IS NULL AND t.row_id = h.row_id AND t.field_id = f.field_id
                    UNION ALL
                    SELECT t.ordinal, t.text_value, t.integer_value, t.numeric_value, t.boolean_value, t.date_value,
                           t.timestamp_value, t.category_option_id, t.reference_id
                      FROM api.dataset_version_values t
                     WHERE h.version_id IS NOT NULL AND t.dataset_version_id = h.version_id
                       AND t.row_id = h.row_id AND t.field_id = f.field_id
                  ) c
              ) x ON x.vals IS NOT NULL
             WHERE f.schema_version_id = h.schema_version_id
          ), '[]'::jsonb)
        ) AS item
        FROM hits h
        JOIN api.datasets d ON d.id = h.dataset_id
        JOIN api.dataset_schema_versions sv ON sv.id = h.schema_version_id
        JOIN api.dataset_schema_definitions sd ON sd.id = sv.schema_id
       ORDER BY h.hit
       LIMIT p_limit OFFSET p_offset
    ) page;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END
$function$;
--> statement-breakpoint
COMMENT ON FUNCTION api.record_results(uuid, boolean, integer, integer) IS 'Every result on a record: the dataset rows whose link column holds it, with the measurement table, dataset, live or snapshot and every value. Read-only.';
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_results(uuid, boolean, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_results(uuid, boolean, integer, integer) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_results(uuid, boolean, integer, integer) TO api_client;

--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('record_results', '{"operation":"record_results","rpc":"record_results","label":"Read every result on a record","description":"Returns `{ total, rows }`: each dataset row whose link column holds the record, newest first, with its measurement table (`tableId`, `tableKey`, `tableName`), its dataset, `source` (`live`, or `snapshot` with `snapshotId` and `snapshotLabel`) and every value as `{ key, label, type, unit, value, linksHere }`. A link column’s value is the linked record’s id. Only datasets you may see are included. Changes nothing.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_include_snapshots","type":"boolean","required":false,"nullable":false},{"name":"p_limit","type":"integer","required":false,"nullable":false},{"name":"p_offset","type":"integer","required":false,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
