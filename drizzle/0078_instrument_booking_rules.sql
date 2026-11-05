-- Booking rules. Each instrument can say who may book it and for how long:
--   * training: the procedures (protocols) a person must be trained on first.
--     Training is the same fact starting an experiment checks: they have
--     acknowledged the protocol's current version.
--   * longest booking, in minutes;
--   * furthest ahead a booking can start, in days.
-- Booking has always refused someone without a current qualification, an
-- instrument that is overdue for calibration and one that is out of service;
-- these add to that. The rules apply wherever a booking is made or moved: the
-- Schedule, an experiment and a repeating booking.

CREATE TABLE api.instrument_booking_rules (
    instrument_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    max_booking_minutes integer,
    max_advance_days integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT instrument_booking_rules_pkey PRIMARY KEY (instrument_id),
    CONSTRAINT instrument_booking_rules_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT chk_instrument_booking_rules_minutes CHECK (max_booking_minutes IS NULL OR max_booking_minutes BETWEEN 5 AND 43200),
    CONSTRAINT chk_instrument_booking_rules_days CHECK (max_advance_days IS NULL OR max_advance_days BETWEEN 1 AND 730)
);
--> statement-breakpoint
ALTER TABLE api.instrument_booking_rules OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE api.instrument_required_training (
    instrument_id uuid NOT NULL,
    protocol_record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    CONSTRAINT instrument_required_training_pkey PRIMARY KEY (instrument_id, protocol_record_id),
    CONSTRAINT instrument_required_training_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT instrument_required_training_protocol_fk FOREIGN KEY (protocol_record_id) REFERENCES api.records(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.instrument_required_training OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_required_training_protocol ON api.instrument_required_training (protocol_record_id);
--> statement-breakpoint
ALTER TABLE api.instrument_booking_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_booking_rules_select ON api.instrument_booking_rules FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
ALTER TABLE api.instrument_required_training ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_required_training_select ON api.instrument_required_training FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_booking_rules TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_required_training TO authenticated;
--> statement-breakpoint

-- The required procedures a person has not been trained on. A procedure with no
-- version in force cannot be trained on yet, so it does not hold anyone back.
CREATE FUNCTION internal.instrument_training_gaps(p_instrument_id uuid, p_user_id text)
RETURNS TABLE (protocol_record_id uuid, identifier text, title text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT rt.protocol_record_id, r.identifier, r.title
    FROM api.instrument_required_training rt
    JOIN api.records r ON r.id = rt.protocol_record_id AND r.deleted_at IS NULL
   WHERE rt.instrument_id = p_instrument_id
     AND EXISTS (SELECT 1 FROM api.protocol_versions v
                  WHERE v.protocol_record_id = rt.protocol_record_id
                    AND v.status IN ('effective', 'in_review'))
     AND NOT EXISTS (SELECT 1 FROM api.protocol_training_status s
                      WHERE s.protocol_record_id = rt.protocol_record_id
                        AND s.user_id = p_user_id AND s.status = 'trained')
   ORDER BY r.identifier
$$;
--> statement-breakpoint
ALTER FUNCTION internal.instrument_training_gaps(p_instrument_id uuid, p_user_id text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.instrument_training_gaps(p_instrument_id uuid, p_user_id text) FROM PUBLIC;
--> statement-breakpoint

-- What stands between the caller and booking this instrument, for the booking
-- dialog to say before they try.
CREATE FUNCTION api.my_instrument_training_gaps(p_instrument_id uuid)
RETURNS TABLE (protocol_record_id uuid, identifier text, title text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT g.protocol_record_id, g.identifier, g.title
    FROM api.instruments i,
         LATERAL internal.instrument_training_gaps(i.id, api.current_user_id()) g
   WHERE i.id = p_instrument_id
     AND i.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(i.workspace_id)
$$;
--> statement-breakpoint
ALTER FUNCTION api.my_instrument_training_gaps(p_instrument_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.my_instrument_training_gaps(p_instrument_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.my_instrument_training_gaps(p_instrument_id uuid) TO authenticated;
--> statement-breakpoint

-- Set an instrument's booking rules in one go. Null limits mean no limit.
CREATE FUNCTION api.set_instrument_booking_rules(
    p_instrument_id uuid, p_required_protocol_ids uuid[] DEFAULT '{}',
    p_max_booking_minutes integer DEFAULT NULL, p_max_advance_days integer DEFAULT NULL)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_ids uuid[] := coalesce(p_required_protocol_ids, '{}');
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.has_capability(v_instrument.workspace_id, 'instrument.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs instrument.manage' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_ids) p
     WHERE NOT EXISTS (SELECT 1 FROM api.records r
                        WHERE r.id = p AND r.workspace_id = v_instrument.workspace_id
                          AND r.kind = 'protocol_template' AND r.deleted_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'training can only be required on protocols' USING ERRCODE = '22023';
  END IF;
  DELETE FROM api.instrument_required_training WHERE instrument_id = v_instrument.id;
  INSERT INTO api.instrument_required_training (instrument_id, protocol_record_id, workspace_id)
  SELECT v_instrument.id, p, v_instrument.workspace_id FROM (SELECT DISTINCT unnest(v_ids) AS p) d;
  IF p_max_booking_minutes IS NULL AND p_max_advance_days IS NULL THEN
    DELETE FROM api.instrument_booking_rules WHERE instrument_id = v_instrument.id;
  ELSE
    INSERT INTO api.instrument_booking_rules
      (instrument_id, workspace_id, max_booking_minutes, max_advance_days, updated_by_user_id)
    VALUES (v_instrument.id, v_instrument.workspace_id, p_max_booking_minutes, p_max_advance_days, api.current_user_id())
    ON CONFLICT (instrument_id) DO UPDATE
       SET max_booking_minutes = EXCLUDED.max_booking_minutes,
           max_advance_days = EXCLUDED.max_advance_days,
           updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_booking_rules(p_instrument_id uuid, p_required_protocol_ids uuid[], p_max_booking_minutes integer, p_max_advance_days integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_booking_rules(p_instrument_id uuid, p_required_protocol_ids uuid[], p_max_booking_minutes integer, p_max_advance_days integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_booking_rules(p_instrument_id uuid, p_required_protocol_ids uuid[], p_max_booking_minutes integer, p_max_advance_days integer) TO authenticated;
--> statement-breakpoint

-- The booking gate: the same rules as before, plus training.
CREATE OR REPLACE FUNCTION internal.assert_instrument_bookable(p_resource api.calendar_resources) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument "api"."instruments";
  v_latest_due timestamptz;
  v_gap record;
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
  SELECT * INTO v_gap FROM internal.instrument_training_gaps(v_instrument.id, "api"."current_user_id"()) LIMIT 1;
  IF v_gap.protocol_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'training is required before booking this instrument: % %', v_gap.identifier, v_gap.title
      USING ERRCODE = 'SB142';
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

-- Longest booking and furthest ahead, checked whenever a booking's time is set
-- or moved, so every way of booking is held to them.
CREATE FUNCTION internal.enforce_booking_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_rules api.instrument_booking_rules;
  v_minutes numeric;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.starts_at = NEW.starts_at AND OLD.ends_at = NEW.ends_at THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_rules FROM api.instrument_booking_rules WHERE instrument_id = NEW.resource_id;
  IF v_rules.instrument_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_minutes := extract(epoch FROM (NEW.ends_at - NEW.starts_at)) / 60;
  IF v_rules.max_booking_minutes IS NOT NULL AND v_minutes > v_rules.max_booking_minutes THEN
    RAISE EXCEPTION 'this instrument can be booked for at most % minutes at a time', v_rules.max_booking_minutes
      USING ERRCODE = 'SB143';
  END IF;
  IF v_rules.max_advance_days IS NOT NULL
     AND NEW.starts_at > now() + make_interval(days => v_rules.max_advance_days) THEN
    RAISE EXCEPTION 'this instrument can be booked at most % days ahead', v_rules.max_advance_days
      USING ERRCODE = 'SB144';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.enforce_booking_rules() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enforce_booking_rules() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER enforce_booking_rules BEFORE INSERT OR UPDATE OF starts_at, ends_at, status
    ON api.calendar_bookings FOR EACH ROW EXECUTE FUNCTION internal.enforce_booking_rules();
