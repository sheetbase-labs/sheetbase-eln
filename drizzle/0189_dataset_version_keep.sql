-- DSET-04.3 — "Keep" a snapshot with a reason.
--
-- Snapshot rows are frozen evidence, so the keep is stored beside the version
-- in `api.dataset_version_keeps` (not exposed to PostgREST; read by the
-- retention function). A keep pushes removal out by the workspace's uncited
-- retention period and records why; a signed citation still takes precedence.

REVOKE ALL ON api.dataset_version_keeps FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.keep_dataset_version(p_version_id uuid, p_reason text)
RETURNS api.dataset_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.dataset_versions;
  ws api.workspace_settings;
  years integer;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required to keep a snapshot' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.dataset_versions WHERE id = p_version_id FOR UPDATE;
  IF v.id IS NULL OR NOT api.is_workspace_writer(v.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'snapshot not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO ws FROM api.workspace_settings WHERE workspace_id = v.workspace_id;
  years := coalesce(ws.snapshot_uncited_retention_years, 2);
  INSERT INTO api.dataset_version_keeps
    (dataset_version_id, kept_until, reason, created_by_user_id)
  VALUES (v.id, now() + make_interval(years => years), btrim(p_reason), api.current_user_id())
  ON CONFLICT (dataset_version_id) DO UPDATE
    SET kept_until = EXCLUDED.kept_until,
        reason = EXCLUDED.reason,
        created_by_user_id = EXCLUDED.created_by_user_id,
        created_at = now();
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.keep_dataset_version(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.keep_dataset_version(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.dataset_version_retention(p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.dataset_versions;
  d api.datasets;
  ws api.workspace_settings;
  keep api.dataset_version_keeps;
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
  SELECT * INTO keep FROM api.dataset_version_keeps WHERE dataset_version_id = v.id;
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
  IF keep.kept_until IS NOT NULL AND keep.kept_until > now() THEN
    RETURN jsonb_build_object('reason', 'kept', 'keptUntil', keep.kept_until);
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
NOTIFY pgrst, 'reload schema';
