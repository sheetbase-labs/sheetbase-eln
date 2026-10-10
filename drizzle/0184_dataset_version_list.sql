-- DSET-03.1 — the snapshot list read model.
--
-- One row per snapshot of a dataset: who made it, how many rows it holds and
-- the change summary against the previous snapshot (added/removed/changed).
-- Cited-by and keeping status arrive with DSET-04.

CREATE OR REPLACE FUNCTION api.dataset_version_list(p_dataset_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  d api.datasets;
BEGIN
  SELECT * INTO d FROM api.datasets
    WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  IF d.id IS NULL THEN
    RAISE EXCEPTION 'Dataset denied' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', v.id,
        'label', v.label,
        'createdAt', v.created_at,
        'createdByUserId', v.created_by_user_id,
        'sourceDatasetRevision', v.source_dataset_revision,
        'rowCount', (
          SELECT count(*) FROM api.dataset_version_rows r
          WHERE r.dataset_version_id = v.id
        ),
        'change', CASE WHEN prev.id IS NULL THEN NULL
          ELSE api.compare_dataset_versions(prev.id, v.id, 1, 0) -> 'counts'
        END
      )
      ORDER BY v.created_at DESC, v.id DESC
    )
    FROM api.dataset_versions v
    LEFT JOIN LATERAL (
      SELECT p.id FROM api.dataset_versions p
      WHERE p.dataset_id = v.dataset_id
        AND (p.created_at, p.id) < (v.created_at, v.id)
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    ) prev ON true
    WHERE v.dataset_id = d.id
  ), '[]'::jsonb);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_version_list(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_version_list(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
