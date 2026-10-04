-- DSET-05.3 — the browser saves a parser's default mapping through the
-- same-origin /api/db boundary, which does not accept a workspace id from the
-- client (the JWT already scopes it). `api.save_parser_mapping` still required
-- `p_workspace_id`, so PostgREST could not resolve the call
-- ("Could not find the function api.save_parser_mapping(p_mapping, p_parser_id,
-- p_target_key) in the schema cache") and the Map step failed before review.
-- Derive the workspace from the session instead; the 4-argument overload is
-- dropped so only one signature remains.
DROP FUNCTION IF EXISTS api.save_parser_mapping(uuid, uuid, text, jsonb);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.save_parser_mapping(
  p_parser_id uuid,
  p_target_key text,
  p_mapping jsonb
) RETURNS api.parser_mappings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
  v api.parser_mappings;
BEGIN
  v_workspace_id := api.current_workspace_id();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no workspace in session' USING ERRCODE = 'SB105';
  END IF;
  IF NOT api.is_workspace_writer(v_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'not permitted to save a mapping' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.parsers p WHERE p.id = p_parser_id AND p.workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'parser not found' USING ERRCODE = 'SB106';
  END IF;
  IF p_target_key IS NULL OR length(btrim(p_target_key)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a mapping target is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.parser_mappings (workspace_id, parser_id, target_key, mapping, is_default, created_by_user_id)
  VALUES (v_workspace_id, p_parser_id, btrim(p_target_key), coalesce(p_mapping, '{}'::jsonb), true, api.current_user_id())
  ON CONFLICT (workspace_id, parser_id, target_key) WHERE is_default
  DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_parser_mapping(uuid, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_parser_mapping(uuid, text, jsonb) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
