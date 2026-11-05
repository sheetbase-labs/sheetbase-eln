-- A feed's chart slices are measured from the start of the window asked for.
-- They were cut on the wall clock, so a 15 minute window in one slice could
-- straddle a quarter hour and come back as two, depending on the moment it ran.
CREATE OR REPLACE FUNCTION api.list_instrument_feed_series(p_feed_id uuid, p_since timestamp with time zone, p_until timestamp with time zone DEFAULT now(), p_buckets integer DEFAULT 240)
    RETURNS TABLE(bucket_at timestamp with time zone, min_value double precision, avg_value double precision, max_value double precision, readings bigint)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  WITH p AS (
    SELECT extract(epoch FROM p_since) AS start,
           greatest(extract(epoch FROM (p_until - p_since)), 1) / greatest(least(coalesce(p_buckets, 240), 1000), 1) AS width
  )
  SELECT to_timestamp(p.start + floor((extract(epoch FROM r.taken_at) - p.start) / p.width) * p.width),
         min(r.value), avg(r.value), max(r.value), count(*)
    FROM api.instrument_readings r, p
   WHERE r.feed_id = p_feed_id
     AND r.taken_at >= p_since
     AND r.taken_at <= p_until
   GROUP BY 1
   ORDER BY 1
$$;
