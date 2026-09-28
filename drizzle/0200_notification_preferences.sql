-- WORK-03.1 — notification preferences.
--
-- Per-user preferences per event type and channel, plus quiet hours and the
-- digest time on user_preferences. Rows are own-row; written through the RPCs.

REVOKE ALL ON api.notification_preferences FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.notification_preferences TO authenticated;
--> statement-breakpoint
ALTER TABLE api.notification_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_select ON api.notification_preferences
  FOR SELECT TO authenticated
  USING (user_id = api.current_user_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.save_notification_preference(
  p_event_type text,
  p_in_app boolean,
  p_email boolean,
  p_digest boolean
)
RETURNS api.notification_preferences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v api.notification_preferences;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'save_notification_preference requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_event_type NOT IN (
    'review_requested', 'signature_requested', 'data_issue', 'run_waiting',
    'run_failed', 'material_expiring', 'approval_required', 'conflict'
  ) THEN
    RAISE EXCEPTION 'unknown notification event type' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.notification_preferences
    (user_id, event_type, in_app, email, digest)
  VALUES
    (v_user_id, p_event_type, coalesce(p_in_app, true),
     coalesce(p_email, true), coalesce(p_digest, false))
  ON CONFLICT (user_id, event_type) DO UPDATE
    SET in_app = EXCLUDED.in_app,
        email = EXCLUDED.email,
        digest = EXCLUDED.digest,
        updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_notification_preference(text, boolean, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_notification_preference(text, boolean, boolean, boolean) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_notification_timing(
  p_quiet_start text DEFAULT NULL,
  p_quiet_end text DEFAULT NULL,
  p_digest_time text DEFAULT NULL
)
RETURNS api.user_preferences
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v api.user_preferences;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_notification_timing requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF (p_quiet_start IS NOT NULL AND p_quiet_start !~ '^[0-2][0-9]:[0-5][0-9]$')
     OR (p_quiet_end IS NOT NULL AND p_quiet_end !~ '^[0-2][0-9]:[0-5][0-9]$')
     OR (p_digest_time IS NOT NULL AND p_digest_time !~ '^[0-2][0-9]:[0-5][0-9]$') THEN
    RAISE EXCEPTION 'times must be HH:MM' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.user_preferences
    (user_id, quiet_hours_start, quiet_hours_end, digest_time)
  VALUES (v_user_id, p_quiet_start, p_quiet_end, p_digest_time)
  ON CONFLICT (user_id) DO UPDATE
    SET quiet_hours_start = EXCLUDED.quiet_hours_start,
        quiet_hours_end = EXCLUDED.quiet_hours_end,
        digest_time = EXCLUDED.digest_time,
        updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_notification_timing(text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_notification_timing(text, text, text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
