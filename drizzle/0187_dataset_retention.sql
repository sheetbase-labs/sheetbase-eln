-- DSET-04.1 — snapshot retention (DEC-11).
--
-- A snapshot cited by a signed record is kept for the workspace's cited
-- retention period (15 years) from the signing; an uncited snapshot is kept
-- for the uncited period (2 years) after its dataset is archived. While the
-- dataset is active there is no removal. Archiving now records the time.

CREATE OR REPLACE FUNCTION api.archive_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_member(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'active' THEN RAISE EXCEPTION 'Dataset is already archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'archived', archived_at = now(), revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.restore_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_member(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'archived' THEN RAISE EXCEPTION 'Dataset is not archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets SET lifecycle = 'active', archived_at = NULL, revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.dataset_version_retention(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.dataset_versions;
  d api.datasets;
  ws api.workspace_settings;
  cited timestamptz;
  cited_years integer;
  uncited_years integer;
BEGIN
  SELECT * INTO v FROM api.dataset_versions
    WHERE id = p_version_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(workspace_id);
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Version denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO d FROM api.datasets WHERE id = v.dataset_id;
  SELECT * INTO ws FROM api.workspace_settings WHERE workspace_id = v.workspace_id;
  cited_years := coalesce(ws.snapshot_cited_retention_years, 15);
  uncited_years := coalesce(ws.snapshot_uncited_retention_years, 2);

  SELECT max(s.signed_at) INTO cited
    FROM api.revision_sheet_evidence e
    JOIN api.signatures s ON s.revision_id = e.revision_id
    WHERE s.signature_meaning = 'approve-for-record'
      AND e.dataset_versions ? v.id::text;

  IF cited IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'cited_by_signed_record',
      'keptUntil', cited + make_interval(years => cited_years)
    );
  END IF;
  IF d.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'reason', 'uncited_after_archive',
      'keptUntil', d.archived_at + make_interval(years => uncited_years)
    );
  END IF;
  RETURN jsonb_build_object('reason', 'active', 'keptUntil', NULL);
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_version_retention(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.dataset_version_retention(uuid) TO authenticated;
--> statement-breakpoint

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
        END,
        'retention', api.dataset_version_retention(v.id)
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
