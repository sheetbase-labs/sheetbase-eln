-- REV-04.1 — the evidence view compares a signed revision with live data.
--
-- A signed revision is frozen, so what matters is what has moved since: the
-- datasets it cited against their latest versions, the record's name as signed
-- versus now (LAB-06 renaming), and any comments added after signing. The
-- evidence package (api.revision_evidence_package) carries the frozen content;
-- this read model carries the drift, so the page can show both without
-- reconstructing history client-side.
CREATE OR REPLACE FUNCTION api.revision_drift(p_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_revision api.revisions;
  v_record api.records;
  v_signed_title text;
  v_datasets jsonb := '[]'::jsonb;
  v_cited jsonb;
  v_latest api.dataset_versions;
  v_comments integer := 0;
BEGIN
  SELECT * INTO v_revision FROM api.revisions WHERE id = p_revision_id;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.assert_object_access('record', v_revision.record_id, 'view');

  SELECT * INTO v_record FROM api.records WHERE id = v_revision.record_id;
  v_signed_title := v_revision.metadata_snapshot->>'title';

  -- Cited dataset versions, each against the dataset's latest version.
  FOR v_cited IN
    SELECT DISTINCT value
      FROM api.revision_sheet_evidence e,
           jsonb_array_elements(coalesce(e.dataset_versions, '[]'::jsonb))
     WHERE e.revision_id = p_revision_id
  LOOP
    CONTINUE WHEN nullif(v_cited->>'id', '') IS NULL;
    SELECT * INTO v_latest FROM api.dataset_versions
     WHERE dataset_id = (v_cited->>'datasetId')::uuid
     ORDER BY source_dataset_revision DESC, created_at DESC
     LIMIT 1;
    v_datasets := v_datasets || jsonb_build_array(jsonb_build_object(
      'datasetId', v_cited->>'datasetId',
      'citedVersionId', v_cited->>'id',
      'citedLabel', v_cited->>'label',
      'citedDatasetRevision', v_cited->>'sourceDatasetRevision',
      'latestVersionId', v_latest.id,
      'latestLabel', v_latest.label,
      'latestDatasetRevision', v_latest.source_dataset_revision,
      'changed', v_latest.id IS DISTINCT FROM (v_cited->>'id')::uuid));
  END LOOP;

  -- Comments added after the revision was frozen.
  SELECT count(*) INTO v_comments
    FROM api.comments c
   WHERE c.record_id = v_revision.record_id
     AND c.created_at > v_revision.created_at;

  RETURN jsonb_build_object(
    'revisionId', v_revision.id,
    'recordId', v_revision.record_id,
    'signedAt', v_revision.created_at,
    'record', jsonb_build_object(
      'recordId', v_record.id,
      'identifier', v_record.identifier,
      'signedTitle', v_signed_title,
      'currentTitle', v_record.title,
      'renamed', v_signed_title IS DISTINCT FROM v_record.title),
    'datasets', v_datasets,
    'commentsAfterSigning', v_comments,
    'drifted', (v_signed_title IS DISTINCT FROM v_record.title)
               OR v_comments > 0
               OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_datasets) d
                     WHERE (d->>'changed')::boolean));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.revision_drift(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.revision_drift(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
