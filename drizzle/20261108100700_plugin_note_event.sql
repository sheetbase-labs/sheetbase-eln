-- Plugin notes in the Inbox are a notification event like the others, so a
-- person can switch them off.
INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email, default_push)
VALUES ('plugin_note', 'inbox', ARRAY['plugin_note'], false, false)
ON CONFLICT DO NOTHING;
