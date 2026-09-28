-- SET-01.1 — workspace general settings: site, time zone and formats, written
-- through an admin-only RPC.

CREATE OR REPLACE FUNCTION api.update_workspace_general(
  p_workspace_id uuid,
  p_site text DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_date_format text DEFAULT NULL,
  p_number_format text DEFAULT NULL
)
RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = api.current_user_id()
      AND m.suspended_at IS NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_number_format IS NOT NULL
     AND p_number_format NOT IN ('decimal', 'scientific') THEN
    RAISE EXCEPTION 'unknown number format' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, created_by_user_id)
  VALUES (p_workspace_id, api.current_user_id())
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE api.workspace_settings
    SET site = p_site,
        timezone = coalesce(p_timezone, timezone),
        date_format = coalesce(p_date_format, date_format),
        number_format = coalesce(p_number_format, number_format),
        updated_at = now()
    WHERE workspace_id = p_workspace_id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_workspace_general(uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_workspace_general(uuid, text, text, text, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
