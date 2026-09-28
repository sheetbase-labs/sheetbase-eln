-- DSET-01.1 — flags in a snapshot.
--
-- At capture, the dataset's active value flags are frozen into the version so
-- a review sees the flags as they were. The table is internal-only (read via
-- the snapshot models), so it carries RLS with no grants.

REVOKE ALL ON api.dataset_version_flags FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
ALTER TABLE api.dataset_version_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.snapshot_dataset(p_dataset_id uuid, p_expected_dataset_revision bigint, p_label text)
RETURNS api.dataset_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE dataset api.datasets; version api.dataset_versions;
BEGIN
  SELECT * INTO dataset FROM api.datasets WHERE id=p_dataset_id AND workspace_id=api.current_workspace_id() AND api.is_workspace_writer(workspace_id) FOR UPDATE;
  IF dataset.id IS NULL OR NOT api.has_write_actor() THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE='42501'; END IF;
  IF dataset.revision<>p_expected_dataset_revision THEN RAISE EXCEPTION 'stale Dataset revision' USING ERRCODE='SB001'; END IF;
  IF dataset.lifecycle<>'active' THEN RAISE EXCEPTION 'cannot snapshot archived Dataset' USING ERRCODE='22023'; END IF;
  INSERT INTO api.dataset_versions(dataset_id,workspace_id,schema_version_id,source_dataset_revision,label,created_by_user_id,created_by_credential_id)
  VALUES(dataset.id,dataset.workspace_id,dataset.schema_version_id,dataset.revision,p_label,api.current_user_id(),api.current_credential_id()) RETURNING * INTO version;
  INSERT INTO api.dataset_version_rows(dataset_version_id,row_id,revision)
  SELECT version.id,id,revision FROM api.dataset_rows WHERE dataset_id=dataset.id;
  INSERT INTO api.dataset_version_values(dataset_version_id,row_id,field_id,ordinal,text_value,integer_value,numeric_value,boolean_value,date_value,timestamp_value,category_option_id,reference_id)
  SELECT version.id,v.row_id,v.field_id,v.ordinal,v.text_value,v.integer_value,v.numeric_value,v.boolean_value,v.date_value,v.timestamp_value,v.category_option_id,v.reference_id
  FROM api.dataset_row_values v JOIN api.dataset_rows r ON r.id=v.row_id WHERE r.dataset_id=dataset.id;
  INSERT INTO api.dataset_version_flags(dataset_version_id,row_id,field_id,kind,reason,comment,set_by_user_id,set_at)
  SELECT version.id,f.row_id,f.field_id,f.kind,f.reason,f.comment,f.set_by_user_id,f.set_at
  FROM api.dataset_value_flags f
  WHERE f.dataset_id=dataset.id AND f.cleared_at IS NULL
    AND EXISTS (SELECT 1 FROM api.dataset_version_rows vr WHERE vr.dataset_version_id=version.id AND vr.row_id=f.row_id);
  RETURN version;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.snapshot_dataset(uuid, bigint, text) TO api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
