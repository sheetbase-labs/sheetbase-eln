-- Authored versions obey the same workspace/instrument and stable reader-format
-- contract as shipped-parser registration. The old RPC accepted a foreign
-- instrument and silently ignored a conflicting format on an existing key.
CREATE OR REPLACE FUNCTION api.create_parser_version(
  p_workspace_id uuid, p_key text, p_name text, p_format text, p_version integer,
  p_signature jsonb, p_mapping jsonb DEFAULT '{}'::jsonb, p_instrument_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p api.parsers; v api.parser_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB105'; END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to create a parser' USING ERRCODE = '42501'; END IF;
  IF p_version IS NULL OR p_version < 1 THEN
    RAISE EXCEPTION 'a positive parser version is required' USING ERRCODE = '22023'; END IF;
  IF p_instrument_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM api.instruments WHERE id = p_instrument_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'instrument not found' USING ERRCODE = 'SB106'; END IF;
  INSERT INTO api.parsers (workspace_id, key, name, format, instrument_id, created_by_user_id)
    VALUES (p_workspace_id, btrim(p_key), btrim(p_name), p_format, p_instrument_id, api.current_user_id())
    ON CONFLICT (workspace_id, key) DO UPDATE SET name = EXCLUDED.name, updated_at = now() RETURNING * INTO p;
  IF p.format <> p_format THEN RAISE EXCEPTION 'parser format mismatch; use a new parser key' USING ERRCODE = 'SB107'; END IF;
  IF p.instrument_id IS DISTINCT FROM p_instrument_id THEN
    RAISE EXCEPTION 'parser instrument mismatch; use a new parser key' USING ERRCODE = 'SB107'; END IF;
  INSERT INTO api.parser_versions (workspace_id, parser_id, version, status, signature, mapping, created_by_user_id)
    VALUES (p_workspace_id, p.id, p_version, 'draft', coalesce(p_signature, '{}'), coalesce(p_mapping, '{}'), api.current_user_id()) RETURNING * INTO v;
  RETURN jsonb_build_object('parserId', p.id, 'parserVersionId', v.id, 'version', v.version, 'status', v.status);
END $$;
--> statement-breakpoint
-- Approving a corrected version against the same retained failing file is
-- authoritative remediation of that parser's failure, not a client status flip.
CREATE FUNCTION internal.resolve_approved_parser_failure() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.test_result->>'ok' = 'true' THEN
    UPDATE api.dataset_import_files f SET parser_failure = NULL, updated_at = now()
      WHERE f.id::text = NEW.test_result->>'fileId' AND f.workspace_id = NEW.workspace_id
        AND f.checksum = NEW.test_result->>'checksum' AND f.parser_failure IS NOT NULL
        AND (f.parser_failure->>'parserVersionId' IS NULL OR EXISTS (SELECT 1 FROM api.parser_versions previous
          WHERE previous.id::text = f.parser_failure->>'parserVersionId' AND previous.parser_id = NEW.parser_id
            AND previous.workspace_id = NEW.workspace_id));
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.resolve_approved_parser_failure() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER resolve_approved_parser_failure AFTER UPDATE OF status ON api.parser_versions
  FOR EACH ROW EXECUTE FUNCTION internal.resolve_approved_parser_failure();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
