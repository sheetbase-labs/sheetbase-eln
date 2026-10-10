-- EXP-05.3 — raising a cell conflict.
--
-- drizzle/0405 created api.sheet_cell_conflicts and the way to settle one, but nothing
-- could raise one: the table grants only SELECT, and the RPC is the canonical boundary, so
-- the replay cannot insert directly and should not be granted that.
--
-- This is the raise path. It is idempotent on purpose: a replay can run twice (a reconnect
-- racing another tab, a retry after a partial failure), and the second run must find the
-- conflict it already raised rather than failing or creating a duplicate. The unique index
-- on open conflicts is what makes that true, and the function returns the existing row.
--
-- The local side is the caller's own edit, so it must be attributed to the caller: an
-- offline edit is the device's, and letting a client name someone else as its author would
-- make the record of who changed what worthless.

CREATE OR REPLACE FUNCTION api.record_cell_conflict(
  p_instance_id uuid,
  p_row_key text,
  p_field_id uuid,
  p_local_value jsonb,
  p_local_author_user_id text,
  p_local_at timestamptz,
  p_remote_value jsonb DEFAULT NULL,
  p_remote_author_user_id text DEFAULT NULL,
  p_remote_at timestamptz DEFAULT NULL
)
RETURNS api.sheet_cell_conflicts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_instance api.sheet_instances;
  v_existing api.sheet_cell_conflicts;
  v_row api.sheet_cell_conflicts;
  v_actor text := api.current_user_id();
BEGIN
  SELECT * INTO v_instance FROM api.sheet_instances WHERE id = p_instance_id;
  IF v_instance.id IS NULL
     OR v_instance.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Unknown Sheet Instance' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('instance', p_instance_id, 'edit');

  IF p_local_author_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'A conflict must be raised by the person whose edit it is'
      USING ERRCODE = '42501';
  END IF;
  IF p_row_key IS NULL OR length(btrim(p_row_key)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'a row key is required' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: a second replay finds the conflict it already raised.
  SELECT * INTO v_existing
    FROM api.sheet_cell_conflicts
   WHERE sheet_instance_id = p_instance_id
     AND row_key = btrim(p_row_key)
     AND field_id = p_field_id
     AND state = 'open';
  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO api.sheet_cell_conflicts(
    workspace_id, sheet_instance_id, row_key, field_id,
    local_value, local_author_user_id, local_at,
    remote_value, remote_author_user_id, remote_at
  ) VALUES (
    v_instance.workspace_id, p_instance_id, btrim(p_row_key), p_field_id,
    p_local_value, v_actor, coalesce(p_local_at, now()),
    p_remote_value, p_remote_author_user_id, p_remote_at
  ) RETURNING * INTO v_row;

  -- Somebody has to decide; the work item is derived from the open row, so the person
  -- whose edit conflicted sees it without the sheet being open.
  PERFORM internal.emit_change_event(
    v_instance.workspace_id,
    'scientific_row',
    p_instance_id,
    'create',
    NULL,
    NULL,
    jsonb_build_object(
      'conflict', 'cell',
      'conflictId', v_row.id,
      'fieldId', p_field_id,
      'rowKey', v_row.row_key,
      'raisedBy', v_actor
    )
  );

  RETURN v_row;
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.record_cell_conflict(uuid, text, uuid, jsonb, text, timestamptz, jsonb, text, timestamptz) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_cell_conflict(uuid, text, uuid, jsonb, text, timestamptz, jsonb, text, timestamptz) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
