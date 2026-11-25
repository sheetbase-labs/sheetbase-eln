-- A sample's measured values come from the real link column only: the old
-- guess at a text column named "sample" holding the sample's identifier is
-- gone now that a dataset column can link to a record.
DO $migration$
DECLARE
  d text := pg_get_functiondef('api.sample_measurement_provenance(uuid)'::regprocedure);
  d2 text;
BEGIN
  d2 := replace(d,
    $old$    UNION
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
$old$, '');
  IF d2 = d THEN RAISE EXCEPTION 'could not drop the text-keyed sample link'; END IF;
  EXECUTE d2;
END $migration$;
