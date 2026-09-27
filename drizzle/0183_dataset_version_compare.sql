-- DSET-03.2 — snapshot comparison.
--
-- `compare_dataset_versions(a, b)` computes, on the server from the immutable
-- version rows, which rows were added, changed (per field) or removed between
-- two snapshots of the same dataset, plus the columns added or removed by a
-- schema change. Paginated over the changed rows.

CREATE OR REPLACE FUNCTION internal.dataset_version_row_values(p_version_id uuid)
RETURNS TABLE(row_id uuid, row_values jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT r.row_id,
    coalesce((
      SELECT jsonb_object_agg(f.field_id, f.row_values)
      FROM (
        SELECT field_id,
          CASE WHEN count(*) = 1 THEN
            (jsonb_agg(coalesce(to_jsonb(text_value), to_jsonb(integer_value),
                                to_jsonb(numeric_value), to_jsonb(boolean_value),
                                to_jsonb(date_value), to_jsonb(timestamp_value),
                                to_jsonb(category_option_id), to_jsonb(reference_id))
                       ORDER BY ordinal)) -> 0
          ELSE
            jsonb_agg(coalesce(to_jsonb(text_value), to_jsonb(integer_value),
                               to_jsonb(numeric_value), to_jsonb(boolean_value),
                               to_jsonb(date_value), to_jsonb(timestamp_value),
                               to_jsonb(category_option_id), to_jsonb(reference_id))
                      ORDER BY ordinal)
          END AS row_values
        FROM api.dataset_version_values v
        WHERE v.dataset_version_id = p_version_id AND v.row_id = r.row_id
        GROUP BY field_id
      ) f
    ), '{}'::jsonb)
  FROM api.dataset_version_rows r
  WHERE r.dataset_version_id = p_version_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.dataset_version_row_values(uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.compare_dataset_versions(
  p_version_a uuid,
  p_version_b uuid,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  va api.dataset_versions;
  vb api.dataset_versions;
BEGIN
  SELECT * INTO va FROM api.dataset_versions
    WHERE id = p_version_a AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  SELECT * INTO vb FROM api.dataset_versions
    WHERE id = p_version_b AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  IF va.id IS NULL OR vb.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE = '42501';
  END IF;
  IF va.dataset_id <> vb.dataset_id THEN
    RAISE EXCEPTION 'versions belong to different datasets' USING ERRCODE = '22023';
  END IF;
  IF p_limit NOT BETWEEN 1 AND 1000 OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid Dataset Version window' USING ERRCODE = '22023';
  END IF;

  RETURN (
    WITH a AS (SELECT * FROM internal.dataset_version_row_values(p_version_a)),
         b AS (SELECT * FROM internal.dataset_version_row_values(p_version_b)),
         joined AS (
           SELECT coalesce(a.row_id, b.row_id) AS row_id, a.row_values AS av, b.row_values AS bv
           FROM a FULL JOIN b USING (row_id)
         ),
         classified AS (
           SELECT row_id, av, bv,
             CASE WHEN av IS NULL THEN 'added'
                  WHEN bv IS NULL THEN 'removed'
                  ELSE 'changed' END AS kind
           FROM joined
           WHERE av IS NULL OR bv IS NULL OR av <> bv
         )
    SELECT jsonb_build_object(
      'versionA', p_version_a,
      'versionB', p_version_b,
      'offset', p_offset,
      'limit', p_limit,
      'counts', (
        SELECT jsonb_build_object(
          'added', count(*) FILTER (WHERE kind = 'added'),
          'removed', count(*) FILTER (WHERE kind = 'removed'),
          'changed', count(*) FILTER (WHERE kind = 'changed')
        ) FROM classified
      ),
      'columns', coalesce((
        SELECT jsonb_agg(jsonb_build_object('fieldId', field_id, 'kind', kind))
        FROM (
          SELECT f.field_id, 'added' AS kind
          FROM api.dataset_schema_version_fields f
          WHERE f.schema_version_id = vb.schema_version_id
            AND f.field_id NOT IN (
              SELECT field_id FROM api.dataset_schema_version_fields
              WHERE schema_version_id = va.schema_version_id
            )
          UNION ALL
          SELECT f.field_id, 'removed' AS kind
          FROM api.dataset_schema_version_fields f
          WHERE f.schema_version_id = va.schema_version_id
            AND f.field_id NOT IN (
              SELECT field_id FROM api.dataset_schema_version_fields
              WHERE schema_version_id = vb.schema_version_id
            )
        ) c
      ), '[]'::jsonb),
      'rows', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'rowId', row_id,
          'kind', kind,
          'fields', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'fieldId', key,
              'from', av -> key,
              'to', bv -> key
            ))
            FROM jsonb_object_keys(coalesce(av, '{}'::jsonb) || coalesce(bv, '{}'::jsonb)) AS key
            WHERE (av -> key) IS DISTINCT FROM (bv -> key)
          ), '[]'::jsonb)
        ) ORDER BY kind, row_id)
        FROM (
          SELECT * FROM classified ORDER BY kind, row_id
          LIMIT p_limit OFFSET p_offset
        ) page
      ), '[]'::jsonb)
    )
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.compare_dataset_versions(uuid, uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.compare_dataset_versions(uuid, uuid, integer, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
