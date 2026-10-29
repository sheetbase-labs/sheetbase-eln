-- One parser model for every way a file arrives.
--
-- Until now the Import page read files through the workspace's parser list,
-- while the folder agent and the connector page read them with parsers that
-- lived only in code and quietly registered themselves as drafts. QA approval
-- therefore governed one route out of three.
--
-- From here the parser list is the only source:
--   * the built-in readers are approved parser versions in every workspace;
--   * a parser can also be a webhook: an address elsewhere that is sent the
--     file and answers with its rows (the signing key is sealed in `internal`);
--   * an instrument connector can commit data only through an approved version;
--   * a file that could not be read is kept as an open intake problem with the
--     reason, so it can be tried again or dismissed from the app.

-- The built-in readers. This list is the only place a version is approved
-- without a test file: it ships with the product and is covered by its tests.
CREATE FUNCTION internal.builtin_parser_catalogue()
    RETURNS TABLE (key text, name text, format text, version integer, signature jsonb)
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  VALUES
    ('sheetbase.plate-grid-csv', 'Plate reader grid (CSV)', 'csv', 1, '{"engine": "sheetbase.plate-grid-csv@1"}'::jsonb),
    ('sheetbase.qpcr-results-csv', 'qPCR results (CSV)', 'csv', 1, '{"engine": "sheetbase.qpcr-results-csv@1"}'::jsonb),
    ('sheetbase.hplc-peaks-csv', 'HPLC peak table (CSV)', 'csv', 1, '{"engine": "sheetbase.hplc-peaks-csv@1"}'::jsonb),
    ('sheetbase.json-records', 'JSON records', 'json', 1, '{"engine": "sheetbase.json-records@1"}'::jsonb),
    ('sheetbase.delimited', 'Delimited text (CSV/TSV)', 'csv', 1, '{"engine": "sheetbase.delimited@1"}'::jsonb),
    ('sheetbase.plate-reader-csv', 'Plate reader CSV', 'csv', 1,
      '{"requiredHeaders": ["sample", "well"], "optionalHeaders": ["od", "od450", "raw", "conc", "dilution"], "requiresMetadata": true}'::jsonb),
    ('sheetbase.plate-map', 'PR-01 plate map', 'xlsx', 1,
      '{"requiredHeaders": ["sample", "well"], "optionalHeaders": ["dilution", "od", "od450", "conc", "raw", "read time"]}'::jsonb)
