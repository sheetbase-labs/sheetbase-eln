-- Quiet hours and the daily digest time were compared with the server's UTC
-- clock, so "22:00" meant 22:00 UTC wherever the person works. They are now
-- read on the person's own wall clock: their profile time zone, else the zone
-- of their active workspace, else UTC. A person with no zone set sees no change.

CREATE OR REPLACE FUNCTION internal.email_held_for_quiet_hours(p_user_id text, p_event_type text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  p api.user_preferences;
  v_start integer;
  v_end integer;
  v_now integer;
  v_zone text;
  v_local timestamp;
BEGIN
  IF p_event_type IN ('review_requested', 'review_returned_or_signed', 'signature_requested') THEN
    RETURN false;
  END IF;
  SELECT * INTO p FROM api.user_preferences WHERE user_id = p_user_id;
  IF p.quiet_hours_start IS NULL OR p.quiet_hours_end IS NULL
     OR p.quiet_hours_start !~ '^[0-2][0-9]:[0-5][0-9]$'
     OR p.quiet_hours_end !~ '^[0-2][0-9]:[0-5][0-9]$' THEN
    RETURN false;
  END IF;
  v_start := split_part(p.quiet_hours_start, ':', 1)::int * 60
           + split_part(p.quiet_hours_start, ':', 2)::int;
  v_end := split_part(p.quiet_hours_end, ':', 1)::int * 60
         + split_part(p.quiet_hours_end, ':', 2)::int;
  IF v_start = v_end THEN RETURN false; END IF;
  v_zone := coalesce(internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC');
  v_local := now() AT TIME ZONE v_zone;
  v_now := extract(hour FROM v_local)::int * 60 + extract(minute FROM v_local)::int;
  IF v_start < v_end THEN
    RETURN v_now >= v_start AND v_now < v_end;
  END IF;
  RETURN v_now >= v_start OR v_now < v_end;
END;
$_$;
--> statement-breakpoint
CREATE FUNCTION internal.notification_zone(p_user_zone text, p_workspace_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT z.name
    FROM (
      SELECT p_user_zone AS name, 1 AS rank
      UNION ALL
      SELECT s.timezone, 2
        FROM api.workspace_settings s
       WHERE s.workspace_id = p_workspace_id
    ) z
    JOIN pg_catalog.pg_timezone_names n ON n.name = z.name
   ORDER BY z.rank
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION internal.notification_zone(p_user_zone text, p_workspace_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notification_zone(p_user_zone text, p_workspace_id uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.enqueue_daily_digests() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  u record;
  v_titles text;
  v_workspace uuid;
  v_sent integer := 0;
BEGIN
  FOR u IN
    SELECT p.user_id, p.digest_time,
           (now() AT TIME ZONE coalesce(
              internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'))::date AS local_day
      FROM api.user_preferences p
     WHERE p.digest_time IS NOT NULL
       AND p.digest_time = to_char(
             now() AT TIME ZONE coalesce(
               internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'),
             'HH24:MI')
       AND (p.digest_last_sent_on IS NULL
            OR p.digest_last_sent_on < (now() AT TIME ZONE coalesce(
                 internal.notification_zone(p.timezone, p.active_workspace_id), 'UTC'))::date)
  LOOP
    SELECT string_agg(n.title, E'\n'), (array_agg(n.workspace_id))[1]
      INTO v_titles, v_workspace
      FROM internal.notifications n
     WHERE n.user_id = u.user_id
       AND n.read_at IS NULL
       AND n.created_at >= now() - interval '1 day';
    CONTINUE WHEN v_titles IS NULL OR v_workspace IS NULL;
    PERFORM internal.enqueue_email_delivery(
      v_workspace, u.user_id, 'digest', 'Daily digest', v_titles
    );
    UPDATE api.user_preferences
       SET digest_last_sent_on = u.local_day, updated_at = now()
     WHERE user_id = u.user_id;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
