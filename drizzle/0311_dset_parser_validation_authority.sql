-- Retained-file validation is written only by the claims-bound application
-- server, after executing the actual parser against independently read bytes.
CREATE FUNCTION internal.record_parser_import_failure(p_file_id uuid, p_parser_version_id uuid, p_code text, p_message text)
RETURNS api.dataset_import_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f api.dataset_import_files;
BEGIN
  SELECT * INTO f FROM api.dataset_import_files WHERE id = p_file_id
    AND workspace_id = api.current_workspace_id() AND api.is_workspace_writer(workspace_id)
    AND api.has_write_actor() FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'import file denied' USING ERRCODE = '42501'; END IF;
  IF p_parser_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.parser_versions
    WHERE id = p_parser_version_id AND workspace_id = f.workspace_id) THEN
    RAISE EXCEPTION 'parser version not found' USING ERRCODE = 'SB106'; END IF;
  IF p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 1 AND 100 OR
     p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'bounded failure code and message required' USING ERRCODE = '22023'; END IF;
  UPDATE api.dataset_import_files SET parser_failure = jsonb_build_object(
    'parserVersionId', p_parser_version_id, 'code', p_code, 'message', p_message,
    'failedAt', now(), 'actorUserId', api.current_user_id())
    || CASE WHEN f.parser_failure ? 'requestedAt' THEN jsonb_build_object(
      'requestedAt', f.parser_failure->'requestedAt', 'requestedByUserId', f.parser_failure->'requestedByUserId') ELSE '{}'::jsonb END,
    updated_at = now() WHERE id = f.id RETURNING * INTO f;
  RETURN f;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_parser_import_failure(uuid, uuid, text, text) FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_parser_import_failure(uuid, uuid, text, text) TO service_role;
