-- LAB-03 (remaining) — authoritative measurement provenance for a sample.
--
-- The standalone `api.sample_measurements` table (0267) remains the
-- bench-reading surface owned by MOB-02. The sample's Measurements tab must
-- instead show the values that were recorded authoritatively in Datasets or in
-- integration/QC, each with a link back to the row that produced it. This read
-- model aggregates those values; it creates no second measurement store and
-- never reads the standalone table.
--
-- A Dataset row links to a sample through either canonical mechanism the
-- product already resolves (`useRowSourceSample` in the Dataset rows surface,
-- src/routes/datasets/$datasetId/rows.tsx):
--   * a `reference` field whose Model target is `sample`, whose reference_id is
--     the sample record id; or
--   * a text field named/labelled "sample" whose value equals the sample's
--     stable identifier.
-- Integration/QC values are instrument QC checks on a run linked to the sample
-- through `api.instrument_run_links` (link_type='sample').
--
-- RLS/membership is unchanged: the sample and every sub-read are resolved
-- inside the caller's current workspace, so another workspace's Dataset rows,
-- values or QC checks can never appear.
--
-- Read-only: `STABLE`, no writes, no new tables and no new grants on any
-- existing resource.

CREATE OR REPLACE FUNCTION api.sample_measurement_provenance(
  p_sample_record_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sample api.records;
  v_workspace uuid;
  v_result jsonb;
BEGIN
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
    UNION
    -- Sample-keyed value: a text field named/labelled "sample" holding the
    -- sample's stable identifier.
    SELECT DISTINCT r.id
      FROM api.dataset_rows r
      JOIN api.datasets d
        ON d.id = r.dataset_id
       AND d.workspace_id = v_sample.workspace_id
       AND d.lifecycle = 'active'
      JOIN api.dataset_schema_version_fields lf
        ON lf.schema_version_id = d.schema_version_id
       AND lf.lifecycle = 'active'
       AND lf.logical_type = 'text'
       AND (lf.key ~* 'sample' OR lf.label ~* 'sample')
      JOIN api.dataset_row_values lv
        ON lv.row_id = r.id
       AND lv.field_id = lf.field_id
       AND btrim(lv.text_value) = btrim(v_sample.identifier)
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
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.sample_measurement_provenance(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.sample_measurement_provenance(uuid) TO authenticated;
--> statement-breakpoint
COMMENT ON FUNCTION api.sample_measurement_provenance(uuid) IS
  'LAB-03: read-only aggregation of a sample''s authoritative measurements from linked Dataset rows and instrument QC/integration, each with row provenance. The standalone sample_measurements table is not read.';
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
