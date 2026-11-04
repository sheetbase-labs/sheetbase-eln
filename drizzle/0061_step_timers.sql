-- Step timers: start a countdown from a protocol or notebook step that has a
-- duration, and be told when it ends.
--
-- The timer lives in the database, not in the page, so it keeps running while
-- the person switches tabs, locks their phone or opens the same experiment on
-- another device. It is a fixed end time (`ends_at`), never a ticking counter,
-- so every device agrees on how long is left. A timer is personal: only the
-- person who started it sees it.
--
-- A timer that has passed `ends_at` and is still `running` is finished and
-- waiting to be dismissed. The server also writes a bell notification when it
-- ends (internal.sweep_step_timers), for when no page is open to alert.

CREATE TABLE api.step_timers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    record_id uuid NOT NULL,
    block_id uuid NOT NULL,
    label text NOT NULL,
    duration_seconds integer NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    -- running: counting down, or finished and not yet dismissed.
    -- cancelled: stopped before it ended. dismissed: acknowledged after it ended.
    status text DEFAULT 'running' NOT NULL,
    notified_at timestamp with time zone,
    closed_at timestamp with time zone,
    CONSTRAINT step_timers_pkey PRIMARY KEY (id),
    CONSTRAINT step_timers_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT step_timers_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT step_timers_block_fk FOREIGN KEY (block_id) REFERENCES api.blocks(id) ON DELETE CASCADE,
    CONSTRAINT chk_step_timers_status CHECK (status IN ('running', 'cancelled', 'dismissed')),
    -- Up to a week: a step longer than that is not a bench timer.
    CONSTRAINT chk_step_timers_duration CHECK (duration_seconds BETWEEN 1 AND 604800),
    CONSTRAINT chk_step_timers_label CHECK (char_length(btrim(label)) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE api.step_timers OWNER TO migrator;
--> statement-breakpoint
-- One live timer per person per step; starting again replaces it.
CREATE UNIQUE INDEX uq_step_timers_running ON api.step_timers (user_id, block_id) WHERE status = 'running';
--> statement-breakpoint
CREATE INDEX idx_step_timers_due ON api.step_timers (ends_at) WHERE status = 'running' AND notified_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_step_timers_record ON api.step_timers (record_id);
--> statement-breakpoint
ALTER TABLE api.step_timers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY step_timers_select ON api.step_timers FOR SELECT TO authenticated
    USING (user_id = api.current_user_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.step_timers TO authenticated;
--> statement-breakpoint

-- The timers the caller has running or finished-and-waiting, with the server's
-- clock beside them so a phone with the wrong time still alerts at the right moment.
CREATE VIEW api.my_step_timers WITH (security_invoker = 'true') AS
 SELECT id, record_id, block_id, label, duration_seconds, started_at, ends_at, now() AS server_now
   FROM api.step_timers
  WHERE status = 'running';
--> statement-breakpoint
ALTER VIEW api.my_step_timers OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE api.my_step_timers TO authenticated;
--> statement-breakpoint

-- Start a timer on a step. With no length given it uses the step's own duration.
CREATE FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer DEFAULT NULL) RETURNS api.step_timers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  v_block api.blocks;
  v_record api.records;
  v_seconds integer;
  v_label text;
  v_timer api.step_timers;
BEGIN
  IF v_workspace_id IS NULL OR v_user IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id;
  IF v_block.id IS NULL OR v_block.type <> 'procedure_step' THEN
    RAISE EXCEPTION 'timers start from a procedure step' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_record FROM api.records
   WHERE id = v_block.record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_record.id IS NULL OR NOT internal.can_access_object('record', v_record.id, 'view') THEN
    RAISE EXCEPTION 'step not found' USING ERRCODE = '42501';
  END IF;
  v_seconds := coalesce(p_seconds,
    CASE WHEN (v_block.payload->>'durationSeconds') ~ '^[0-9]+$'
         THEN (v_block.payload->>'durationSeconds')::integer END);
  IF v_seconds IS NULL OR v_seconds < 1 OR v_seconds > 604800 THEN
    RAISE EXCEPTION 'this step has no duration to time' USING ERRCODE = '22023';
  END IF;
  v_label := left(btrim(coalesce(v_block.payload->>'text', '')), 200);
  IF v_label = '' THEN v_label := v_record.title; END IF;

  UPDATE api.step_timers SET status = 'cancelled', closed_at = now()
   WHERE user_id = v_user AND block_id = p_block_id AND status = 'running';
  INSERT INTO api.step_timers
    (workspace_id, user_id, record_id, block_id, label, duration_seconds, started_at, ends_at)
  VALUES (v_workspace_id, v_user, v_record.id, p_block_id, v_label, v_seconds,
          now(), now() + make_interval(secs => v_seconds))
  RETURNING * INTO v_timer;
  RETURN v_timer;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_step_timer(p_block_id uuid, p_seconds integer) TO authenticated;
--> statement-breakpoint

-- Stop a timer that is still counting, or dismiss one that has finished.
CREATE FUNCTION api.end_step_timer(p_timer_id uuid) RETURNS api.step_timers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_timer api.step_timers;
BEGIN
  UPDATE api.step_timers
     SET status = CASE WHEN ends_at <= now() THEN 'dismissed' ELSE 'cancelled' END,
         closed_at = now()
   WHERE id = p_timer_id AND user_id = api.current_user_id() AND status = 'running'
  RETURNING * INTO v_timer;
  IF v_timer.id IS NULL THEN
    SELECT * INTO v_timer FROM api.step_timers
     WHERE id = p_timer_id AND user_id = api.current_user_id();
    IF v_timer.id IS NULL THEN
      RAISE EXCEPTION 'timer not found' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_timer;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.end_step_timer(p_timer_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.end_step_timer(p_timer_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.end_step_timer(p_timer_id uuid) TO authenticated;
--> statement-breakpoint

-- The bell entry for a timer that has ended. Run by the server's scheduler, so
-- someone with no page open still finds it waiting. Returns how many it wrote.
CREATE FUNCTION internal.sweep_step_timers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_timer api.step_timers;
  v_count integer := 0;
BEGIN
  FOR v_timer IN
    SELECT * FROM api.step_timers
     WHERE status = 'running' AND notified_at IS NULL AND ends_at <= now()
     ORDER BY ends_at
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE api.step_timers SET notified_at = now() WHERE id = v_timer.id;
    IF internal.notification_recipient_enabled(v_timer.user_id, 'step_timer') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id)
      VALUES (v_timer.workspace_id, v_timer.user_id, 'step_timer',
              'Timer finished', v_timer.label, v_timer.record_id);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sweep_step_timers() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sweep_step_timers() FROM PUBLIC;
--> statement-breakpoint

-- A step timer is a bell notification; email is off unless someone asks for it.
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('step_timer', 'notification', ARRAY[]::text[], false);
