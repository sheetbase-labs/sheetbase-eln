-- A sheet can be renamed without touching its state. The name was fixed at
-- creation; this changes only the name, bumps the revision (so an open editor
-- sees the change) and is refused for archived sheets and non-writers.
CREATE OR REPLACE FUNCTION "api"."rename_sheet_instance"(
  p_instance_id uuid,
  p_expected_revision bigint,
  p_name text
) RETURNS "api"."sheet_instances"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row api.sheet_instances;
  v_name text := btrim(coalesce(p_name, ''));
BEGIN
  SELECT * INTO v_row FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF v_row.id IS NULL OR NOT api.is_workspace_member(v_row.workspace_id)
    OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
  END IF;
  IF v_row.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'Sheet Instance is archived' USING ERRCODE = 'SB073';
  END IF;
  IF v_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'Sheet Instance revision conflict' USING ERRCODE = 'SB073';
  END IF;
  IF length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid Sheet Instance name' USING ERRCODE = 'SB073';
  END IF;
  IF v_name = v_row.name THEN
    RETURN v_row;
  END IF;
  PERFORM set_config('sheetbase.sheet_instance_write', 'rpc-v1', true);
  UPDATE api.sheet_instances
     SET name = v_name, revision = revision + 1, updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."rename_sheet_instance"(uuid, bigint, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."rename_sheet_instance"(uuid, bigint, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
