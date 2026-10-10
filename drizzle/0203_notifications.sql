-- WORK-03.2 — notifications.
--
-- internal.notifications holds one row per (user, event). A trigger on
-- api.change_events writes them for the events we can derive today (a review
-- requested and a review returned or signed); the remaining design event
-- types are added by their owning tasks. The caller reads their own rows
-- through api.my_notifications and marks them read.

CREATE TABLE internal.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  record_id uuid,
  project_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
--> statement-breakpoint
CREATE INDEX idx_notifications_user_created
  ON internal.notifications (user_id, created_at DESC);
--> statement-breakpoint
REVOKE ALL ON internal.notifications FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.notify_from_change_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  submission api.review_submissions;
  reviewer text;
  recipient text;
BEGIN
  IF NEW.entity_type = 'review_submission' AND NEW.operation = 'create' THEN
    SELECT * INTO submission FROM api.review_submissions WHERE id = NEW.entity_uuid;
    IF submission.id IS NOT NULL THEN
      FOREACH reviewer IN ARRAY submission.assigned_reviewer_user_ids LOOP
        IF reviewer IS DISTINCT FROM NEW.actor_user_id THEN
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
    SELECT * INTO submission FROM api.review_submissions
      WHERE id = submission.id;
    recipient := submission.submitted_by_user_id;
    IF recipient IS NOT NULL AND recipient IS DISTINCT FROM NEW.actor_user_id THEN
      INSERT INTO internal.notifications
        (workspace_id, user_id, event_type, title, body, record_id, project_id)
      VALUES (NEW.workspace_id, recipient, 'review_returned_or_signed',
              'Review returned or signed', NULL, NEW.record_id, NEW.project_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER notify_from_change_event
  AFTER INSERT ON api.change_events
  FOR EACH ROW EXECUTE FUNCTION internal.notify_from_change_event();
--> statement-breakpoint

CREATE OR REPLACE VIEW api.my_notifications
AS
SELECT id, workspace_id, user_id, event_type, title, body, record_id,
       project_id, created_at, read_at
FROM internal.notifications
WHERE user_id = api.current_user_id()
  AND workspace_id = api.current_workspace_id();
--> statement-breakpoint
REVOKE ALL ON api.my_notifications FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.my_notifications TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id text := api.current_user_id();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'mark_notifications_read requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  UPDATE internal.notifications
    SET read_at = now()
    WHERE user_id = v_user_id
      AND read_at IS NULL
      AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.mark_notifications_read(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.mark_notifications_read(uuid[]) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
