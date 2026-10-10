-- GOV-01 — dataset archive/restore require a workspace writer.
--
-- 0192 intended this, but the migration had already been applied before the
-- archive_dataset/restore_dataset bodies were added, so existing databases kept
-- the membership-only gate. Re-apply the writer gate in a new migration.

CREATE OR REPLACE FUNCTION api.archive_dataset(p_dataset_id uuid, p_expected_revision bigint)
RETURNS api.datasets
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE dataset api.datasets;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id = p_dataset_id FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.is_workspace_writer(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'active' THEN RAISE EXCEPTION 'Dataset is already archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets
     SET lifecycle = 'archived', archived_at = now(), revision = revision + 1, updated_at = now()
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
  IF dataset.id IS NULL OR NOT api.is_workspace_writer(dataset.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
  END IF;
  IF dataset.revision <> p_expected_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE = 'SB001'; END IF;
  IF dataset.lifecycle <> 'archived' THEN RAISE EXCEPTION 'Dataset is not archived' USING ERRCODE = 'SB072'; END IF;
  UPDATE api.datasets
     SET lifecycle = 'active', archived_at = NULL, revision = revision + 1, updated_at = now()
   WHERE id = dataset.id RETURNING * INTO dataset;
  RETURN dataset;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
