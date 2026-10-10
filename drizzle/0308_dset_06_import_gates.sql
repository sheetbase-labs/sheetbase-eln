-- DSET-06.2: one intended-use classification on canonical Datasets, one
-- import receipt path over the existing atomic row writer, including connectors.
CREATE FUNCTION internal.guard_dataset_intended_use()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_reason text;
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.intended_use = 'exploratory_research') OR
     (TG_OP = 'UPDATE' AND NEW.intended_use = OLD.intended_use) THEN
    RETURN NEW;
  END IF;
  -- Local migration/seed connections are not an authenticated import surface.
  IF session_user IN ('migrator', 'sheetbase') THEN RETURN NEW; END IF;
  IF NEW.workspace_id IS DISTINCT FROM api.current_workspace_id() OR
     NOT api.has_capability(NEW.workspace_id, 'schema.publish') OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'scientific configuration authority required' USING ERRCODE = '42501';
  END IF;
  v_reason := nullif(btrim(current_setting('sheetbase.intended_use_reason', true)), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'an intended-use change reason is required' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'dataset', NEW.id, 'update',
    NULL, NULL, jsonb_build_object('intendedUse', NEW.intended_use, 'reason', v_reason));
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_dataset_intended_use() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER guard_dataset_intended_use BEFORE INSERT OR UPDATE OF intended_use ON api.datasets
  FOR EACH ROW EXECUTE FUNCTION internal.guard_dataset_intended_use();
--> statement-breakpoint
CREATE FUNCTION api.set_dataset_intended_use(p_dataset_id uuid, p_intended_use text, p_reason text)
RETURNS api.datasets LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE d api.datasets;
BEGIN
  SELECT * INTO d FROM api.datasets WHERE id = p_dataset_id AND workspace_id = api.current_workspace_id()
    AND api.has_capability(workspace_id, 'schema.publish') AND api.has_write_actor() FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'scientific configuration authority required' USING ERRCODE = '42501'; END IF;
  IF p_intended_use IS NULL OR p_intended_use NOT IN ('exploratory_research', 'controlled_development', 'regulated_record') OR
     p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'valid intended use and change reason required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('sheetbase.intended_use_reason', btrim(p_reason), true);
  UPDATE api.datasets SET intended_use = p_intended_use, revision = revision + 1, updated_at = now()
    WHERE id = d.id RETURNING * INTO d;
  PERFORM set_config('sheetbase.intended_use_reason', '', true);
  RETURN d;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_dataset_intended_use(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_dataset_intended_use(uuid, text, text) TO authenticated;
--> statement-breakpoint

-- Registration cannot be used as an approval bypass, and ensuring a version
-- never changes its definition or approval behind already-imported evidence.
CREATE OR REPLACE FUNCTION api.ensure_parser(
  p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer,
  p_signature jsonb, p_mapping jsonb DEFAULT '{}'::jsonb,
  p_instrument_id uuid DEFAULT NULL, p_status text DEFAULT 'draft'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p api.parsers; v api.parser_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() OR
     (p_status <> 'draft' AND NOT api.has_capability(p_workspace_id, 'schema.publish')) THEN
    RAISE EXCEPTION 'not permitted to register or approve a parser' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'validated', 'approved') OR p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'valid parser status and positive version required' USING ERRCODE = '22023';
  END IF;
  IF p_instrument_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.instruments
    WHERE id = p_instrument_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'instrument not found' USING ERRCODE = 'SB106';
  END IF;
  INSERT INTO api.parsers (workspace_id, key, name, format, instrument_id, created_by_user_id)
    VALUES (p_workspace_id, btrim(p_key), btrim(p_name), p_format, p_instrument_id, api.current_user_id())
    ON CONFLICT (workspace_id, key) DO UPDATE SET updated_at = api.parsers.updated_at RETURNING * INTO p;
  IF p.format <> p_format THEN RAISE EXCEPTION 'parser format mismatch' USING ERRCODE = 'SB107'; END IF;
  INSERT INTO api.parser_versions
    (workspace_id, parser_id, version, status, signature, mapping, approved_at, approved_by_user_id, created_by_user_id)
    VALUES (p_workspace_id, p.id, p_version, p_status, coalesce(p_signature, '{}'), coalesce(p_mapping, '{}'),
      CASE WHEN p_status = 'approved' THEN now() END,
      CASE WHEN p_status = 'approved' THEN api.current_user_id() END, api.current_user_id())
    ON CONFLICT (parser_id, version) DO UPDATE SET updated_at = api.parser_versions.updated_at RETURNING * INTO v;
  RETURN jsonb_build_object('parserId', p.id, 'parserVersionId', v.id, 'version', v.version, 'status', v.status);
END $$;
--> statement-breakpoint

DROP FUNCTION api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid);
--> statement-breakpoint
CREATE FUNCTION api.commit_dataset_import(
  p_dataset_id uuid, p_expected_dataset_revision bigint, p_rows jsonb, p_idempotency_key text,
  p_file_id uuid, p_mapping jsonb, p_outcome jsonb,
  p_parser_id uuid DEFAULT NULL, p_parser_version_id uuid DEFAULT NULL,
  p_experiment_record_id uuid DEFAULT NULL, p_instrument_id uuid DEFAULT NULL,
  p_connector_run_id uuid DEFAULT NULL, p_source_provenance jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  d api.datasets; existing api.dataset_imports; f api.dataset_import_files;
  p api.parsers; v api.parser_versions; r api.connector_runs;
  committed jsonb; snapshot api.dataset_versions; receipt api.dataset_imports;
  provenance jsonb; source jsonb; row_ids jsonb;
BEGIN
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
       existing.parser_version_id IS DISTINCT FROM p_parser_version_id OR existing.connector_run_id IS DISTINCT FROM p_connector_run_id THEN
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
    source := jsonb_build_object('fileId', f.id, 'filename', f.filename, 'checksum', f.checksum, 'storageKey', f.storage_key);
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
    left('Import ' || coalesce(f.filename, 'connector ' || r.id::text), 200));
  INSERT INTO api.dataset_imports
    (workspace_id, dataset_id, experiment_record_id, instrument_id, parser_id, parser_version_id,
     file_id, connector_run_id, imported_row_ids, parser_provenance, source_provenance,
     mapping, outcome, snapshot_version_id, status, idempotency_key, created_by_user_id)
    VALUES (d.workspace_id, d.id, p_experiment_record_id, p_instrument_id, p.id, v.id,
      p_file_id, p_connector_run_id, row_ids, provenance, source, coalesce(p_mapping, '{}'), coalesce(p_outcome, '{}'),
      snapshot.id, 'committed', btrim(p_idempotency_key), api.current_user_id()) RETURNING * INTO receipt;
  IF f.id IS NOT NULL THEN
    UPDATE api.dataset_import_files SET dataset_id = d.id, status = 'parsed', updated_at = now() WHERE id = f.id;
  END IF;
  RETURN committed || jsonb_build_object('idempotent', false, 'importId', receipt.id, 'snapshotVersionId', snapshot.id, 'outcome', receipt.outcome);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.commit_dataset_import(uuid, bigint, jsonb, text, uuid, jsonb, jsonb, uuid, uuid, uuid, uuid, uuid, jsonb) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
