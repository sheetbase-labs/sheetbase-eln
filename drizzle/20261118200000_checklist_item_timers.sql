-- Timers on checklist items: a checklist item can carry its own countdown,
-- started from the item row in the notebook, beside the existing timers on
-- procedure steps. A timer on an item is identified by the block plus the
-- item's id (stored in the checklist payload).

ALTER TABLE api.step_timers ADD COLUMN item_id text;
--> statement-breakpoint
ALTER TABLE api.step_timers ADD CONSTRAINT chk_step_timers_item_id CHECK (item_id IS NULL OR char_length(item_id) BETWEEN 1 AND 100);
--> statement-breakpoint
DROP INDEX api.uq_step_timers_running;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_step_timers_running ON api.step_timers (user_id, block_id, coalesce(item_id, '')) WHERE status = 'running';
--> statement-breakpoint

DROP VIEW api.my_step_timers;
--> statement-breakpoint
CREATE VIEW api.my_step_timers WITH (security_invoker = 'true') AS
 SELECT id, record_id, block_id, item_id, label, duration_seconds, started_at, ends_at, now() AS server_now
   FROM api.step_timers
  WHERE status = 'running';
--> statement-breakpoint
ALTER VIEW api.my_step_timers OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE api.my_step_timers TO authenticated;
--> statement-breakpoint

DROP FUNCTION api.start_step_timer(uuid, integer);
--> statement-breakpoint
-- Start a timer on a procedure step, or on one item of a checklist (p_item_id).
-- With no length given it uses the step's, or the item's, own duration.
CREATE FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer DEFAULT NULL, p_item_id text DEFAULT NULL) RETURNS api.step_timers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_block api.blocks;
  v_record api.records;
  v_item jsonb;
  v_seconds integer;
  v_label text;
  v_timer api.step_timers;
BEGIN
  IF v_workspace_id IS NULL OR v_user IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id;
  IF v_block.id IS NULL OR v_block.type NOT IN ('procedure_step', 'checklist') THEN
    RAISE EXCEPTION 'timers start from a procedure step or a checklist item' USING ERRCODE = '22023';
  END IF;
  IF (v_block.type = 'checklist') <> (p_item_id IS NOT NULL) THEN
    RAISE EXCEPTION 'a checklist timer needs an item, and a step timer takes none' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_record FROM api.records
   WHERE id = v_block.record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_record.id IS NULL OR NOT internal.can_access_object('record', v_record.id, 'view') THEN
    RAISE EXCEPTION 'step not found' USING ERRCODE = '42501';
  END IF;
  IF p_item_id IS NOT NULL THEN
    SELECT e INTO v_item
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_block.payload->'items') = 'array'
                                     THEN v_block.payload->'items' ELSE '[]'::jsonb END) AS e
     WHERE e->>'id' = p_item_id
     LIMIT 1;
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'checklist item not found' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_seconds := coalesce(p_seconds,
    CASE WHEN (coalesce(v_item, v_block.payload)->>'durationSeconds') ~ '^[0-9]+$'
         THEN (coalesce(v_item, v_block.payload)->>'durationSeconds')::integer END);
  IF v_seconds IS NULL OR v_seconds < 1 OR v_seconds > 604800 THEN
    RAISE EXCEPTION 'this step has no duration to time' USING ERRCODE = '22023';
  END IF;
  v_label := left(btrim(coalesce(v_item->>'text', v_block.payload->>'text', '')), 200);
  IF v_label = '' THEN v_label := v_record.title; END IF;

  UPDATE api.step_timers SET status = 'cancelled', closed_at = now()
   WHERE user_id = v_user AND block_id = p_block_id AND coalesce(item_id, '') = coalesce(p_item_id, '')
     AND status = 'running';
  INSERT INTO api.step_timers
    (workspace_id, user_id, record_id, block_id, item_id, label, duration_seconds, started_at, ends_at)
  VALUES (v_workspace_id, v_user, v_record.id, p_block_id, p_item_id, v_label, v_seconds,
          now(), now() + make_interval(secs => v_seconds))
  RETURNING * INTO v_timer;
  RETURN v_timer;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer, p_item_id text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer, p_item_id text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer, p_item_id text) TO authenticated;
