-- Freezer and room readings.
--
-- A freezer, fridge, incubator or cold room reports its temperature the same way
-- an instrument reports a measurement (migration 0068): as readings on a named
-- feed that can carry a low and a high limit. This lets a storage unit or a room
-- hold feeds too, so the same stream, chart, limits and out-of-range alert work
-- for them. A person can also log a reading by hand, which is how many labs keep
-- a daily temperature check.
--
-- The feed tables keep their instrument_ names; a feed belongs to exactly one
-- of an instrument, a storage unit or a room.
--
-- Nobody owns a freezer, so when one goes out of range the people who manage
-- storage (owners, admins and stewards) are told, once, and again when it is
-- back in range. A new Temperature feed starts with the unit's or room's own
-- temperature range as its limits.

ALTER TABLE api.instrument_feeds
    ALTER COLUMN instrument_id DROP NOT NULL,
    ADD COLUMN storage_unit_id uuid,
    ADD COLUMN storage_room_id uuid,
    -- When the feed last went out of its limits; null while it is in range.
    ADD COLUMN out_of_range_since timestamp with time zone;
--> statement-breakpoint
ALTER TABLE api.instrument_feeds
    ADD CONSTRAINT instrument_feeds_unit_fk FOREIGN KEY (storage_unit_id) REFERENCES api.storage_units(id) ON DELETE CASCADE,
    ADD CONSTRAINT instrument_feeds_room_fk FOREIGN KEY (storage_room_id) REFERENCES api.storage_rooms(id) ON DELETE CASCADE,
    ADD CONSTRAINT chk_instrument_feeds_target CHECK (num_nonnulls(instrument_id, storage_unit_id, storage_room_id) = 1);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_instrument_feeds_unit_name ON api.instrument_feeds (storage_unit_id, name) WHERE storage_unit_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_instrument_feeds_room_name ON api.instrument_feeds (storage_room_id, name) WHERE storage_room_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE api.instrument_readings ALTER COLUMN instrument_id DROP NOT NULL;
--> statement-breakpoint

INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('storage_alarm', 'notification', '{}', true, true);
--> statement-breakpoint

