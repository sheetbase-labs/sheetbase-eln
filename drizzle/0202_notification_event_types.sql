-- WORK-03.1 — align the event types with the design's eight notifications.

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
    'review_requested', 'review_returned_or_signed', 'signature_requested',
    'validation_error', 'comment_or_mention', 'instrument_booking',
    'material_expiring', 'protocol_new_version'
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
NOTIFY pgrst, 'reload schema';
