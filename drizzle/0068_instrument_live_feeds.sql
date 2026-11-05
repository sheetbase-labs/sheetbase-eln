-- Live readings from an instrument.
--
-- Some instruments never write a result file while they run: a balance, a pH
-- meter, a freezer or incubator probe, a bioreactor. They report readings as they
-- happen. A "feed" is one named measurement on an instrument (for example
-- "Chamber temperature", in °C). The folder agent on the computer next to the
-- instrument, or anything else holding a personal API token, sends readings to
-- POST /api/connectors/stream; each batch lands here through
-- api.record_instrument_readings.
--
-- The instrument page shows the feeds live. A feed can carry a low and a high
-- limit; when a reading crosses one, the instrument's owner is told once, and
-- again when it is back in range.
--
-- Readings are kept for 90 days. They are not Datasets: a run worth keeping goes
-- through the file pickup path as before.

CREATE TABLE api.instrument_feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    name text NOT NULL,
    unit text,
    low_limit double precision,
    high_limit double precision,
    -- Where the latest reading sits against the limits: ok, low or high.
    limit_state text DEFAULT 'ok' NOT NULL,
    last_value double precision,
    last_at timestamp with time zone,
    reading_count bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_feeds_pkey PRIMARY KEY (id),
    CONSTRAINT instrument_feeds_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT instrument_feeds_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT uq_instrument_feeds_name UNIQUE (instrument_id, name),
    CONSTRAINT chk_instrument_feeds_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT chk_instrument_feeds_unit CHECK (unit IS NULL OR length(unit) <= 20),
    CONSTRAINT chk_instrument_feeds_state CHECK (limit_state IN ('ok', 'low', 'high')),
    CONSTRAINT chk_instrument_feeds_limits CHECK (low_limit IS NULL OR high_limit IS NULL OR low_limit <= high_limit)
);
--> statement-breakpoint
ALTER TABLE api.instrument_feeds OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_feeds_instrument ON api.instrument_feeds (instrument_id, name);
--> statement-breakpoint
ALTER TABLE api.instrument_feeds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_feeds_select ON api.instrument_feeds FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_feeds_client_select ON api.instrument_feeds FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_feeds TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_feeds TO api_client;
--> statement-breakpoint

CREATE TABLE api.instrument_readings (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    workspace_id uuid NOT NULL,
    instrument_id uuid NOT NULL,
    feed_id uuid NOT NULL,
    taken_at timestamp with time zone NOT NULL,
    value double precision NOT NULL,
    CONSTRAINT instrument_readings_pkey PRIMARY KEY (id),
    CONSTRAINT instrument_readings_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT instrument_readings_feed_fk FOREIGN KEY (feed_id) REFERENCES api.instrument_feeds(id) ON DELETE CASCADE,
    CONSTRAINT chk_instrument_readings_value CHECK (value > '-Infinity'::double precision AND value < 'Infinity'::double precision)
);
--> statement-breakpoint
ALTER TABLE api.instrument_readings OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_readings_feed ON api.instrument_readings (feed_id, taken_at DESC);
--> statement-breakpoint
ALTER TABLE api.instrument_readings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_readings_select ON api.instrument_readings FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_readings_client_select ON api.instrument_readings FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_readings TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_readings TO api_client;
--> statement-breakpoint

