-- WORK-03.2 — the remaining design event types that have a producer today.
--
-- internal.notify_from_change_event already covered review_requested and
-- review_returned_or_signed. Two more of the eight design types arise as change
-- events today:
--
--   comment_or_mention    a comment is created: the record's author and everyone
--                         named in the comment's mentions
--   protocol_new_version  a protocol version is created: everyone trained on that
--                         protocol
--
-- The other four - signature_requested, validation_error, instrument_booking and
-- material_expiring - have no producer yet: nothing emits a change event for a
-- witness request, a check result, a booking or a hold transition. They land with
-- those flows (CAL, EXP, LAB), not by inventing an address here.
--
-- A user who turned in-app delivery off for an event type is skipped; a user with
-- no preference row keeps the default. The trigger is derived data, so a failure
-- inside it warns instead of blocking the write it observes.

CREATE OR REPLACE FUNCTION internal.notification_recipient_enabled(
  p_user_id text,
  p_event_type text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT p.in_app FROM api.notification_preferences p
     WHERE p.user_id = p_user_id
       AND p.event_type = p_event_type
  ), true)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notification_recipient_enabled(text,text)
  FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.notify_from_change_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  submission api.review_submissions;
  comment_row api.comments;
  reviewer text;
  recipient text;
  protocol_record uuid;
  project_id uuid;
BEGIN
  IF NEW.entity_type = 'review_submission' AND NEW.operation = 'create' THEN
    SELECT * INTO submission FROM api.review_submissions WHERE id = NEW.entity_uuid;
    IF submission.id IS NOT NULL THEN
      FOREACH reviewer IN ARRAY submission.assigned_reviewer_user_ids LOOP
        IF reviewer IS DISTINCT FROM NEW.actor_user_id
           AND internal.notification_recipient_enabled(reviewer, 'review_requested') THEN
          INSERT INTO internal.notifications
            (workspace_id, user_id, event_type, title, body, record_id, project_id)
          VALUES (NEW.workspace_id, reviewer, 'review_requested',
                  'Review requested', NULL, NEW.record_id, NEW.project_id);
        END IF;
      END LOOP;
    END IF;
  ELSIF NEW.entity_type = 'signature' AND NEW.operation = 'create' THEN
    SELECT * INTO submission FROM api.review_submissions
      WHERE id = nullif(NEW.payload->>'submissionId', '')::uuid;
    recipient := submission.submitted_by_user_id;
    IF recipient IS NOT NULL AND recipient IS DISTINCT FROM NEW.actor_user_id
       AND internal.notification_recipient_enabled(recipient, 'review_returned_or_signed') THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, project_id)
      VALUES (NEW.workspace_id, recipient, 'review_returned_or_signed',
              'Review returned or signed', NULL, NEW.record_id, NEW.project_id);
    END IF;
  ELSIF NEW.entity_type = 'comment' AND NEW.operation = 'create' THEN
    SELECT * INTO comment_row FROM api.comments WHERE id = NEW.entity_uuid;
    IF comment_row.id IS NOT NULL THEN
      -- The record's author, then everyone named in the comment.
      SELECT created_by_user_id INTO recipient FROM api.records WHERE id = comment_row.record_id;
      IF recipient IS NOT NULL AND recipient IS DISTINCT FROM comment_row.author_user_id
         AND internal.notification_recipient_enabled(recipient, 'comment_or_mention') THEN
        INSERT INTO internal.notifications
          (workspace_id, user_id, event_type, title, body, record_id, project_id)
        VALUES (NEW.workspace_id, recipient, 'comment_or_mention',
                'Comment on your record', NULL, comment_row.record_id, NEW.project_id);
      END IF;
      FOREACH recipient IN ARRAY coalesce(comment_row.mentions, '{}'::text[]) LOOP
        IF recipient IS DISTINCT FROM comment_row.author_user_id
           AND recipient IS DISTINCT FROM (SELECT created_by_user_id FROM api.records WHERE id = comment_row.record_id)
           AND internal.notification_recipient_enabled(recipient, 'comment_or_mention') THEN
          INSERT INTO internal.notifications
            (workspace_id, user_id, event_type, title, body, record_id, project_id)
          VALUES (NEW.workspace_id, recipient, 'comment_or_mention',
                  'You were mentioned in a comment', NULL, comment_row.record_id, NEW.project_id);
        END IF;
      END LOOP;
    END IF;
  ELSIF NEW.entity_type = 'protocol_version' AND NEW.operation = 'update'
        AND NEW.payload->>'status' = 'effective' THEN
    -- One reminder per project already pinned to this exact version (LAB-07,
    -- added by drizzle/0358; kept intact here).
    FOR project_id IN
      SELECT pp.project_id FROM api.project_protocols pp
       WHERE pp.protocol_version_id = NEW.entity_uuid
    LOOP
      PERFORM internal.notify_protocol_training(NEW.entity_uuid, project_id, NEW.actor_user_id);
    END LOOP;
  ELSIF NEW.entity_type = 'protocol_version' AND NEW.operation = 'create' THEN
    -- "Protocol you use has a new version": everyone trained on that protocol.
    SELECT protocol_record_id INTO protocol_record FROM api.protocol_versions WHERE id = NEW.entity_uuid;
    IF protocol_record IS NOT NULL THEN
      FOR recipient IN
        SELECT t.user_id FROM api.protocol_training t
         WHERE t.workspace_id = NEW.workspace_id
           AND t.protocol_record_id = protocol_record
           AND t.user_id IS DISTINCT FROM NEW.actor_user_id
      LOOP
        IF internal.notification_recipient_enabled(recipient, 'protocol_new_version') THEN
          INSERT INTO internal.notifications
            (workspace_id, user_id, event_type, title, body, record_id, project_id)
          VALUES (NEW.workspace_id, recipient, 'protocol_new_version',
                  'Protocol has a new version', NULL, protocol_record, NEW.project_id);
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Notifications are derived; they must never block the write they observe.
  RAISE WARNING 'notification derivation failed for % %: %',
    NEW.entity_type, NEW.operation, SQLERRM;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.notify_from_change_event() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