$$;
--> statement-breakpoint
ALTER FUNCTION internal.builtin_parser_catalogue() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.builtin_parser_catalogue() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION internal.seed_builtin_parsers(p_workspace_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c record;
  v_parser_id uuid;
  v_count integer := 0;
BEGIN
  FOR c IN SELECT * FROM internal.builtin_parser_catalogue() LOOP
    INSERT INTO api.parsers (workspace_id, key, name, format)
      VALUES (p_workspace_id, c.key, c.name, c.format)
      ON CONFLICT (workspace_id, key) DO UPDATE
        SET format = EXCLUDED.format, updated_at = now()
        WHERE api.parsers.format IS DISTINCT FROM EXCLUDED.format
      RETURNING id INTO v_parser_id;
    IF v_parser_id IS NULL THEN
      SELECT id INTO v_parser_id FROM api.parsers WHERE workspace_id = p_workspace_id AND key = c.key;
    END IF;
    INSERT INTO api.parser_versions
        (workspace_id, parser_id, version, status, signature, mapping, test_result, validated_at, approved_at)
      VALUES (p_workspace_id, v_parser_id, c.version, 'approved', c.signature, '{}'::jsonb,
              jsonb_build_object('ok', true, 'builtin', true), now(), now())
      -- A version registered earlier as a bare draft by the old code path becomes
      -- the approved built-in; one anyone has tested, approved or retired is
      -- left exactly as it is.
      ON CONFLICT (parser_id, version) DO UPDATE
        SET status = 'approved', signature = EXCLUDED.signature, test_result = EXCLUDED.test_result,
            validated_at = EXCLUDED.validated_at, approved_at = EXCLUDED.approved_at, updated_at = now()
        WHERE api.parser_versions.status = 'draft' AND api.parser_versions.test_result IS NULL;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.seed_builtin_parsers(p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.seed_builtin_parsers(p_workspace_id uuid) FROM PUBLIC;
--> statement-breakpoint
-- Called before a file is read, so a workspace created after this migration
-- gets the built-in readers the first time a file arrives.
CREATE FUNCTION api.ensure_builtin_parsers(p_workspace_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to read files into this workspace' USING ERRCODE = '42501';
  END IF;
  RETURN internal.seed_builtin_parsers(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.ensure_builtin_parsers(p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.ensure_builtin_parsers(p_workspace_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.ensure_builtin_parsers(p_workspace_id uuid) TO authenticated;
--> statement-breakpoint
SELECT internal.seed_builtin_parsers(id) FROM api.workspaces;
--> statement-breakpoint
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
    left('Import ' || coalesce(f.filename, 'connector ' || r.id::text), 200));
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
-- A parser that is an address elsewhere. Pointing the workspace's files at an
-- outside service is an integration, so it needs the same access as one.
CREATE FUNCTION api.create_webhook_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer, p_url text, p_instrument_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF p_url IS NULL OR p_url !~ '^https?://[^/@[:space:]]+(/[^[:space:]]*)?$' OR length(p_url) > 2000 THEN
    RAISE EXCEPTION 'a webhook parser needs an http or https address' USING ERRCODE = '22023';
  END IF;
  RETURN api.create_parser_version(p_workspace_id, p_key, p_name, p_format, p_version,
    jsonb_build_object('webhook', jsonb_build_object('url', p_url)), '{}'::jsonb, p_instrument_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_webhook_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer, p_url text, p_instrument_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_webhook_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer, p_url text, p_instrument_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_webhook_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer, p_url text, p_instrument_id uuid) TO authenticated;
--> statement-breakpoint
-- The signing key a webhook parser's service checks. Sealed by the app, one
-- per parser, never readable through the API.
CREATE TABLE internal.parser_webhook_secrets (
    parser_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    ciphertext bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT parser_webhook_secrets_pkey PRIMARY KEY (parser_id)
);
--> statement-breakpoint
ALTER TABLE internal.parser_webhook_secrets OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY internal.parser_webhook_secrets
    ADD CONSTRAINT parser_webhook_secrets_parser_id_fk FOREIGN KEY (parser_id) REFERENCES api.parsers(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY internal.parser_webhook_secrets
    ADD CONSTRAINT parser_webhook_secrets_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
-- A file an instrument connector could not read, and why. It stays open until
-- the file is read, someone tries it again successfully, or it is dismissed.
CREATE TABLE api.intake_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connector_id uuid NOT NULL,
    instrument_id uuid,
    connector_run_id uuid,
    file_record_id uuid,
    file_name text NOT NULL,
    checksum text,
    byte_size bigint,
    source text NOT NULL,
    code text NOT NULL,
    message text NOT NULL,
    parser_key text,
    target jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by_user_id text,
    resolved_run_id uuid,
    CONSTRAINT intake_failures_pkey PRIMARY KEY (id),
    CONSTRAINT chk_intake_failures_source CHECK (source = ANY (ARRAY['agent'::text, 'upload'::text])),
    CONSTRAINT chk_intake_failures_status CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])),
    CONSTRAINT chk_intake_failures_code CHECK (length(btrim(code)) BETWEEN 1 AND 100),
    CONSTRAINT chk_intake_failures_message CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
    CONSTRAINT chk_intake_failures_file_name CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_intake_failures_resolved CHECK ((status = 'open') = (resolved_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE api.intake_failures OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.intake_failures
    ADD CONSTRAINT intake_failures_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.intake_failures
    ADD CONSTRAINT intake_failures_connector_id_fk FOREIGN KEY (connector_id) REFERENCES api.connectors(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.intake_failures
    ADD CONSTRAINT intake_failures_instrument_id_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY api.intake_failures
    ADD CONSTRAINT intake_failures_connector_run_id_fk FOREIGN KEY (connector_run_id) REFERENCES api.connector_runs(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_intake_failures_open_file ON api.intake_failures USING btree (connector_id, checksum) WHERE status = 'open' AND checksum IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_intake_failures_workspace ON api.intake_failures USING btree (workspace_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_intake_failures_instrument ON api.intake_failures USING btree (instrument_id) WHERE instrument_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.intake_failures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY intake_failures_select ON api.intake_failures FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.intake_failures TO authenticated;
--> statement-breakpoint
-- Records that a file could not be read. Sending the same file again while the
-- problem is open adds an attempt to it instead of a second row.
CREATE FUNCTION api.record_intake_failure(p_workspace_id uuid, p_connector_id uuid, p_file_name text, p_source text, p_code text, p_message text, p_file_record_id uuid DEFAULT NULL::uuid, p_checksum text DEFAULT NULL::text, p_byte_size bigint DEFAULT NULL::bigint, p_parser_key text DEFAULT NULL::text, p_target jsonb DEFAULT '{}'::jsonb, p_connector_run_id uuid DEFAULT NULL::uuid) RETURNS api.intake_failures
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.connectors;
  v_instrument uuid;
  v api.intake_failures;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to record an intake problem' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM api.connectors WHERE id = p_connector_id AND workspace_id = p_workspace_id;
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'connector not found' USING ERRCODE = 'SB106';
  END IF;
  BEGIN
    v_instrument := nullif(c.config->'pickup'->>'instrumentId', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_instrument := NULL;
  END;
  IF v_instrument IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM api.instruments WHERE id = v_instrument AND workspace_id = p_workspace_id) THEN
    v_instrument := NULL;
  END IF;
  IF p_checksum IS NOT NULL THEN
    UPDATE api.intake_failures SET
        attempts = attempts + 1, code = left(btrim(p_code), 100), message = left(btrim(p_message), 2000),
        connector_run_id = coalesce(p_connector_run_id, connector_run_id),
        parser_key = p_parser_key, target = CASE WHEN p_target = '{}'::jsonb THEN target ELSE p_target END,
        file_record_id = coalesce(p_file_record_id, file_record_id),
        last_attempt_at = now(), updated_at = now()
      WHERE connector_id = c.id AND checksum = p_checksum AND status = 'open'
      RETURNING * INTO v;
    IF v.id IS NOT NULL THEN RETURN v; END IF;
  END IF;
  INSERT INTO api.intake_failures
      (workspace_id, connector_id, instrument_id, connector_run_id, file_record_id, file_name, checksum, byte_size,
       source, code, message, parser_key, target)
    VALUES (p_workspace_id, c.id, v_instrument, p_connector_run_id, p_file_record_id, left(btrim(p_file_name), 200),
            p_checksum, p_byte_size, p_source, left(btrim(p_code), 100), left(btrim(p_message), 2000),
            p_parser_key, coalesce(p_target, '{}'::jsonb))
    RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_intake_failure(p_workspace_id uuid, p_connector_id uuid, p_file_name text, p_source text, p_code text, p_message text, p_file_record_id uuid, p_checksum text, p_byte_size bigint, p_parser_key text, p_target jsonb, p_connector_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_intake_failure(p_workspace_id uuid, p_connector_id uuid, p_file_name text, p_source text, p_code text, p_message text, p_file_record_id uuid, p_checksum text, p_byte_size bigint, p_parser_key text, p_target jsonb, p_connector_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_intake_failure(p_workspace_id uuid, p_connector_id uuid, p_file_name text, p_source text, p_code text, p_message text, p_file_record_id uuid, p_checksum text, p_byte_size bigint, p_parser_key text, p_target jsonb, p_connector_run_id uuid) TO authenticated;
--> statement-breakpoint
-- Closes an intake problem: it was read (resolved) or someone set it aside
-- (dismissed). Resolving by file closes whatever is open for the same file on
-- the connector, so a file that is later sent again and read clears its problem.
CREATE FUNCTION api.resolve_intake_failure(p_failure_id uuid, p_resolution text, p_run_id uuid DEFAULT NULL::uuid) RETURNS api.intake_failures
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.intake_failures;
BEGIN
  IF p_resolution NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'invalid resolution' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.intake_failures
    WHERE id = p_failure_id AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id) AND api.has_write_actor() FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'intake problem not found' USING ERRCODE = 'SB106';
  END IF;
  IF v.status <> 'open' THEN RETURN v; END IF;
  UPDATE api.intake_failures SET status = p_resolution, resolved_at = now(), resolved_run_id = p_run_id,
      resolved_by_user_id = api.current_user_id(), updated_at = now()
    WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.resolve_intake_failure(p_failure_id uuid, p_resolution text, p_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.resolve_intake_failure(p_failure_id uuid, p_resolution text, p_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.resolve_intake_failure(p_failure_id uuid, p_resolution text, p_run_id uuid) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.resolve_intake_failures_for_file(p_connector_id uuid, p_checksum text, p_run_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT api.is_workspace_writer(api.current_workspace_id()) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to close an intake problem' USING ERRCODE = '42501';
  END IF;
  UPDATE api.intake_failures SET status = 'resolved', resolved_at = now(), resolved_run_id = p_run_id,
      resolved_by_user_id = api.current_user_id(), updated_at = now()
    WHERE connector_id = p_connector_id AND checksum = p_checksum AND status = 'open'
      AND workspace_id = api.current_workspace_id();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.resolve_intake_failures_for_file(p_connector_id uuid, p_checksum text, p_run_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.resolve_intake_failures_for_file(p_connector_id uuid, p_checksum text, p_run_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.resolve_intake_failures_for_file(p_connector_id uuid, p_checksum text, p_run_id uuid) TO authenticated;
