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
-- A sample's measured values come from the real link column only; the old
-- guess at a text column named "sample" is gone.
CREATE OR REPLACE FUNCTION api.sample_measurement_provenance(p_sample_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_sample api.records;
  v_workspace uuid;
  v_result jsonb;
BEGIN
 IF p_sample_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_sample_record_id,'view'); END IF;
  v_workspace := api.current_workspace_id();
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sample FROM api.records
    WHERE id = p_sample_record_id
      AND workspace_id = v_workspace
      AND api.is_workspace_member(workspace_id)
      AND kind = 'sample'
      AND deleted_at IS NULL;
  IF v_sample.id IS NULL THEN
    RAISE EXCEPTION 'sample denied' USING ERRCODE = '42501';
  END IF;

  WITH linked_rows AS (
    -- Direct reference: a reference-typed field whose Model target is sample
    -- and whose value is this sample record id.
    SELECT DISTINCT r.id AS row_id
      FROM api.dataset_rows r
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
       AND d.lifecycle = 'active'
      JOIN api.dataset_schema_version_fields lf
        ON lf.schema_version_id = d.schema_version_id
       AND lf.lifecycle = 'active'
       AND lf.logical_type = 'reference'
       AND coalesce(
             lf.relationship->'target'->>'modelKey',
             lf.validation->>'targetModelKey'
           ) = 'sample'
      JOIN api.dataset_row_values lv
        ON lv.row_id = r.id
       AND lv.field_id = lf.field_id
       AND lv.reference_id = v_sample.id
  ),
  dataset_measures AS (
    SELECT
      'dataset:' || m.row_id::text || ':' || m.field_id::text || ':' ||
        m.ordinal::text AS id,
      m.label AS measurement,
      m.value_num AS value,
      m.value_num::text AS value_text,
      coalesce(m.quantity->>'symbol', m.quantity->>'storageUnit') AS unit,
      (SELECT mv.text_value
         FROM api.dataset_schema_version_fields mf
         JOIN api.dataset_row_values mv
           ON mv.row_id = m.row_id AND mv.field_id = mf.field_id
        WHERE mf.schema_version_id = m.schema_version_id
          AND mf.lifecycle = 'active'
          AND mf.logical_type = 'text'
          AND (mf.key ~* 'method' OR mf.label ~* 'method')
        ORDER BY mf.display_order
        LIMIT 1) AS method,
      coalesce(m.display_id, m.dataset_name) AS source,
      NULL::text AS result,
      coalesce(
        (SELECT tv.timestamp_value
           FROM api.dataset_schema_version_fields tf
           JOIN api.dataset_row_values tv
             ON tv.row_id = m.row_id AND tv.field_id = tf.field_id
          WHERE tf.schema_version_id = m.schema_version_id
            AND tf.lifecycle = 'active'
            AND tf.logical_type = 'timestamp'
            AND (
              tf.key ~* 'measur|time|date' OR tf.label ~* 'measur|time|date'
            )
          ORDER BY tf.display_order
          LIMIT 1),
        m.row_updated_at
      ) AS measured_at,
      jsonb_build_object(
        'kind', 'dataset',
        'datasetId', m.dataset_id,
        'datasetDisplayId', m.display_id,
        'datasetName', m.dataset_name,
        'rowId', m.row_id,
        'fieldId', m.field_id,
        'fieldKey', m.field_key,
        'sourceId', NULL,
        'runId', NULL,
        'runIdentifier', NULL,
        'instrumentId', NULL,
        'instrumentName', NULL
      ) AS provenance
    FROM (
      SELECT
        lr.row_id,
        r.updated_at AS row_updated_at,
        d.id AS dataset_id,
        d.display_id,
        d.name AS dataset_name,
        d.schema_version_id,
        f.field_id,
        f.key AS field_key,
        f.label,
        f.quantity,
        v.ordinal,
        coalesce(v.numeric_value, v.integer_value) AS value_num
      FROM linked_rows lr
      JOIN api.dataset_rows r ON r.id = lr.row_id
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
      JOIN api.dataset_schema_version_fields f
        ON f.schema_version_id = d.schema_version_id
       AND f.lifecycle = 'active'
       AND f.logical_type IN ('integer', 'decimal')
      JOIN api.dataset_row_values v
        ON v.row_id = r.id
       AND v.field_id = f.field_id
       AND (v.numeric_value IS NOT NULL OR v.integer_value IS NOT NULL)
    ) m
  ),
  integration_measures AS (
    SELECT
      'integration:' || qc.id::text AS id,
      qc.check_name AS measurement,
      CASE
        WHEN jsonb_typeof(qc.detail->'value') = 'number'
          THEN (qc.detail->>'value')::numeric
        WHEN qc.detail->>'value'
          ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'
          THEN (qc.detail->>'value')::numeric
        ELSE NULL
      END AS value,
      qc.detail->>'value' AS value_text,
      qc.detail->>'unit' AS unit,
      coalesce(ins.name, qc.detail->>'method') AS method,
      'QC · ' || ir.run_identifier AS source,
      qc.check_type AS result,
      qc.checked_at AS measured_at,
      jsonb_build_object(
        'kind', 'integration',
        'datasetId', NULL,
        'datasetDisplayId', NULL,
        'datasetName', NULL,
        'rowId', NULL,
        'fieldId', NULL,
        'fieldKey', NULL,
        'sourceId', qc.id,
        'runId', ir.id,
        'runIdentifier', ir.run_identifier,
        'instrumentId', ir.instrument_id,
        'instrumentName', ins.name
      ) AS provenance
    FROM api.instrument_run_links irl
    JOIN api.instrument_runs ir
      ON ir.id = irl.run_id
     AND ir.workspace_id = v_sample.workspace_id
    JOIN api.instrument_qc_checks qc
      ON qc.run_id = irl.run_id
     AND qc.workspace_id = v_sample.workspace_id
    LEFT JOIN api.instruments ins
      ON ins.id = ir.instrument_id
     AND ins.workspace_id = v_sample.workspace_id
    WHERE irl.linked_record_id = v_sample.id
      AND irl.link_type = 'sample'
      AND irl.workspace_id = v_sample.workspace_id
  ),
  all_measures AS (
    SELECT * FROM dataset_measures
    UNION ALL
    SELECT * FROM integration_measures
  )
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', am.id,
               'measurement', am.measurement,
               'value', am.value,
               'valueText', am.value_text,
               'unit', am.unit,
               'method', am.method,
               'source', am.source,
               'result', am.result,
               'measuredAt', am.measured_at,
               'provenance', am.provenance
             )
             ORDER BY am.measured_at DESC NULLS LAST, am.id
           ),
           '[]'::jsonb
         )
    INTO v_result
    FROM all_measures am;

  RETURN v_result;
END;
$_$;

--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('record_results', '{"operation":"record_results","rpc":"record_results","label":"Read every result on a record","description":"Returns `{ total, rows }`: each dataset row whose link column holds the record, newest first, with its measurement table (`tableId`, `tableKey`, `tableName`), its dataset, `source` (`live`, or `snapshot` with `snapshotId` and `snapshotLabel`) and every value as `{ key, label, type, unit, value, linksHere }`. A link column’s value is the linked record’s id. Only datasets you may see are included. Changes nothing.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_include_snapshots","type":"boolean","required":false,"nullable":false},{"name":"p_limit","type":"integer","required":false,"nullable":false},{"name":"p_offset","type":"integer","required":false,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
