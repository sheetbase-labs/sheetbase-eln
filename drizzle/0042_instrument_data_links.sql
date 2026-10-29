-- Instrument data lands where scientists work.
--
-- A dataset made by instrument intake carried no project, owner, experiment or
-- run, and its first version was named after the connector run's UUID. This:
--
--   * names that version after the file that was read;
--   * adds link_intake_dataset, which gives the dataset its project and owner
--     when it has none, records the instrument run on the import receipt, and
--     links the run and the dataset to the one open experiment that already
--     uses the samples the file names (no experiment is guessed when more than
--     one qualifies).

CREATE OR REPLACE FUNCTION api.commit_dataset_import(p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text, p_file_id uuid, p_mapping jsonb, p_outcome jsonb, p_parser_id uuid DEFAULT NULL::uuid, p_parser_version_id uuid DEFAULT NULL::uuid, p_experiment_record_id uuid DEFAULT NULL::uuid, p_instrument_id uuid DEFAULT NULL::uuid, p_connector_run_id uuid DEFAULT NULL::uuid, p_source_provenance jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  d api.datasets; existing api.dataset_imports; f api.dataset_import_files;
  p api.parsers; v api.parser_versions; r api.connector_runs;
  committed jsonb; snapshot api.dataset_versions; receipt api.dataset_imports;
  provenance jsonb; source jsonb; row_ids jsonb;
BEGIN
 IF p_dataset_id IS NOT NULL THEN PERFORM internal.assert_object_access('dataset',p_dataset_id,'edit'); END IF;
 IF p_file_id IS NOT NULL THEN PERFORM internal.assert_object_access('import_file',p_file_id,'edit'); END IF;
 IF p_experiment_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_experiment_record_id,'edit'); END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'an idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM api.datasets WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
    AND api.is_workspace_writer(workspace_id) AND api.has_write_actor() FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'dataset denied' USING ERRCODE = '42501'; END IF;
  IF d.lifecycle <> 'active' THEN RAISE EXCEPTION 'cannot import into an archived Dataset' USING ERRCODE = '22023'; END IF;
  SELECT * INTO existing FROM api.dataset_imports WHERE workspace_id = d.workspace_id AND idempotency_key = btrim(p_idempotency_key);
  IF existing.id IS NOT NULL THEN
    IF existing.dataset_id <> d.id OR existing.created_by_user_id IS DISTINCT FROM api.current_user_id() OR
       existing.file_id IS DISTINCT FROM p_file_id OR existing.parser_id IS DISTINCT FROM p_parser_id OR
       existing.parser_version_id IS DISTINCT FROM p_parser_version_id OR existing.connector_run_id IS DISTINCT FROM p_connector_run_id OR
       (p_file_id IS NOT NULL AND existing.mapping IS DISTINCT FROM coalesce(p_mapping, '{}'::jsonb)) THEN
      RAISE EXCEPTION 'import key belongs to another request' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'importId', existing.id,
      'snapshotVersionId', existing.snapshot_version_id, 'outcome', existing.outcome);
  END IF;
  SELECT * INTO p FROM api.parsers WHERE id = p_parser_id AND workspace_id = d.workspace_id;
  SELECT * INTO v FROM api.parser_versions WHERE id = p_parser_version_id AND parser_id = p.id AND workspace_id = d.workspace_id FOR SHARE;
  IF p.id IS NULL OR v.id IS NULL OR v.status = 'retired' THEN
    RAISE EXCEPTION 'a matching usable parser version is required' USING ERRCODE = 'SB107';
  END IF;
  IF d.intended_use = 'regulated_record' AND v.status <> 'approved' THEN
    RAISE EXCEPTION 'regulated Dataset requires an approved parser version' USING ERRCODE = 'SB107';
  END IF;
  IF p_connector_run_id IS NOT NULL THEN
    SELECT * INTO r FROM api.connector_runs WHERE id = p_connector_run_id AND workspace_id = d.workspace_id
      AND status = 'running' AND actor_user_id IS NOT DISTINCT FROM api.current_user_id()
      AND actor_credential_id IS NOT DISTINCT FROM api.current_credential_id() FOR SHARE;
    IF r.id IS NULL THEN RAISE EXCEPTION 'active connector run required' USING ERRCODE = '42501'; END IF;
  END IF;
  IF p_file_id IS NOT NULL THEN
    SELECT * INTO f FROM api.dataset_import_files WHERE id = p_file_id AND workspace_id = d.workspace_id;
    IF f.id IS NULL THEN RAISE EXCEPTION 'import file not found' USING ERRCODE = 'SB106'; END IF;
    IF f.format <> p.format THEN RAISE EXCEPTION 'parser format does not match the file' USING ERRCODE = 'SB107'; END IF;
    
    IF p_mapping ? 'sheetName' AND
      (jsonb_typeof(p_mapping->'sheetName') <> 'string' OR length(btrim(p_mapping->>'sheetName')) = 0) THEN
      RAISE EXCEPTION 'valid worksheet name required' USING ERRCODE = '22023';
    END IF;
    source := jsonb_build_object('fileId', f.id, 'filename', f.filename, 'checksum', f.checksum, 'storageKey', f.storage_key)
      || jsonb_strip_nulls(jsonb_build_object('sheetName', p_mapping->'sheetName'));
    
  ELSE
    IF r.id IS NULL THEN RAISE EXCEPTION 'active connector run required' USING ERRCODE = '42501'; END IF;
    IF coalesce(p_source_provenance->>'checksum', '') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'connector source checksum required' USING ERRCODE = '22023';
    END IF;
    source := p_source_provenance || jsonb_build_object('connectorRunId', r.id, 'connectorId', r.connector_id, 'requestDigest', r.request_digest);
  END IF;
  IF p_experiment_record_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.records WHERE id = p_experiment_record_id AND workspace_id = d.workspace_id) THEN
    RAISE EXCEPTION 'experiment not found' USING ERRCODE = 'SB106';
  END IF;
  IF p_instrument_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.instruments WHERE id = p_instrument_id AND workspace_id = d.workspace_id) THEN
    RAISE EXCEPTION 'instrument not found' USING ERRCODE = 'SB106';
  END IF;
  provenance := jsonb_build_object('parserId', p.id, 'parserVersionId', v.id,
    'key', p.key, 'name', p.name, 'format', p.format, 'version', v.version, 'status', v.status,
    'signature', v.signature, 'mapping', v.mapping, 'approvedAt', v.approved_at, 'approvedByUserId', v.approved_by_user_id,
    'intendedUse', d.intended_use);
  committed := api.commit_dataset_row_batch_atomic(d.id, p_expected_dataset_revision, p_rows, btrim(p_idempotency_key));
  IF coalesce((committed->>'ok')::boolean, false) IS NOT TRUE THEN RETURN committed; END IF;
  -- Use actual committed IDs: planned-row fills can replace requested IDs.
  SELECT coalesce(jsonb_agg(e->'rowId'), '[]') INTO row_ids FROM jsonb_array_elements(committed->'rows') e;
  SELECT * INTO snapshot FROM api.snapshot_dataset(d.id, (committed->>'datasetRevision')::bigint,
    left('Import ' || coalesce(f.filename, nullif(p_source_provenance #>> '{source,fileName}', ''), 'instrument file'), 200));
  INSERT INTO api.dataset_imports
    (workspace_id, dataset_id, experiment_record_id, instrument_id, parser_id, parser_version_id,
     file_id, connector_run_id, imported_row_ids, parser_provenance, source_provenance,
     mapping, outcome, snapshot_version_id, status, idempotency_key, created_by_user_id)
    VALUES (d.workspace_id, d.id, p_experiment_record_id, p_instrument_id, p.id, v.id,
      p_file_id, p_connector_run_id, row_ids, provenance, source, coalesce(p_mapping, '{}'), coalesce(p_outcome, '{}'),
      snapshot.id, 'committed', btrim(p_idempotency_key), api.current_user_id()) RETURNING * INTO receipt;
  -- LINK-01: the experiment reads its data through record_links.
  IF p_experiment_record_id IS NOT NULL AND d.display_id IS NOT NULL THEN
    BEGIN
      INSERT INTO api.record_links
        (source_record_id, target_kind, target_identifier, link_type, link_metadata, created_by_user_id)
      SELECT x.id, 'dataset', d.display_id, 'dataset',
             jsonb_build_object('origin', 'commit_dataset_import', 'importId', receipt.id),
             api.current_user_id()
        FROM api.records x
       WHERE x.id = p_experiment_record_id AND x.kind = 'experiment' AND x.locked_at IS NULL
      ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;
    EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
      RAISE EXCEPTION 'cannot link dataset % to the experiment: %', d.display_id, SQLERRM
        USING ERRCODE = SQLSTATE;
    END;
  END IF;
  IF f.id IS NOT NULL THEN
    UPDATE api.dataset_import_files SET dataset_id = d.id, status = 'parsed', updated_at = now() WHERE id = f.id;
  END IF;
  RETURN committed || jsonb_build_object('idempotent', false, 'importId', receipt.id, 'snapshotVersionId', snapshot.id, 'outcome', receipt.outcome);
END $_$;

--> statement-breakpoint
CREATE FUNCTION api.link_intake_dataset(p_workspace_id uuid, p_dataset_id uuid, p_project_id uuid, p_run_id uuid, p_connector_run_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  d api.datasets;
  v_run api.instrument_runs;
  v_exp api.records;
  v_count integer := 0;
  v_experiments uuid[];
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM internal.assert_object_access('dataset', p_dataset_id, 'edit');
  SELECT * INTO d FROM api.datasets
   WHERE id = p_dataset_id AND workspace_id = p_workspace_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'dataset not found' USING ERRCODE = 'SB106'; END IF;

  -- Fill only what is empty: an existing dataset keeps its project and owner.
  IF d.primary_project_id IS NULL AND p_project_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = p_workspace_id) THEN
    UPDATE api.datasets SET primary_project_id = p_project_id WHERE id = d.id;
  END IF;
  IF d.created_by_user_id IS NULL AND d.created_by_credential_id IS NULL
     AND api.current_user_id() IS NOT NULL THEN
    UPDATE api.datasets SET created_by_user_id = api.current_user_id() WHERE id = d.id;
  END IF;

  IF p_run_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('run', p_run_id, 'edit');
    SELECT * INTO v_run FROM api.instrument_runs
     WHERE id = p_run_id AND workspace_id = p_workspace_id;
    IF v_run.id IS NULL THEN RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB039'; END IF;

    -- The experiments that already use a sample this run measured.
    SELECT coalesce(array_agg(DISTINCT x.id), '{}') INTO v_experiments
      FROM api.instrument_run_links rl
      JOIN api.record_links l
        ON l.target_record_id = rl.linked_record_id AND l.link_type = 'sample'
      JOIN api.records x
        ON x.id = l.source_record_id AND x.kind = 'experiment'
       AND x.workspace_id = p_workspace_id
       AND x.deleted_at IS NULL AND x.locked_at IS NULL
     WHERE rl.run_id = p_run_id AND rl.link_type = 'sample'
       AND internal.can_access_object('record', x.id, 'edit');
    v_count := coalesce(array_length(v_experiments, 1), 0);
    IF v_count = 1 THEN
      SELECT * INTO v_exp FROM api.records WHERE id = v_experiments[1];
      IF NOT EXISTS (
        SELECT 1 FROM api.instrument_run_links
         WHERE run_id = p_run_id AND linked_record_id = v_exp.id AND link_type = 'experiment') THEN
        INSERT INTO api.instrument_run_links
          (workspace_id, run_id, linked_record_id, linked_record_identifier, linked_record_title, link_type)
        VALUES (p_workspace_id, p_run_id, v_exp.id, v_exp.identifier, v_exp.title, 'experiment');
      END IF;
      IF d.display_id IS NOT NULL THEN
        BEGIN
          INSERT INTO api.record_links
            (source_record_id, target_kind, target_identifier, link_type, link_metadata, created_by_user_id)
          VALUES (v_exp.id, 'dataset', d.display_id, 'dataset',
                  jsonb_build_object('origin', 'link_intake_dataset', 'runId', p_run_id),
                  api.current_user_id())
          ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;
        EXCEPTION WHEN SQLSTATE 'SB080' OR SQLSTATE 'SB081' THEN
          v_exp := NULL;
        END;
      END IF;
    END IF;

    -- The receipt says which run and instrument produced the data.
    IF p_connector_run_id IS NOT NULL THEN
      UPDATE api.dataset_imports
         SET instrument_id = coalesce(instrument_id, v_run.instrument_id),
             experiment_record_id = coalesce(experiment_record_id, v_exp.id),
             source_provenance = source_provenance
               || jsonb_build_object('instrumentRunId', v_run.id,
                                     'instrumentRunIdentifier', v_run.run_identifier)
       WHERE connector_run_id = p_connector_run_id AND dataset_id = d.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'experimentId', v_exp.id,
    'experimentIdentifier', v_exp.identifier,
    'candidates', v_count);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.link_intake_dataset(uuid, uuid, uuid, uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.link_intake_dataset(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.link_intake_dataset(uuid, uuid, uuid, uuid, uuid) TO authenticated;
