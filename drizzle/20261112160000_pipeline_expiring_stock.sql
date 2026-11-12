-- A pipeline can read materials: "list the stock that expires within N days" leaves one
-- Inbox item for a person, with a line for each lot. Nothing is left when nothing expires.

CREATE FUNCTION api.list_expiring_materials(
  p_workspace_id uuid, p_user_id text, p_days integer DEFAULT 30
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_count integer;
  v_lines text;
  v_item api.pipeline_inbox_items;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'expiring stock denied' USING ERRCODE = '42501';
  END IF;
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'days must be between 1 and 365' USING ERRCODE = '22023';
  END IF;

  WITH expiring AS (
    SELECT r.identifier, r.title, r.properties->>'lot' AS lot,
           (r.properties->>'expiry')::date AS expiry
      FROM api.records r
     WHERE r.workspace_id = p_workspace_id
       AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed', 'depleted')
       AND (r.properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
       AND (r.properties->>'expiry')::date <= current_date + p_days
     ORDER BY (r.properties->>'expiry')::date, r.identifier
  )
  SELECT count(*),
         string_agg(identifier || ' ' || title || ' (lot ' || coalesce(lot, 'none') || ') expires ' || expiry::text,
                    E'\n') FILTER (WHERE true)
    INTO v_count, v_lines
    FROM (SELECT * FROM expiring LIMIT 50) shown;

  SELECT count(*) INTO v_count FROM api.records r
   WHERE r.workspace_id = p_workspace_id
     AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
     AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed', 'depleted')
     AND (r.properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
     AND (r.properties->>'expiry')::date <= current_date + p_days;

  IF v_count = 0 THEN
    RETURN jsonb_build_object('count', 0, 'created', false);
  END IF;

  v_item := api.create_inbox_item(
    p_workspace_id, p_user_id,
    v_count || CASE WHEN v_count = 1 THEN ' material expires' ELSE ' materials expire' END
      || ' within ' || p_days || ' days',
    v_lines);

  RETURN jsonb_build_object('count', v_count, 'created', true, 'inboxItemId', v_item.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.list_expiring_materials(uuid, text, integer) OWNER TO migrator;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_expiring_materials(uuid, text, integer) TO authenticated;