-- Tell the instrument's owner a feed has gone out of range, or come back.
CREATE FUNCTION internal.notify_feed_limit(p_instrument api.instruments, p_title text, p_body text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_instrument.owner_id IS NULL
     OR NOT internal.notification_recipient_enabled(p_instrument.owner_id, 'instrument_service') THEN
    RETURN;
  END IF;
  INSERT INTO internal.notifications (workspace_id, user_id, event_type, title, body)
  VALUES (p_instrument.workspace_id, p_instrument.owner_id, 'instrument_service', p_title, p_body);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.notify_feed_limit(p_instrument api.instruments, p_title text, p_body text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_feed_limit(p_instrument api.instruments, p_title text, p_body text) FROM PUBLIC;
--> statement-breakpoint

-- Where a value sits against a feed's limits.
CREATE FUNCTION internal.feed_limit_state(p_feed api.instrument_feeds, p_value double precision) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN 'ok'
    WHEN p_feed.low_limit IS NOT NULL AND p_value < p_feed.low_limit THEN 'low'
    WHEN p_feed.high_limit IS NOT NULL AND p_value > p_feed.high_limit THEN 'high'
    ELSE 'ok'
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.feed_limit_state(p_feed api.instrument_feeds, p_value double precision) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feed_limit_state(p_feed api.instrument_feeds, p_value double precision) FROM PUBLIC;
--> statement-breakpoint

-- Note a feed's limit state after its latest reading and tell the owner when it
-- changes. Called whenever a reading or a limit changes.
CREATE FUNCTION internal.settle_feed_limit(p_feed_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
  i api.instruments;
  v_state text;
  v_what text;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id FOR UPDATE;
  IF f.id IS NULL THEN
    RETURN;
  END IF;
  v_state := internal.feed_limit_state(f, f.last_value);
  IF v_state = f.limit_state THEN
    RETURN;
  END IF;
  UPDATE api.instrument_feeds SET limit_state = v_state WHERE id = f.id;
  SELECT * INTO i FROM api.instruments WHERE id = f.instrument_id;
  v_what := f.name || ' on ' || i.name;
  IF v_state = 'ok' THEN
    PERFORM internal.notify_feed_limit(i, v_what || ' is back in range',
      'It reads ' || f.last_value || coalesce(' ' || f.unit, '') || '.');
  ELSE
    PERFORM internal.notify_feed_limit(i,
      v_what || ' is ' || CASE WHEN v_state = 'low' THEN 'below' ELSE 'above' END || ' its limit',
      'It reads ' || f.last_value || coalesce(' ' || f.unit, '')
      || ', ' || CASE WHEN v_state = 'low' THEN 'under ' || f.low_limit ELSE 'over ' || f.high_limit END
      || coalesce(' ' || f.unit, '') || '.');
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.settle_feed_limit(p_feed_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.settle_feed_limit(p_feed_id uuid) FROM PUBLIC;
--> statement-breakpoint

-- Take a batch of readings from an instrument. Each reading is
--   {"feed": "Chamber temperature", "value": 4.1, "at": "2026-11-05T09:00:00Z", "unit": "°C"}
-- where "at" defaults to now and "unit" is only read when the feed is new or has
-- no unit yet. A feed that does not exist yet is created (up to 50 per
-- instrument). Anyone who can write in the workspace may send readings; the
-- personal token the agent holds carries that person's access.
CREATE FUNCTION api.record_instrument_readings(p_instrument_id uuid, p_readings jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  i api.instruments;
  r jsonb;
  v_feed api.instrument_feeds;
  v_name text;
  v_unit text;
  v_at timestamptz;
  v_value double precision;
  v_stored integer := 0;
  v_feed_ids uuid[] := '{}';
  v_id uuid;
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
     WHERE instrument_id = i.id AND name = v_name;
    IF v_feed.id IS NULL THEN
      IF (SELECT count(*) FROM api.instrument_feeds WHERE instrument_id = i.id) >= 50 THEN
        RAISE EXCEPTION 'an instrument can have up to 50 feeds' USING ERRCODE = '22023';
      END IF;
      INSERT INTO api.instrument_feeds (workspace_id, instrument_id, name, unit)
      VALUES (i.workspace_id, i.id, v_name, v_unit)
      RETURNING * INTO v_feed;
    ELSIF v_feed.unit IS NULL AND v_unit IS NOT NULL THEN
      UPDATE api.instrument_feeds SET unit = v_unit WHERE id = v_feed.id;
    END IF;

    INSERT INTO api.instrument_readings (workspace_id, instrument_id, feed_id, taken_at, value)
    VALUES (i.workspace_id, i.id, v_feed.id, v_at, v_value);
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

  UPDATE api.instruments
     SET last_connected_at = now(), connection_status = 'connected'
   WHERE id = i.id;
  RETURN jsonb_build_object('stored', v_stored, 'feeds', cardinality(v_feed_ids));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_instrument_readings(p_instrument_id uuid, p_readings jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_instrument_readings(p_instrument_id uuid, p_readings jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_instrument_readings(p_instrument_id uuid, p_readings jsonb) TO authenticated;
--> statement-breakpoint

-- Set a feed's unit and limits. Either limit can be cleared with null.
CREATE FUNCTION api.set_instrument_feed_limits(p_feed_id uuid, p_low double precision, p_high double precision, p_unit text DEFAULT NULL) RETURNS api.instrument_feeds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id FOR UPDATE;
  IF f.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM f.workspace_id
     OR NOT api.has_capability(f.workspace_id, 'calibration.record')
     OR NOT api.has_write_actor() THEN
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
ALTER FUNCTION api.set_instrument_feed_limits(p_feed_id uuid, p_low double precision, p_high double precision, p_unit text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_feed_limits(p_feed_id uuid, p_low double precision, p_high double precision, p_unit text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_feed_limits(p_feed_id uuid, p_low double precision, p_high double precision, p_unit text) TO authenticated;
--> statement-breakpoint

-- Stop keeping a feed and everything it recorded.
CREATE FUNCTION api.remove_instrument_feed(p_feed_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.instrument_feeds;
BEGIN
  SELECT * INTO f FROM api.instrument_feeds WHERE id = p_feed_id;
  IF f.id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM f.workspace_id
     OR NOT api.has_capability(f.workspace_id, 'calibration.record')
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'feed denied' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.instrument_feeds WHERE id = f.id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_instrument_feed(p_feed_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_instrument_feed(p_feed_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_instrument_feed(p_feed_id uuid) TO authenticated;
--> statement-breakpoint

-- A feed's readings over a window, cut into at most p_buckets slices so a day of
-- one-second readings is still a few hundred points. Runs as the caller, so it
-- only sees what the caller may read.
CREATE FUNCTION api.list_instrument_feed_series(p_feed_id uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_buckets integer DEFAULT 240)
    RETURNS TABLE(bucket_at timestamp with time zone, min_value double precision, avg_value double precision, max_value double precision, readings bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH p AS (
    SELECT greatest(extract(epoch FROM (p_until - p_since)), 1) / greatest(least(coalesce(p_buckets, 240), 1000), 1) AS width
  )
  SELECT to_timestamp(floor(extract(epoch FROM r.taken_at) / p.width) * p.width),
         min(r.value), avg(r.value), max(r.value), count(*)
    FROM api.instrument_readings r, p
   WHERE r.feed_id = p_feed_id
     AND r.taken_at >= p_since
     AND r.taken_at <= p_until
   GROUP BY 1
   ORDER BY 1
$$;
--> statement-breakpoint
ALTER FUNCTION api.list_instrument_feed_series(p_feed_id uuid, p_since timestamp with time zone, p_until timestamp with time zone, p_buckets integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_instrument_feed_series(p_feed_id uuid, p_since timestamp with time zone, p_until timestamp with time zone, p_buckets integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.list_instrument_feed_series(p_feed_id uuid, p_since timestamp with time zone, p_until timestamp with time zone, p_buckets integer) TO authenticated, api_client;
