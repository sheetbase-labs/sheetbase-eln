-- WORK-03.4 — the daily digest.
--
-- Once per day, at the user's digest time, enqueue a single email listing
-- their unread notifications when there is anything to report. Idempotent per
-- day via user_preferences.digest_last_sent_on.

CREATE OR REPLACE FUNCTION internal.enqueue_daily_digests()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  u record;
  v_titles text;
  v_workspace uuid;
  v_sent integer := 0;
BEGIN
  FOR u IN
    SELECT p.user_id, p.digest_time
      FROM api.user_preferences p
     WHERE p.digest_time IS NOT NULL
       AND p.digest_time = to_char(now() AT TIME ZONE 'UTC', 'HH24:MI')
       AND (p.digest_last_sent_on IS NULL OR p.digest_last_sent_on < current_date)
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
       SET digest_last_sent_on = current_date, updated_at = now()
     WHERE user_id = u.user_id;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.enqueue_daily_digests() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
