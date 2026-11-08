-- A plugin can ask for any scope an API token can hold, so a screen can use the
-- same lab actions and reads the assistant, the API and agents have. The
-- manifest check stopped at agent_operations:*; it now takes the whole list
-- (see VALID_SCOPES in src/lib/api-credential-scopes.ts).
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef('internal.validate_extension_manifest(jsonb)'::regprocedure);
  v_old text := '''agent_operations:read'', ''agent_operations:write''';
  v_new text := '''agent_operations:read'', ''agent_operations:write'',
      ''pipelines:read'', ''pipelines:write'',
      ''lab:read'', ''lab:write'',
      ''facility:read'', ''facility:write'',
      ''admin:read'', ''admin:write'',
      ''people:read'', ''people:write''';
BEGIN
  IF position('''lab:write''' IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
