-- Work that repeats: an instrument booked every week, an experiment started from
-- a template every month, a stability study pulled at fixed time points.
--
-- A schedule says what repeats and when. Its occurrences are made for real
-- (bookings through api.create_booking, experiments through
-- api.instantiate_notebook_template_version) so every existing rule still applies: clashes,
-- qualification, calibration and project access. An occurrence that cannot be
-- made is recorded with the reason rather than lost, and is never retried
-- silently.
--
-- Bookings are made ahead of time, 60 days out, so people see them on the
-- Schedule. Experiments are made on their day (or `lead_days` before it).

CREATE TABLE api.recurring_schedules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    -- daily / weekly / monthly repeat every `interval_count` days, weeks or months.
    -- offsets runs once at each of `offsets_days` after `starts_on` (time points).
    frequency text NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    -- ISO weekdays, 1 = Monday .. 7 = Sunday (weekly only).
    weekdays smallint[],
    offsets_days integer[],
    starts_on date NOT NULL,
    ends_on date,
    max_occurrences integer,
    timezone text DEFAULT 'UTC' NOT NULL,
    -- Booking schedules.
    resource_id uuid,
    start_time time without time zone,
    end_time time without time zone,
    -- Experiment schedules: each one starts from the template's latest published version.
    notebook_template_id uuid,
    lead_days integer DEFAULT 0 NOT NULL,
    project_id uuid,
    notes text,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT recurring_schedules_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_schedules_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT recurring_schedules_template_fk FOREIGN KEY (notebook_template_id) REFERENCES api.notebook_templates(id) ON DELETE CASCADE,
    CONSTRAINT chk_recurring_kind CHECK (kind IN ('booking', 'experiment')),
    CONSTRAINT chk_recurring_status CHECK (status IN ('active', 'paused', 'ended')),
    CONSTRAINT chk_recurring_title CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    CONSTRAINT chk_recurring_frequency CHECK (frequency IN ('daily', 'weekly', 'monthly', 'offsets')),
    CONSTRAINT chk_recurring_interval CHECK (interval_count BETWEEN 1 AND 52),
    CONSTRAINT chk_recurring_weekdays CHECK (
      (frequency = 'weekly' AND weekdays IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7
        AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
      OR (frequency <> 'weekly' AND weekdays IS NULL)),
    CONSTRAINT chk_recurring_offsets CHECK (
      (frequency = 'offsets' AND offsets_days IS NOT NULL AND cardinality(offsets_days) BETWEEN 1 AND 60
        AND 0 <= ALL (offsets_days) AND 3660 >= ALL (offsets_days))
      OR (frequency <> 'offsets' AND offsets_days IS NULL)),
    -- A repeat always ends: by date, by count, or because it lists its time points.
    CONSTRAINT chk_recurring_bounded CHECK (
      frequency = 'offsets' OR ends_on IS NOT NULL OR max_occurrences IS NOT NULL),
    CONSTRAINT chk_recurring_ends CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT chk_recurring_max CHECK (max_occurrences IS NULL OR max_occurrences BETWEEN 1 AND 400),
    CONSTRAINT chk_recurring_lead CHECK (lead_days BETWEEN 0 AND 30),
    CONSTRAINT chk_recurring_booking_fields CHECK (
      kind <> 'booking' OR (resource_id IS NOT NULL AND start_time IS NOT NULL
        AND end_time IS NOT NULL AND end_time > start_time AND frequency <> 'offsets')),
    CONSTRAINT chk_recurring_experiment_fields CHECK (
      kind <> 'experiment' OR (notebook_template_id IS NOT NULL AND project_id IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE api.recurring_schedules OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_recurring_schedules_workspace ON api.recurring_schedules (workspace_id, kind, status);
--> statement-breakpoint
CREATE TABLE api.recurring_occurrences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    schedule_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    occurrence_on date NOT NULL,
    -- created: the booking or experiment exists. skipped: the booking could not be
    -- made (a clash, an instrument that is not available). failed: anything else.
    outcome text NOT NULL,
    booking_id uuid,
    record_id uuid,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurring_occurrences_pkey PRIMARY KEY (id),
    CONSTRAINT recurring_occurrences_schedule_fk FOREIGN KEY (schedule_id) REFERENCES api.recurring_schedules(id) ON DELETE CASCADE,
    CONSTRAINT recurring_occurrences_booking_fk FOREIGN KEY (booking_id) REFERENCES api.calendar_bookings(id) ON DELETE SET NULL,
    CONSTRAINT chk_recurring_outcome CHECK (outcome IN ('created', 'skipped', 'failed')),
    CONSTRAINT uq_recurring_occurrence UNIQUE (schedule_id, occurrence_on)
);
--> statement-breakpoint
ALTER TABLE api.recurring_occurrences OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_recurring_occurrences_booking ON api.recurring_occurrences (booking_id) WHERE booking_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.recurring_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.recurring_occurrences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY recurring_schedules_select ON api.recurring_schedules FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY recurring_occurrences_select ON api.recurring_occurrences FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.recurring_schedules TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.recurring_occurrences TO authenticated;
--> statement-breakpoint

-- The dates a schedule falls on, from its start up to `p_to`, honouring its end
-- date and its count. Monthly repeats on the same day of the month, or the last
-- day of a shorter month.
CREATE FUNCTION internal.recurring_dates(p_schedule api.recurring_schedules, p_to date)
  RETURNS SETOF date
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH bounds AS (
    SELECT p_schedule.starts_on AS first_day,
           least(p_to, coalesce(p_schedule.ends_on, p_to), p_schedule.starts_on + 3660) AS last_day
  ), days AS (
    SELECT d::date AS d FROM bounds, generate_series(bounds.first_day, bounds.last_day, interval '1 day') g(d)
    WHERE p_schedule.frequency <> 'offsets'
  ), hits AS (
    SELECT d FROM days
     WHERE CASE p_schedule.frequency
       WHEN 'daily' THEN (d - p_schedule.starts_on) % p_schedule.interval_count = 0
       WHEN 'weekly' THEN extract(isodow FROM d)::smallint = ANY (p_schedule.weekdays)
         AND ((d - date_trunc('week', p_schedule.starts_on)::date) / 7) % p_schedule.interval_count = 0
       WHEN 'monthly' THEN
         ((extract(year FROM d) * 12 + extract(month FROM d))
           - (extract(year FROM p_schedule.starts_on) * 12 + extract(month FROM p_schedule.starts_on)))::int
           % p_schedule.interval_count = 0
         AND extract(day FROM d) = least(
           extract(day FROM p_schedule.starts_on),
           extract(day FROM (date_trunc('month', d) + interval '1 month - 1 day')))
       END
    UNION ALL
    SELECT (p_schedule.starts_on + o)::date
      FROM unnest(p_schedule.offsets_days) o
     WHERE p_schedule.frequency = 'offsets'
       AND (p_schedule.starts_on + o) <= p_to
  ), numbered AS (
    SELECT d, row_number() OVER (ORDER BY d) AS n FROM hits
  )
  SELECT d FROM numbered
   WHERE p_schedule.max_occurrences IS NULL OR n <= p_schedule.max_occurrences
   ORDER BY d
$$;
--> statement-breakpoint
ALTER FUNCTION internal.recurring_dates(api.recurring_schedules, date) OWNER TO migrator;
--> statement-breakpoint

-- Make whatever is due for one schedule, as its creator. Bookings are made 60
-- days ahead; experiments on their day (less lead_days). Each occurrence is made
-- in its own sub-transaction so one refusal does not stop the rest. Returns the
-- counts and the refusals so the caller can say what happened.
CREATE FUNCTION api.materialise_recurring_schedule(p_schedule_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  s api.recurring_schedules;
  v_today date;
  v_horizon date;
  v_day date;
  v_booking api.calendar_bookings;
  v_result jsonb;
  v_created int := 0;
  v_skipped int := 0;
  v_failed int := 0;
  v_problems jsonb := '[]'::jsonb;
  v_state text;
  v_msg text;
  v_suffix text;
  v_version uuid;
BEGIN
  SELECT * INTO s FROM api.recurring_schedules WHERE id = p_schedule_id AND workspace_id = v_ws FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'repeating schedule not found in the active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF s.created_by_user_id <> v_user THEN
    RAISE EXCEPTION 'only the person who set up a repeat can run it' USING ERRCODE = '42501';
  END IF;
  IF s.status <> 'active' THEN
    RETURN jsonb_build_object('created', 0, 'skipped', 0, 'failed', 0, 'problems', v_problems);
  END IF;
  -- A repeat belongs to the person who set it up; if they have left, it pauses.
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
                  WHERE m.workspace_id = s.workspace_id AND m.user_id = s.created_by_user_id
                    AND m.suspended_at IS NULL) THEN
    UPDATE api.recurring_schedules SET status = 'paused', updated_at = now() WHERE id = s.id;
    RETURN jsonb_build_object('created', 0, 'skipped', 0, 'failed', 0, 'problems', v_problems);
  END IF;

  v_today := (now() AT TIME ZONE s.timezone)::date;
  v_horizon := CASE WHEN s.kind = 'booking' THEN v_today + 60 ELSE v_today + s.lead_days END;

  FOR v_day IN
    SELECT d FROM internal.recurring_dates(s, v_horizon) d
     WHERE (s.kind = 'experiment' OR d >= v_today)
       AND NOT EXISTS (SELECT 1 FROM api.recurring_occurrences o
                        WHERE o.schedule_id = s.id AND o.occurrence_on = d)
  LOOP
    BEGIN
      IF s.kind = 'booking' THEN
        v_booking := api.create_booking(
          s.workspace_id, s.resource_id, s.title,
          ((v_day + s.start_time) AT TIME ZONE s.timezone),
          ((v_day + s.end_time) AT TIME ZONE s.timezone),
          s.timezone, 'tentative', false, NULL, NULL, s.notes, s.project_id, NULL,
          '[]'::jsonb, '[]'::jsonb);
        INSERT INTO api.recurring_occurrences (schedule_id, workspace_id, occurrence_on, outcome, booking_id)
          VALUES (s.id, s.workspace_id, v_day, 'created', v_booking.id);
      ELSE
        v_suffix := CASE WHEN s.frequency = 'offsets'
          THEN format('day %s, %s', v_day - s.starts_on, to_char(v_day, 'FMDD Mon YYYY'))
          ELSE to_char(v_day, 'FMDD Mon YYYY') END;
        SELECT v.id INTO v_version FROM api.notebook_template_versions v
         WHERE v.template_id = s.notebook_template_id AND v.lifecycle = 'published'
         ORDER BY v.version DESC LIMIT 1;
        IF v_version IS NULL THEN
          RAISE EXCEPTION 'the template has no published version' USING ERRCODE = 'SB090';
        END IF;
        v_result := api.instantiate_notebook_template_version(
          v_version, s.project_id, btrim(s.title) || ' (' || v_suffix || ')', '[]'::jsonb,
          'recurring:' || s.id || ':' || v_day);
        INSERT INTO api.recurring_occurrences (schedule_id, workspace_id, occurrence_on, outcome, record_id)
          VALUES (s.id, s.workspace_id, v_day, 'created', (v_result -> 'record' ->> 'id')::uuid);
      END IF;
      v_created := v_created + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      -- SB020 is a clash, SB115/SB116 an instrument that is not available to book.
      INSERT INTO api.recurring_occurrences (schedule_id, workspace_id, occurrence_on, outcome, message)
        VALUES (s.id, s.workspace_id, v_day,
                CASE WHEN v_state IN ('SB020', 'SB115', 'SB116') THEN 'skipped' ELSE 'failed' END,
                v_state || ': ' || v_msg);
      IF v_state IN ('SB020', 'SB115', 'SB116') THEN v_skipped := v_skipped + 1; ELSE v_failed := v_failed + 1; END IF;
      v_problems := v_problems || jsonb_build_object('on', v_day, 'code', v_state, 'message', v_msg);
    END;
  END LOOP;

  -- A schedule with nothing left beyond what has been made is finished.
  IF NOT EXISTS (SELECT 1 FROM internal.recurring_dates(s, s.starts_on + 3660) d WHERE d > v_horizon) THEN
    UPDATE api.recurring_schedules SET status = 'ended', ended_at = now(), updated_at = now() WHERE id = s.id;
  END IF;

  RETURN jsonb_build_object('created', v_created, 'skipped', v_skipped, 'failed', v_failed, 'problems', v_problems);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.materialise_recurring_schedule(uuid) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.create_recurring_schedule(
    p_kind text, p_title text, p_frequency text, p_starts_on date,
    p_timezone text,
    p_interval_count integer DEFAULT 1,
    p_weekdays smallint[] DEFAULT NULL,
    p_offsets_days integer[] DEFAULT NULL,
    p_ends_on date DEFAULT NULL,
    p_max_occurrences integer DEFAULT NULL,
    p_resource_id uuid DEFAULT NULL,
    p_start_time time DEFAULT NULL,
    p_end_time time DEFAULT NULL,
    p_notebook_template_id uuid DEFAULT NULL,
    p_lead_days integer DEFAULT 0,
    p_project_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_user text := api.current_user_id();
  s api.recurring_schedules;
BEGIN
  IF v_user IS NULL OR v_ws IS NULL OR NOT api.is_workspace_member(v_ws) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'unknown time zone' USING ERRCODE = '22023';
  END IF;
  IF p_starts_on IS NULL OR p_starts_on < (now() AT TIME ZONE p_timezone)::date THEN
    RAISE EXCEPTION 'a repeat cannot start in the past' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'booking' THEN
    IF NOT EXISTS (SELECT 1 FROM api.calendar_resources r WHERE r.id = p_resource_id AND r.workspace_id = v_ws) THEN
      RAISE EXCEPTION 'instrument not found in the active workspace' USING ERRCODE = 'SB021';
    END IF;
    IF p_project_id IS NOT NULL THEN PERFORM internal.assert_object_access('project', p_project_id, 'edit'); END IF;
  ELSIF p_kind = 'experiment' THEN
    PERFORM internal.assert_object_access('project', p_project_id, 'edit');
    IF NOT EXISTS (
      SELECT 1 FROM api.notebook_templates n
       WHERE n.id = p_notebook_template_id AND n.workspace_id = v_ws AND n.lifecycle = 'active'
         AND EXISTS (SELECT 1 FROM api.notebook_template_versions v
                      WHERE v.template_id = n.id AND v.lifecycle = 'published')) THEN
      RAISE EXCEPTION 'choose a template that has a published version' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'a repeat is for a booking or an experiment' USING ERRCODE = '22023';
  END IF;

  INSERT INTO api.recurring_schedules
    (workspace_id, kind, title, frequency, interval_count, weekdays, offsets_days, starts_on, ends_on,
     max_occurrences, timezone, resource_id, start_time, end_time, notebook_template_id, lead_days,
     project_id, notes, created_by_user_id)
  VALUES
    (v_ws, p_kind, btrim(p_title), p_frequency, coalesce(p_interval_count, 1), p_weekdays, p_offsets_days,
     p_starts_on, p_ends_on, p_max_occurrences, p_timezone, p_resource_id, p_start_time, p_end_time,
     p_notebook_template_id, coalesce(p_lead_days, 0), p_project_id, nullif(btrim(coalesce(p_notes, '')), ''), v_user)
  RETURNING * INTO s;

  RETURN jsonb_build_object('schedule', to_jsonb(s), 'result', api.materialise_recurring_schedule(s.id));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_recurring_schedule(text, text, text, date, text, integer, smallint[], integer[], date, integer, uuid, time, time, uuid, integer, uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- Pause or resume a repeat. Nothing already made is touched.
CREATE FUNCTION api.set_recurring_schedule_paused(p_schedule_id uuid, p_paused boolean) RETURNS api.recurring_schedules
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.recurring_schedules;
BEGIN
  SELECT * INTO s FROM api.recurring_schedules
   WHERE id = p_schedule_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'repeating schedule not found in the active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF s.created_by_user_id <> api.current_user_id() AND NOT api.has_capability(s.workspace_id, 'instrument.manage') THEN
    RAISE EXCEPTION 'only the person who set up a repeat, or someone who manages instruments, can change it' USING ERRCODE = '42501';
  END IF;
  IF s.status = 'ended' THEN
    RAISE EXCEPTION 'this repeat has ended' USING ERRCODE = 'SB024';
  END IF;
  UPDATE api.recurring_schedules
     SET status = CASE WHEN p_paused THEN 'paused' ELSE 'active' END, updated_at = now()
   WHERE id = s.id RETURNING * INTO s;
  RETURN s;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_recurring_schedule_paused(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint

-- Stop a repeat for good. For bookings, the ones still ahead can be cancelled
-- with it; what already happened is left alone.
CREATE FUNCTION api.end_recurring_schedule(p_schedule_id uuid, p_cancel_upcoming boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s api.recurring_schedules;
  v_booking uuid;
  v_cancelled int := 0;
BEGIN
  SELECT * INTO s FROM api.recurring_schedules
   WHERE id = p_schedule_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'repeating schedule not found in the active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF s.created_by_user_id <> api.current_user_id() AND NOT api.has_capability(s.workspace_id, 'instrument.manage') THEN
    RAISE EXCEPTION 'only the person who set up a repeat, or someone who manages instruments, can change it' USING ERRCODE = '42501';
  END IF;
  IF p_cancel_upcoming AND s.kind = 'booking' THEN
    FOR v_booking IN
      SELECT b.id FROM api.recurring_occurrences o
        JOIN api.calendar_bookings b ON b.id = o.booking_id
       WHERE o.schedule_id = s.id AND b.starts_at > now() AND b.status <> 'cancelled'
    LOOP
      PERFORM api.cancel_booking(v_booking);
      v_cancelled := v_cancelled + 1;
    END LOOP;
  END IF;
  UPDATE api.recurring_schedules
     SET status = 'ended', ended_at = coalesce(ended_at, now()), updated_at = now()
   WHERE id = s.id;
  RETURN jsonb_build_object('cancelled', v_cancelled);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.end_recurring_schedule(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.materialise_recurring_schedule(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.materialise_recurring_schedule(uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_recurring_schedule(text, text, text, date, text, integer, smallint[], integer[], date, integer, uuid, time, time, uuid, integer, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_recurring_schedule(text, text, text, date, text, integer, smallint[], integer[], date, integer, uuid, time, time, uuid, integer, uuid, text) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_recurring_schedule_paused(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_recurring_schedule_paused(uuid, boolean) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.end_recurring_schedule(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.end_recurring_schedule(uuid, boolean) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.recurring_dates(api.recurring_schedules, date) FROM PUBLIC;