-- Tell the people who manage storage a freezer or room has gone out of range, or
-- come back.
CREATE FUNCTION internal.notify_storage_alarm(p_workspace_id uuid, p_title text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body)
  SELECT m.workspace_id, m.user_id, 'storage_alarm', p_title, p_body
    FROM api.workspace_memberships m
   WHERE m.workspace_id = p_workspace_id
     AND m.role IN ('owner', 'admin', 'steward')
     AND m.suspended_at IS NULL
     AND internal.notification_recipient_enabled(m.user_id, 'storage_alarm');
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_storage_alarm(p_workspace_id uuid, p_title text, p_body text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_storage_alarm(p_workspace_id uuid, p_title text, p_body text) FROM PUBLIC;
--> statement-breakpoint

-- Note a feed's limit state after its latest reading and tell the right people
-- when it changes: the instrument's owner, or the people who manage storage.
CREATE OR REPLACE FUNCTION internal.settle_feed_limit(p_feed_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
  i api.instruments;
  v_state text;
  v_what text;
  v_title text;
  v_body text;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id FOR UPDATE;
  IF f.id IS NULL THEN
    RETURN;
  END IF;
  v_state := internal.feed_limit_state(f, f.last_value);
  IF v_state = f.limit_state THEN
    RETURN;
  END IF;
  UPDATE api.instrument_feeds
     SET limit_state = v_state,
         out_of_range_since = CASE WHEN v_state = 'ok' THEN NULL ELSE coalesce(out_of_range_since, now()) END
   WHERE id = f.id;
  IF f.instrument_id IS NOT NULL THEN
    SELECT * INTO i FROM api.instruments WHERE id = f.instrument_id;
    v_what := f.name || ' on ' || i.name;
  ELSIF f.storage_unit_id IS NOT NULL THEN
    SELECT f.name || ' in ' || u.name INTO v_what FROM api.storage_units u WHERE u.id = f.storage_unit_id;
  ELSE
    SELECT f.name || ' in ' || r.name INTO v_what FROM api.storage_rooms r WHERE r.id = f.storage_room_id;
  END IF;
  IF v_state = 'ok' THEN
    v_title := v_what || ' is back in range';
    v_body := 'It reads ' || f.last_value || coalesce(' ' || f.unit, '') || '.';
  ELSE
    v_title := v_what || ' is ' || CASE WHEN v_state = 'low' THEN 'below' ELSE 'above' END || ' its limit';
    v_body := 'It reads ' || f.last_value || coalesce(' ' || f.unit, '')
      || ', ' || CASE WHEN v_state = 'low' THEN 'under ' || f.low_limit ELSE 'over ' || f.high_limit END
      || coalesce(' ' || f.unit, '') || '.';
  END IF;
  IF f.instrument_id IS NOT NULL THEN
    PERFORM internal.notify_feed_limit(i, v_title, v_body);
  ELSE
    PERFORM internal.notify_storage_alarm(f.workspace_id, v_title, v_body);
  END IF;
END $$;
--> statement-breakpoint

-- Store a batch of readings against one instrument, storage unit or room. The
-- caller has already checked who may send them. Each reading is
--   {"feed": "Temperature", "value": -80.4, "at": "2026-11-05T09:00:00Z", "unit": "°C"}
-- A feed that does not exist yet is created (up to 50 per target). A feed called
-- Temperature on a storage unit or room starts with that place's own range as
-- its limits.
CREATE FUNCTION internal.store_feed_readings(p_workspace_id uuid, p_instrument_id uuid, p_unit_id uuid, p_room_id uuid, p_readings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r jsonb;
  v_feed api.instrument_feeds;
  v_name text;
  v_unit text;
  v_at timestamptz;
  v_value double precision;
  v_stored integer := 0;
  v_feed_ids uuid[] := '{}';
  v_id uuid;
  v_low numeric;
  v_high numeric;
BEGIN
  IF p_readings IS NULL OR jsonb_typeof(p_readings) <> 'array' THEN
    RAISE EXCEPTION 'readings must be a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_readings) = 0 OR jsonb_array_length(p_readings) > 2000 THEN
    RAISE EXCEPTION 'send between 1 and 2000 readings at a time' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_readings) LOOP
    IF jsonb_typeof(r) <> 'object' THEN
      RAISE EXCEPTION 'each reading needs a feed and a value' USING ERRCODE = '22023';
    END IF;
    v_name := btrim(coalesce(r->>'feed', ''));
    IF length(v_name) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'each reading needs a feed name of up to 80 characters' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(r->'value') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'the value for % must be a number', v_name USING ERRCODE = '22023';
    END IF;
    v_value := (r->>'value')::double precision;
    v_at := coalesce(nullif(r->>'at', '')::timestamptz, now());
    IF v_at > now() + interval '1 day' OR v_at < now() - interval '90 days' THEN
      RAISE EXCEPTION 'the time for % is outside the last 90 days', v_name USING ERRCODE = '22023';
    END IF;
    v_unit := nullif(btrim(coalesce(r->>'unit', '')), '');
    IF v_unit IS NOT NULL AND length(v_unit) > 20 THEN
      v_unit := NULL;
    END IF;

    SELECT * INTO v_feed FROM api.instrument_feeds
     WHERE instrument_id IS NOT DISTINCT FROM p_instrument_id
       AND storage_unit_id IS NOT DISTINCT FROM p_unit_id
       AND storage_room_id IS NOT DISTINCT FROM p_room_id
       AND name = v_name;
    IF v_feed.id IS NULL THEN
      IF (SELECT count(*) FROM api.instrument_feeds
           WHERE instrument_id IS NOT DISTINCT FROM p_instrument_id
             AND storage_unit_id IS NOT DISTINCT FROM p_unit_id
             AND storage_room_id IS NOT DISTINCT FROM p_room_id) >= 50 THEN
        RAISE EXCEPTION 'up to 50 measurements can be kept in one place' USING ERRCODE = '22023';
      END IF;
      v_low := NULL;
      v_high := NULL;
      IF lower(v_name) = 'temperature' THEN
        IF p_unit_id IS NOT NULL THEN
          SELECT temperature_min_c, temperature_max_c INTO v_low, v_high
            FROM api.storage_units WHERE id = p_unit_id;
        ELSIF p_room_id IS NOT NULL THEN
          SELECT temperature_min_c, temperature_max_c INTO v_low, v_high
            FROM api.storage_rooms WHERE id = p_room_id;
        END IF;
        v_unit := coalesce(v_unit, CASE WHEN v_low IS NOT NULL OR v_high IS NOT NULL THEN '°C' END);
      END IF;
      INSERT INTO api.instrument_feeds (workspace_id, instrument_id, storage_unit_id, storage_room_id, name, unit, low_limit, high_limit)
      VALUES (p_workspace_id, p_instrument_id, p_unit_id, p_room_id, v_name, v_unit, v_low, v_high)
      RETURNING * INTO v_feed;
    ELSIF v_feed.unit IS NULL AND v_unit IS NOT NULL THEN
      UPDATE api.instrument_feeds SET unit = v_unit WHERE id = v_feed.id;
    END IF;

    INSERT INTO api.instrument_readings (workspace_id, instrument_id, feed_id, taken_at, value)
    VALUES (p_workspace_id, p_instrument_id, v_feed.id, v_at, v_value);
    v_stored := v_stored + 1;

    UPDATE api.instrument_feeds
       SET reading_count = reading_count + 1,
           last_value = CASE WHEN last_at IS NULL OR v_at >= last_at THEN v_value ELSE last_value END,
           last_at = CASE WHEN last_at IS NULL OR v_at >= last_at THEN v_at ELSE last_at END
     WHERE id = v_feed.id;
    IF NOT (v_feed.id = ANY (v_feed_ids)) THEN
      v_feed_ids := v_feed_ids || v_feed.id;
    END IF;
  END LOOP;

  FOREACH v_id IN ARRAY v_feed_ids LOOP
    PERFORM internal.settle_feed_limit(v_id);
    -- Keep 90 days. Pruned now and then, per feed, so no job is needed.
    IF random() < 0.02 THEN
      DELETE FROM api.instrument_readings
       WHERE feed_id = v_id AND taken_at < now() - interval '90 days';
    END IF;
  END LOOP;
  RETURN jsonb_build_object('stored', v_stored, 'feeds', cardinality(v_feed_ids));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.store_feed_readings(p_workspace_id uuid, p_instrument_id uuid, p_unit_id uuid, p_room_id uuid, p_readings jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.store_feed_readings(p_workspace_id uuid, p_instrument_id uuid, p_unit_id uuid, p_room_id uuid, p_readings jsonb) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.record_instrument_readings(p_instrument_id uuid, p_readings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  i api.instruments;
  v_result jsonb;
BEGIN
  SELECT * INTO i FROM api.instruments WHERE id = p_instrument_id;
  IF i.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM i.workspace_id
     OR NOT api.is_workspace_writer(i.workspace_id)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'instrument denied' USING ERRCODE = '42501';
  END IF;
  IF i.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'a retired instrument does not take readings' USING ERRCODE = '22023';
  END IF;
  v_result := internal.store_feed_readings(i.workspace_id, i.id, NULL, NULL, p_readings);
  UPDATE api.instruments
     SET last_connected_at = now(), connection_status = 'connected'
   WHERE id = i.id;
  RETURN v_result;
END $$;
--> statement-breakpoint

-- Take a batch of readings for a freezer-type storage unit or a room (give one
-- of the two). Anyone who can write in the workspace may send or log readings.
CREATE FUNCTION api.record_storage_readings(p_unit_id uuid, p_room_id uuid, p_readings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid;
BEGIN
  IF num_nonnulls(p_unit_id, p_room_id) <> 1 THEN
    RAISE EXCEPTION 'name a storage unit or a room' USING ERRCODE = '22023';
  END IF;
  IF p_unit_id IS NOT NULL THEN
    SELECT workspace_id INTO v_workspace FROM api.storage_units WHERE id = p_unit_id;
  ELSE
    SELECT workspace_id INTO v_workspace FROM api.storage_rooms WHERE id = p_room_id;
  END IF;
  IF v_workspace IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM v_workspace
     OR NOT api.is_workspace_writer(v_workspace)
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'storage location denied' USING ERRCODE = '42501';
  END IF;
  RETURN internal.store_feed_readings(v_workspace, NULL, p_unit_id, p_room_id, p_readings);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_storage_readings(p_unit_id uuid, p_room_id uuid, p_readings jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_storage_readings(p_unit_id uuid, p_room_id uuid, p_readings jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_storage_readings(p_unit_id uuid, p_room_id uuid, p_readings jsonb) TO authenticated;
--> statement-breakpoint

-- Who may change a feed's limits or stop keeping it: the people who run the
-- instrument, or the people who manage storage for a freezer or room.
CREATE FUNCTION internal.can_manage_feed(f api.instrument_feeds) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT api.current_workspace_id() IS NOT DISTINCT FROM f.workspace_id
     AND api.has_write_actor()
     AND CASE WHEN f.instrument_id IS NOT NULL
              THEN api.has_capability(f.workspace_id, 'calibration.record')
              ELSE api.has_settings_access(f.workspace_id, 'storage', 'manage') END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.can_manage_feed(f api.instrument_feeds) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.can_manage_feed(f api.instrument_feeds) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_instrument_feed_limits(p_feed_id uuid, p_low double precision, p_high double precision, p_unit text DEFAULT NULL) RETURNS api.instrument_feeds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id FOR UPDATE;
  IF f.id IS NULL OR NOT internal.can_manage_feed(f) THEN
    RAISE EXCEPTION 'feed denied' USING ERRCODE = '42501';
  END IF;
  IF p_low IS NOT NULL AND p_high IS NOT NULL AND p_low > p_high THEN
    RAISE EXCEPTION 'the low limit cannot be above the high limit' USING ERRCODE = '22023';
  END IF;
  IF p_unit IS NOT NULL AND length(btrim(p_unit)) > 20 THEN
    RAISE EXCEPTION 'the unit is too long' USING ERRCODE = '22023';
  END IF;
  UPDATE api.instrument_feeds
     SET low_limit = p_low,
         high_limit = p_high,
         unit = coalesce(nullif(btrim(p_unit), ''), unit)
   WHERE id = f.id
   RETURNING * INTO f;
  PERFORM internal.settle_feed_limit(f.id);
  SELECT * INTO f FROM api.instrument_feeds WHERE id = f.id;
  RETURN f;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.remove_instrument_feed(p_feed_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id;
  IF f.id IS NULL OR NOT internal.can_manage_feed(f) THEN
    RAISE EXCEPTION 'feed denied' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.instrument_feeds WHERE id = f.id;
END $$;
