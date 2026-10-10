-- WORK-01.3 — follow and unfollow a record in the Inbox work list.
--
-- Only the follow is stored; the work item itself is derived from canonical
-- state by `api.my_work_items`. Writes go exclusively through the
-- `follow_record` / `unfollow_record` SECURITY DEFINER RPCs so the user is
-- always the request actor; the browser reads rows back under RLS for the row
-- owner only.

CREATE OR REPLACE FUNCTION api.follow_record(p_record_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v_workspace_id uuid;
  v_created_at timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'follow_record requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  SELECT r.workspace_id INTO v_workspace_id
    FROM api.records r
    WHERE r.id = p_record_id AND r.deleted_at IS NULL;
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.work_item_follows (workspace_id, user_id, record_id, created_at)
  VALUES (v_workspace_id, v_user_id, p_record_id, now())
  -- Re-following keeps the original follow time so it does not jump the list.
  ON CONFLICT (user_id, record_id)
  DO UPDATE SET workspace_id = EXCLUDED.workspace_id
  RETURNING created_at INTO v_created_at;
  RETURN v_created_at;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.follow_record(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.follow_record(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.unfollow_record(p_record_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id text := api.current_user_id();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unfollow_record requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  -- The user predicate makes this caller-scoped only: a record that has since
  -- been deleted, or whose workspace the caller left, can still be unfollowed.
  DELETE FROM api.work_item_follows
  WHERE user_id = v_user_id AND record_id = p_record_id;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.unfollow_record(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.unfollow_record(uuid) TO authenticated;
--> statement-breakpoint

REVOKE ALL ON api.work_item_follows FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.work_item_follows TO authenticated;
--> statement-breakpoint
ALTER TABLE api.work_item_follows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY work_item_follows_select ON api.work_item_follows
  FOR SELECT TO authenticated
  USING (
    user_id = api.current_user_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
