-- LAB-06.4 — the drift read model gains the instrument comparison.
--
-- REV-04.1 compares what a frozen revision captured with what is live now; instruments join
-- that comparison here. The signed name comes from the revision's own canonical snapshot, never
-- from a live read, and only the current name is read live - which is the whole point of the
-- rule, since a rename must be visible rather than silently applied to history.

CREATE OR REPLACE FUNCTION api.revision_drift(p_revision_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_revision api.revisions;
  v_record api.records;
  v_signed_title text;
  v_datasets jsonb := '[]'::jsonb;
  v_instruments jsonb := '[]'::jsonb;
  v_captured jsonb;
  v_current api.instruments;
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

  -- LAB-06.4: instrument names as captured when the revision was frozen, each against the
  -- name the instrument has now. A revision signed before the capture existed has no
  -- instruments section and reports none rather than guessing.
  FOR v_captured IN
    SELECT value
      FROM jsonb_array_elements(
        coalesce(v_revision.canonical_snapshot->'instruments', '[]'::jsonb))
  LOOP
    CONTINUE WHEN nullif(v_captured->>'instrumentId', '') IS NULL;
    SELECT * INTO v_current FROM api.instruments
     WHERE id = (v_captured->>'instrumentId')::uuid;
    v_instruments := v_instruments || jsonb_build_array(jsonb_build_object(
      'instrumentId', v_captured->>'instrumentId',
      'displayId', v_captured->>'displayId',
      'signedName', v_captured->>'name',
      'currentName', v_current.name,
      'renamed', v_captured->>'name' IS DISTINCT FROM v_current.name));
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
    'instruments', v_instruments,
    'commentsAfterSigning', v_comments,
    'drifted', (v_signed_title IS DISTINCT FROM v_record.title)
               OR v_comments > 0
               OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_datasets) d
                     WHERE (d->>'changed')::boolean)
               OR EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_instruments) i
                     WHERE (i->>'renamed')::boolean));
END $function$;

NOTIFY pgrst, 'reload schema';
