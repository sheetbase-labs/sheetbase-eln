-- An instrument's connector can change how its files are read.
--
-- The guided data-intake setup on the instrument page lets someone switch an
-- instrument to another parser, or back to "work it out from each file", after
-- the connector exists. `update_connector` could only rename it, pause it or
-- replace its settings.
DROP FUNCTION api.update_connector(uuid, uuid, text, text, jsonb);
--> statement-breakpoint
CREATE FUNCTION api.update_connector(
  p_workspace_id uuid, p_connector_id uuid, p_name text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text, p_config jsonb DEFAULT NULL::jsonb,
  p_parser_id text DEFAULT NULL::text, p_clear_parser boolean DEFAULT false
) RETURNS api.connectors
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.connectors;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.connectors
   WHERE id = p_connector_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'connector not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'paused', 'archived') THEN
    RAISE EXCEPTION 'invalid connector status' USING ERRCODE = 'SB034';
  END IF;
  IF p_parser_id IS NOT NULL AND (
       v.connector_type <> 'instrument' OR length(btrim(p_parser_id)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'invalid parser identity' USING ERRCODE = 'SB034';
  END IF;
  UPDATE api.connectors SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    status = COALESCE(p_status, status),
    config = COALESCE(p_config, config),
    parser_id = CASE
      WHEN p_clear_parser THEN NULL
      WHEN p_parser_id IS NOT NULL THEN btrim(p_parser_id)
      ELSE parser_id
    END,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_connector_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_connector(p_workspace_id uuid, p_connector_id uuid, p_name text, p_status text, p_config jsonb, p_parser_id text, p_clear_parser boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_connector(p_workspace_id uuid, p_connector_id uuid, p_name text, p_status text, p_config jsonb, p_parser_id text, p_clear_parser boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_connector(p_workspace_id uuid, p_connector_id uuid, p_name text, p_status text, p_config jsonb, p_parser_id text, p_clear_parser boolean) TO authenticated;
