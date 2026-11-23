-- A daily schedule at a time that happens twice (the hour the clocks go back)
-- runs at the first of the two, once. The page (src/lib/pipeline-schedule.ts)
-- already did this; the database took the second, so a trigger stamped by an
-- RPC and one stamped by the sweep disagreed by an hour
-- (tests/db/pipeline-scheduling.test.ts compares them).
CREATE OR REPLACE FUNCTION api.pipeline_schedule_next_run(p_kind text, p_spec jsonb, p_from timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_at_local timestamp;
  v_at timestamptz;
  v_tz text;
  v_from_local timestamp;
BEGIN
  IF p_kind = 'interval' THEN
    IF jsonb_typeof(p_spec->'intervalMinutes') <> 'number'
       OR (p_spec->>'intervalMinutes') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid interval schedule' USING ERRCODE = 'SB034';
    END IF;
    RETURN p_from + make_interval(mins => (p_spec->>'intervalMinutes')::int);
  ELSIF p_kind = 'daily' THEN
    IF jsonb_typeof(p_spec->'dailyAt') <> 'string'
       OR p_spec->>'dailyAt' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'invalid daily schedule' USING ERRCODE = 'SB034';
    END IF;
    -- Explicit IANA time zone (default UTC); never the DB/server session
    -- time zone, so behaviour is deployment-independent and deterministic.
    v_tz := COALESCE(p_spec->>'timeZone', 'UTC');
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
      RAISE EXCEPTION 'invalid schedule time zone' USING ERRCODE = 'SB034';
    END IF;
    v_from_local := p_from AT TIME ZONE v_tz;
    v_at_local := date_trunc('day', v_from_local) + (p_spec->>'dailyAt')::time;
    LOOP
      v_at := v_at_local AT TIME ZONE v_tz;
      -- When the wall-clock time happens twice, take the earlier instant.
      IF (v_at - interval '1 hour') AT TIME ZONE v_tz = v_at_local THEN
        v_at := v_at - interval '1 hour';
      ELSIF (v_at - interval '30 minutes') AT TIME ZONE v_tz = v_at_local THEN
        v_at := v_at - interval '30 minutes';
      END IF;
      EXIT WHEN v_at > p_from;
      v_at_local := v_at_local + interval '1 day';
    END LOOP;
    RETURN v_at;
  ELSIF p_kind = 'cron' THEN
    IF jsonb_typeof(p_spec->'cron') <> 'string' THEN
      RAISE EXCEPTION 'invalid cron schedule' USING ERRCODE = 'SB034';
    END IF;
    RETURN api.pipeline_cron_next(p_spec->>'cron', p_spec->>'timeZone', p_from);
  ELSIF p_kind = 'event' THEN
    -- Event schedules are evaluated by the server sweep, not wall-clock.
    RETURN NULL;
  ELSE
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
END;
$_$;
