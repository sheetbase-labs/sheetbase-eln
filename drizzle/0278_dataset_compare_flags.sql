-- DSET-03 step 2 — canonical flag-only changes in the snapshot comparison.
--
-- `compare_dataset_versions` previously read only version values, so a change
-- that altered only value flags — a flag added, cleared, or a change to its
-- reason, kind or source — was invisible. `internal.dataset_version_row_flags`
-- freezes each row's flags into a keyed jsonb map and
-- `internal.dataset_version_flag_delta` reports per-flag added/removed/changed
-- entries. The comparison then classifies a row as changed when either its
-- values or its flags differ, carries the flag delta on the row, and counts
-- flag changes separately.
--
-- RLS and membership checks are unchanged. The helpers are internal-only and
-- read the frozen snapshot table, never live flags.

CREATE OR REPLACE FUNCTION internal.dataset_version_row_flags(p_version_id uuid)
RETURNS TABLE(row_id uuid, row_flags jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT f.row_id,
    jsonb_object_agg(
      f.field_id::text || '|' || f.kind || '|' || f.source,
      jsonb_build_object(
        'fieldId', f.field_id,
        'kind', f.kind,
        'source', f.source,
        'reason', f.reason,
        'comment', f.comment
      )
    )
  FROM api.dataset_version_flags f
  WHERE f.dataset_version_id = p_version_id
  GROUP BY f.row_id
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.dataset_version_row_flags(uuid) FROM PUBLIC;
--> statement-breakpoint

-- A flag is identified by (field, kind, source); a kind or source change is
-- therefore reported as the old flag removed and the new flag added, while a
-- reason/comment change is reported as a single 'changed' entry.
CREATE OR REPLACE FUNCTION internal.dataset_version_flag_delta(
  p_from jsonb,
  p_to jsonb
)
RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  SELECT coalesce(
      jsonb_agg(entry ORDER BY entry->>'fieldId', entry->>'kind', entry->>'source'),
      '[]'::jsonb
    )
  FROM (
    SELECT jsonb_build_object(
        'fieldId', t.value->>'fieldId',
        'kind', t.value->>'kind',
        'source', t.value->>'source',
        'change', 'added',
        'to', t.value
      ) AS entry
    FROM jsonb_each(coalesce(p_to, '{}'::jsonb)) t
    WHERE NOT coalesce(p_from, '{}'::jsonb) ? t.key
    UNION ALL
    SELECT jsonb_build_object(
        'fieldId', f.value->>'fieldId',
        'kind', f.value->>'kind',
        'source', f.value->>'source',
        'change', 'removed',
        'from', f.value
      )
    FROM jsonb_each(coalesce(p_from, '{}'::jsonb)) f
    WHERE NOT coalesce(p_to, '{}'::jsonb) ? f.key
    UNION ALL
    SELECT jsonb_build_object(
        'fieldId', t.value->>'fieldId',
        'kind', t.value->>'kind',
        'source', t.value->>'source',
        'change', 'changed',
        'from', f.value,
        'to', t.value
      )
    FROM jsonb_each(coalesce(p_from, '{}'::jsonb)) f
    JOIN jsonb_each(coalesce(p_to, '{}'::jsonb)) t ON t.key = f.key
    WHERE f.value IS DISTINCT FROM t.value
  ) d
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.dataset_version_flag_delta(jsonb, jsonb) FROM PUBLIC;
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
    WITH a AS (
      SELECT r.row_id,
             r.row_values,
             coalesce(f.row_flags, '{}'::jsonb) AS row_flags
      FROM internal.dataset_version_row_values(p_version_a) r
      LEFT JOIN internal.dataset_version_row_flags(p_version_a) f
        ON f.row_id = r.row_id
    ),
         b AS (
      SELECT r.row_id,
             r.row_values,
             coalesce(f.row_flags, '{}'::jsonb) AS row_flags
      FROM internal.dataset_version_row_values(p_version_b) r
      LEFT JOIN internal.dataset_version_row_flags(p_version_b) f
        ON f.row_id = r.row_id
    ),
         joined AS (
           SELECT coalesce(a.row_id, b.row_id) AS row_id,
                  a.row_values AS av,
                  b.row_values AS bv,
                  coalesce(a.row_flags, '{}'::jsonb) AS af,
                  coalesce(b.row_flags, '{}'::jsonb) AS bf
           FROM a FULL JOIN b USING (row_id)
         ),
         with_delta AS (
           SELECT row_id, av, bv, af, bf,
             CASE WHEN av IS NULL THEN 'added'
                  WHEN bv IS NULL THEN 'removed'
                  ELSE 'changed' END AS kind,
             internal.dataset_version_flag_delta(af, bf) AS flag_changes
           FROM joined
         ),
         classified AS (
           SELECT * FROM with_delta
           WHERE av IS NULL OR bv IS NULL OR av <> bv
              OR flag_changes <> '[]'::jsonb
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
          'changed', count(*) FILTER (WHERE kind = 'changed'),
          'flags', coalesce(sum(jsonb_array_length(flag_changes)), 0)
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
          ), '[]'::jsonb),
          'flagFields', flag_changes
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