--> statement-breakpoint
CREATE FUNCTION internal.record_parser_validation(p_parser_version_id uuid, p_file_id uuid, p_checksum text, p_definition jsonb, p_result jsonb)
RETURNS api.parser_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v api.parser_versions; f api.dataset_import_files;
BEGIN
  SELECT * INTO v FROM api.parser_versions WHERE id = p_parser_version_id AND workspace_id = api.current_workspace_id()
    AND api.has_capability(workspace_id, 'schema.edit') AND api.has_write_actor() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'parser configuration denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM api.dataset_import_files WHERE id = p_file_id AND workspace_id = v.workspace_id FOR SHARE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'test file not found' USING ERRCODE = 'SB106'; END IF;
  IF v.status NOT IN ('draft', 'validated') OR f.checksum IS DISTINCT FROM p_checksum OR
     p_definition IS DISTINCT FROM jsonb_build_object('signature', v.signature, 'mapping', v.mapping) OR
     p_result->>'fileId' IS DISTINCT FROM f.id::text OR p_result->>'checksum' IS DISTINCT FROM f.checksum OR
     jsonb_typeof(p_result->'ok') IS DISTINCT FROM 'boolean' OR
     jsonb_typeof(p_result->'errors') IS DISTINCT FROM 'array' OR
     jsonb_typeof(p_result->'rowCount') IS DISTINCT FROM 'number' OR
     ((p_result->>'ok')::boolean AND ((p_result->>'rowCount')::integer < 1 OR jsonb_array_length(p_result->'errors') <> 0)) OR
     NOT EXISTS (SELECT 1 FROM api.parsers WHERE id = v.parser_id AND format = f.format) THEN
    RAISE EXCEPTION 'validation evidence is stale or does not match the retained file' USING ERRCODE = '22023'; END IF;
  UPDATE api.parser_versions SET status = CASE WHEN (p_result->>'ok')::boolean THEN 'validated' ELSE 'draft' END,
    test_result = p_result || jsonb_build_object('definition', p_definition, 'validatedByUserId', api.current_user_id()),
    validated_at = now(), updated_at = now() WHERE id = v.id RETURNING * INTO v;
  IF (p_result->>'ok')::boolean THEN
    UPDATE api.dataset_import_files SET parser_failure = NULL, updated_at = now() WHERE id = f.id
      AND (parser_failure->>'parserVersionId' IS NULL OR parser_failure->>'parserVersionId' = v.id::text);
  ELSE
    PERFORM internal.record_parser_import_failure(f.id, v.id, 'validation_failed', 'Retained test file did not pass parser validation');
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_parser_validation(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, authenticated, api_client, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.record_parser_validation(uuid, uuid, text, jsonb, jsonb) TO service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.approve_parser_version(p_parser_version_id uuid)
RETURNS api.parser_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v api.parser_versions; f api.dataset_import_files;
BEGIN
  SELECT * INTO v FROM api.parser_versions WHERE id = p_parser_version_id AND workspace_id = api.current_workspace_id()
    AND api.is_workspace_writer(workspace_id) AND api.has_write_actor() FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'parser version not found' USING ERRCODE = 'SB106'; END IF;
  IF NOT api.has_capability(v.workspace_id, 'schema.publish') THEN
    RAISE EXCEPTION 'not permitted to approve a parser' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM api.dataset_import_files WHERE id::text = v.test_result->>'fileId' AND workspace_id = v.workspace_id FOR SHARE;
  IF v.status <> 'validated' OR v.validated_at IS NULL OR v.test_result->>'ok' IS DISTINCT FROM 'true' OR
     f.id IS NULL OR f.checksum IS DISTINCT FROM v.test_result->>'checksum' OR
     v.test_result->'definition' IS DISTINCT FROM jsonb_build_object('signature', v.signature, 'mapping', v.mapping) THEN
    RAISE EXCEPTION 'successful matching retained-file validation required before approval' USING ERRCODE = '22023'; END IF;
  UPDATE api.parser_versions SET status = 'approved', approved_at = now(), approved_by_user_id = api.current_user_id(),
    updated_at = now() WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
-- Retain the existing registration signature for callers, but never its old
-- privileged non-draft registration bypass. Ensuring never rewrites a version.
CREATE OR REPLACE FUNCTION api.ensure_parser(p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer,
  p_signature jsonb, p_mapping jsonb DEFAULT '{}'::jsonb, p_instrument_id uuid DEFAULT NULL, p_status text DEFAULT 'draft')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p api.parsers; v api.parser_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105'; END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to register a parser' USING ERRCODE = '42501'; END IF;
  IF p_status IS DISTINCT FROM 'draft' OR p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'registration must start with a draft and positive version' USING ERRCODE = '22023'; END IF;
  IF p_instrument_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.instruments WHERE id = p_instrument_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'instrument not found' USING ERRCODE = 'SB106'; END IF;
  INSERT INTO api.parsers (workspace_id, key, name, format, instrument_id, created_by_user_id)
    VALUES (p_workspace_id, btrim(p_key), btrim(p_name), p_format, p_instrument_id, api.current_user_id())
    ON CONFLICT (workspace_id, key) DO UPDATE SET updated_at = api.parsers.updated_at RETURNING * INTO p;
  IF p.format <> p_format THEN RAISE EXCEPTION 'parser format mismatch' USING ERRCODE = 'SB107'; END IF;
  INSERT INTO api.parser_versions (workspace_id, parser_id, version, status, signature, mapping, created_by_user_id)
    VALUES (p_workspace_id, p.id, p_version, 'draft', coalesce(p_signature, '{}'), coalesce(p_mapping, '{}'), api.current_user_id())
    ON CONFLICT (parser_id, version) DO UPDATE SET updated_at = api.parser_versions.updated_at RETURNING * INTO v;
  RETURN jsonb_build_object('parserId', p.id, 'parserVersionId', v.id, 'version', v.version, 'status', v.status);
END $$;
--> statement-breakpoint
CREATE FUNCTION api.request_parser_update(p_file_id uuid)
RETURNS api.dataset_import_files LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f api.dataset_import_files;
BEGIN
  SELECT * INTO f FROM api.dataset_import_files WHERE id = p_file_id AND workspace_id = api.current_workspace_id()
    AND api.is_workspace_writer(workspace_id) AND api.has_write_actor() FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'import file denied' USING ERRCODE = '42501'; END IF;
  IF f.parser_failure IS NULL THEN RAISE EXCEPTION 'an authoritative parser failure is required' USING ERRCODE = '22023'; END IF;
  UPDATE api.dataset_import_files SET parser_failure = parser_failure || jsonb_build_object(
    'requestedAt', now(), 'requestedByUserId', api.current_user_id()), updated_at = now() WHERE id = f.id RETURNING * INTO f;
  RETURN f;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_parser_update(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.request_parser_update(uuid) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION internal.resolve_committed_parser_failure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'committed' AND NEW.file_id IS NOT NULL THEN
    UPDATE api.dataset_import_files SET parser_failure = NULL, updated_at = now() WHERE id = NEW.file_id AND workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.resolve_committed_parser_failure() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER resolve_committed_parser_failure AFTER INSERT ON api.dataset_imports
  FOR EACH ROW EXECUTE FUNCTION internal.resolve_committed_parser_failure();
--> statement-breakpoint
-- Add source identities without replacing WORK-01's existing role- and
-- recipient-filtered derivations. PostgreSQL retains its invoker security.
DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass, true), E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker = true) AS
    SELECT old.*, NULL::text AS source_type, NULL::uuid AS source_id, NULL::uuid AS parser_version_id
    FROM (' || previous || ') old
    UNION ALL
    SELECT ''data_issue''::text, NULL::uuid, f.filename, ''Parser failure: '' || f.filename, d.primary_project_id,
      f.parser_failure->>''message'', NULL::timestamptz, ''needs_action''::text,
      (f.parser_failure->>''failedAt'')::timestamptz,
      ''dataset_import_file''::text, f.id, (f.parser_failure->>''parserVersionId'')::uuid
    FROM api.dataset_import_files f LEFT JOIN api.datasets d ON d.id = f.dataset_id
    WHERE f.parser_failure IS NOT NULL AND f.workspace_id = api.current_workspace_id()
      AND EXISTS (SELECT 1 FROM api.workspace_memberships wm WHERE wm.workspace_id = f.workspace_id
        AND wm.user_id = api.current_user_id() AND wm.suspended_at IS NULL
        AND (wm.role IN (''owner'', ''admin'', ''steward'') OR wm.user_id = f.created_by_user_id))';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
