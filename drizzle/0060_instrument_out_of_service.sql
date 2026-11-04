-- Out of service, and a log of repairs and service visits.
--
-- The people who run an instrument can mark it down when it breaks and back in
-- service once it is fixed. While it is down nobody can make a new booking on it
-- (error SB135, the same gate as retired, unqualified and calibration overdue, for
-- single, edited and repeating bookings alike). Everyone who already has a booking
-- on it still ahead is told when it goes down and again when it comes back. Their
-- bookings are left alone: whether to keep or move them is theirs to decide.
--
-- Separately, any instrument keeps a log of repairs and service visits (what was
-- done, when, and by whom). It is append-only. Marking an instrument back in
-- service can record the repair in the same step.
--
-- Who may: the people who can record a calibration (calibration.record), the same
-- people who run the instrument day to day.

ALTER TABLE api.instruments
    ADD COLUMN out_of_service_at timestamp with time zone,
    ADD COLUMN out_of_service_reason text,
    ADD COLUMN out_of_service_by text,
    ADD COLUMN expected_back_on date,
    ADD CONSTRAINT chk_instruments_out_of_service_reason
        CHECK (out_of_service_reason IS NULL OR length(out_of_service_reason) <= 1000);
--> statement-breakpoint

CREATE TABLE api.instrument_service_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    kind text NOT NULL,
    visited_on date NOT NULL,
    summary text NOT NULL,
    details text,
    -- The engineer, company or colleague who did the work, as the lab writes it.
    performed_by text,
    logged_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_service_log_pkey PRIMARY KEY (id),
    CONSTRAINT instrument_service_log_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT instrument_service_log_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT chk_instrument_service_log_kind CHECK (kind IN ('repair', 'service', 'inspection', 'other')),
    CONSTRAINT chk_instrument_service_log_summary CHECK (length(btrim(summary)) BETWEEN 1 AND 300),
    CONSTRAINT chk_instrument_service_log_details CHECK (details IS NULL OR length(details) <= 4000),
    CONSTRAINT chk_instrument_service_log_performed_by CHECK (performed_by IS NULL OR length(performed_by) <= 200)
);
--> statement-breakpoint
ALTER TABLE api.instrument_service_log OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_service_log_instrument ON api.instrument_service_log (instrument_id, visited_on DESC, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.instrument_service_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_service_log_select ON api.instrument_service_log FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_service_log_client_select ON api.instrument_service_log FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_service_log TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_service_log TO api_client;
--> statement-breakpoint

-- The booking gate. Same rules as before, plus out of service.
CREATE OR REPLACE FUNCTION internal.assert_instrument_bookable(p_resource api.calendar_resources) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument "api"."instruments";
  v_latest_due timestamptz;
BEGIN
  IF p_resource.resource_type IS DISTINCT FROM 'instrument' THEN
    RETURN;
  END IF;

  SELECT * INTO v_instrument FROM "api"."instruments"
   WHERE id = p_resource.id
     AND workspace_id = p_resource.workspace_id;
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB021';
  END IF;
  IF v_instrument.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'resource is inactive and cannot be booked' USING ERRCODE = 'SB005';
  END IF;
  IF v_instrument.out_of_service_at IS NOT NULL THEN
    RAISE EXCEPTION 'the instrument is out of service' USING ERRCODE = 'SB135';
  END IF;
  IF NOT "internal"."instrument_qualified"(v_instrument.id, "api"."current_user_id"()) THEN
    RAISE EXCEPTION 'a current qualification is required to book this instrument' USING ERRCODE = 'SB115';
  END IF;

  SELECT c.due_at INTO v_latest_due
    FROM "api"."instrument_calibrations" c
   WHERE c.instrument_id = v_instrument.id
   ORDER BY c.performed_at DESC NULLS LAST, c.created_at DESC
   LIMIT 1;
  IF v_latest_due IS NOT NULL AND v_latest_due < now() THEN
    RAISE EXCEPTION 'the instrument calibration is overdue' USING ERRCODE = 'SB116';
  END IF;
END $$;
--> statement-breakpoint

-- One notification event covers the bell, email and the digest.
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('instrument_service', 'notification', '{}', true);
--> statement-breakpoint

CREATE FUNCTION internal.notify_instrument_service(p_workspace_id uuid, p_recipient text, p_title text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_recipient IS NULL
     OR p_recipient IS NOT DISTINCT FROM api.current_user_id()
     OR NOT internal.notification_recipient_enabled(p_recipient, 'instrument_service') THEN
    RETURN;
  END IF;
  INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body)
  VALUES (p_workspace_id, p_recipient, 'instrument_service', p_title, p_body);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_instrument_service(p_workspace_id uuid, p_recipient text, p_title text, p_body text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_instrument_service(p_workspace_id uuid, p_recipient text, p_title text, p_body text) FROM PUBLIC;
--> statement-breakpoint

-- Tell everyone who has a booking still ahead on the instrument (the person who
-- made it and anyone added to it), once each, naming their first affected booking.
CREATE FUNCTION internal.notify_instrument_bookers(p_instrument api.instruments, p_title text, p_lead text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r record;
  v_body text;
BEGIN
  FOR r IN
    WITH affected AS (
      SELECT b.id, b.title, b.starts_at, b.timezone, b.created_by_user_id AS user_id
        FROM api.calendar_bookings b
       WHERE b.resource_id = p_instrument.id
         AND b.workspace_id = p_instrument.workspace_id
         AND b.status <> 'cancelled'
         AND b.ends_at > now()
      UNION
      SELECT b.id, b.title, b.starts_at, b.timezone, p.user_id
        FROM api.calendar_bookings b
        JOIN api.calendar_booking_participants p ON p.booking_id = b.id
       WHERE b.resource_id = p_instrument.id
         AND b.workspace_id = p_instrument.workspace_id
         AND b.status <> 'cancelled'
         AND b.ends_at > now()
    )
    SELECT a.user_id,
           count(*) AS n,
           (array_agg(a.title ORDER BY a.starts_at))[1] AS first_title,
           (array_agg(to_char(a.starts_at AT TIME ZONE coalesce(a.timezone, 'UTC'), 'FMDD Mon HH24:MI')
                      ORDER BY a.starts_at))[1] AS first_when
      FROM affected a
     WHERE a.user_id IS NOT NULL
     GROUP BY a.user_id
  LOOP
    v_body := concat_ws(' ', p_lead,
      CASE WHEN r.n = 1
           THEN 'Your booking ' || r.first_title || ' on ' || r.first_when || ' is on it.'
           ELSE 'Your next booking, ' || r.first_title || ' on ' || r.first_when
                || ', is one of ' || r.n || ' on it.' END);
    PERFORM internal.notify_instrument_service(p_instrument.workspace_id, r.user_id, p_title, v_body);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_instrument_bookers(p_instrument api.instruments, p_title text, p_lead text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_instrument_bookers(p_instrument api.instruments, p_title text, p_lead text) FROM PUBLIC;
--> statement-breakpoint

-- Mark an instrument out of service, or back in service. Marking it out needs a
-- reason; saying it again just updates the reason and the expected date. Marking
-- it back in can record the work that was done as a repair in the log.
CREATE FUNCTION api.set_instrument_out_of_service(p_instrument_id uuid, p_out_of_service boolean, p_reason text DEFAULT NULL, p_expected_back_on date DEFAULT NULL, p_work_done text DEFAULT NULL) RETURNS api.instruments
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.instruments;
  v_was_out boolean;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_work text := nullif(btrim(coalesce(p_work_done, '')), '');
BEGIN
  SELECT * INTO v FROM api.instruments WHERE id = p_instrument_id FOR UPDATE;
  IF v.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM v.workspace_id
     OR NOT api.has_capability(v.workspace_id, 'calibration.record')
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'instrument denied' USING ERRCODE = '42501';
  END IF;
  v_was_out := v.out_of_service_at IS NOT NULL;

  IF p_out_of_service THEN
    IF v.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'a retired instrument cannot be marked out of service' USING ERRCODE = '22023';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'say what is wrong with the instrument' USING ERRCODE = '22023';
    END IF;
    IF length(v_reason) > 1000 THEN
      RAISE EXCEPTION 'the reason is too long' USING ERRCODE = '22023';
    END IF;
    UPDATE api.instruments
       SET out_of_service_at = CASE WHEN v_was_out THEN out_of_service_at ELSE now() END,
           out_of_service_by = CASE WHEN v_was_out THEN out_of_service_by ELSE api.current_user_id() END,
           out_of_service_reason = v_reason,
           expected_back_on = p_expected_back_on,
           updated_at = now(),
           updated_by_user_id = api.current_user_id()
     WHERE id = v.id
     RETURNING * INTO v;
    IF NOT v_was_out THEN
      PERFORM internal.notify_instrument_bookers(v, v.name || ' is out of service',
        concat_ws(' ', v_reason || CASE WHEN right(v_reason, 1) IN ('.', '!', '?') THEN '' ELSE '.' END,
                  CASE WHEN p_expected_back_on IS NOT NULL
                       THEN 'Expected back ' || to_char(p_expected_back_on, 'FMDD Mon') || '.' END));
    END IF;
  ELSE
    IF NOT v_was_out THEN
      RETURN v;
    END IF;
    UPDATE api.instruments
       SET out_of_service_at = NULL,
           out_of_service_by = NULL,
           out_of_service_reason = NULL,
           expected_back_on = NULL,
           updated_at = now(),
           updated_by_user_id = api.current_user_id()
     WHERE id = v.id
     RETURNING * INTO v;
    IF v_work IS NOT NULL THEN
      INSERT INTO api.instrument_service_log
        (workspace_id, instrument_id, kind, visited_on, summary, logged_by)
      VALUES (v.workspace_id, v.id, 'repair', current_date, left(v_work, 300), api.current_user_id());
    END IF;
    PERFORM internal.notify_instrument_bookers(v, v.name || ' is back in service',
      'You can use it again.');
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_out_of_service(p_instrument_id uuid, p_out_of_service boolean, p_reason text, p_expected_back_on date, p_work_done text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_out_of_service(p_instrument_id uuid, p_out_of_service boolean, p_reason text, p_expected_back_on date, p_work_done text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_out_of_service(p_instrument_id uuid, p_out_of_service boolean, p_reason text, p_expected_back_on date, p_work_done text) TO authenticated;
--> statement-breakpoint

-- Add a repair or service visit to the instrument's log.
CREATE FUNCTION api.log_instrument_service(p_instrument_id uuid, p_kind text, p_visited_on date, p_summary text, p_details text DEFAULT NULL, p_performed_by text DEFAULT NULL) RETURNS api.instrument_service_log
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  i api.instruments;
  v api.instrument_service_log;
BEGIN
  SELECT * INTO i FROM api.instruments WHERE id = p_instrument_id;
  IF i.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM i.workspace_id
     OR NOT api.has_capability(i.workspace_id, 'calibration.record')
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'instrument denied' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('repair', 'service', 'inspection', 'other') THEN
    RAISE EXCEPTION 'invalid kind of visit' USING ERRCODE = '22023';
  END IF;
  IF p_visited_on IS NULL OR p_visited_on > current_date + 1 THEN
    RAISE EXCEPTION 'the visit date cannot be in the future' USING ERRCODE = '22023';
  END IF;
  IF p_summary IS NULL OR length(btrim(p_summary)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'say what was done, in up to 300 characters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.instrument_service_log
    (workspace_id, instrument_id, kind, visited_on, summary, details, performed_by, logged_by)
  VALUES
    (i.workspace_id, i.id, p_kind, p_visited_on, btrim(p_summary),
     nullif(btrim(coalesce(p_details, '')), ''),
     nullif(btrim(coalesce(p_performed_by, '')), ''), api.current_user_id())
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.log_instrument_service(p_instrument_id uuid, p_kind text, p_visited_on date, p_summary text, p_details text, p_performed_by text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.log_instrument_service(p_instrument_id uuid, p_kind text, p_visited_on date, p_summary text, p_details text, p_performed_by text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.log_instrument_service(p_instrument_id uuid, p_kind text, p_visited_on date, p_summary text, p_details text, p_performed_by text) TO authenticated;
