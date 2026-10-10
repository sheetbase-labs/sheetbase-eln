-- WORK-03.4 — quiet hours hold non-urgent email.
--
-- A due delivery whose recipient is inside their quiet window is not claimed
-- until the window ends. Reviews due today and signature requests are always
-- delivered. Mirrors src/lib/email-schedule.ts.

CREATE OR REPLACE FUNCTION internal.claim_due_email_deliveries(p_limit integer DEFAULT 20)
RETURNS SETOF internal.email_deliveries
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE internal.email_deliveries d
     SET status = 'sending', attempt = d.attempt + 1, updated_at = now()
   WHERE d.id IN (
     SELECT id FROM internal.email_deliveries d2
      WHERE d2.status IN ('pending', 'sending')
        AND d2.next_attempt_at <= now()
        AND NOT internal.email_held_for_quiet_hours(d2.user_id, d2.event_type)
      ORDER BY d2.next_attempt_at ASC
      LIMIT greatest(1, least(p_limit, 200))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING d.*;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_due_email_deliveries(integer) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.email_held_for_quiet_hours(
  p_user_id text,
  p_event_type text
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  p api.user_preferences;
  v_start integer;
  v_end integer;
  v_now integer;
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
  v_now := extract(hour FROM now() AT TIME ZONE 'UTC')::int * 60
         + extract(minute FROM now() AT TIME ZONE 'UTC')::int;
  IF v_start < v_end THEN
    RETURN v_now >= v_start AND v_now < v_end;
  END IF;
  RETURN v_now >= v_start OR v_now < v_end;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.email_held_for_quiet_hours(text, text) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
