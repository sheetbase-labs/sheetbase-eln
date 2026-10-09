-- LAB-07.3 — read-and-acknowledge reminders.
--
-- Training is enforced at start, so the people who need a version must hear
-- about it. A version becoming effective, and a project pinning a version, both
-- raise one notification per affected member who has not acknowledged that exact
-- version. The helper is idempotent per (member, version, project) so the two
-- trigger points cannot duplicate a reminder.
CREATE OR REPLACE FUNCTION "internal"."notify_protocol_training"(
  p_version_id uuid,
  p_project_id uuid,
  p_actor_user_id text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version api.protocol_versions;
  v_identifier text;
  v_title text;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.status <> 'effective' THEN
    RETURN;
  END IF;
  IF NOT internal.protocol_version_is_eligible(v_version.id, false) THEN
    RETURN;
  END IF;
  SELECT r.identifier INTO v_identifier FROM api.records r WHERE r.id = v_version.protocol_record_id;
  v_title := 'Read and acknowledge ' || coalesce(v_identifier, 'the protocol')
    || ' v' || v_version.version::text;
  INSERT INTO internal.notifications
    (workspace_id, user_id, event_type, title, body, record_id, project_id)
  SELECT v_version.workspace_id, m.user_id, 'protocol_training_required',
         v_title, NULL, v_version.protocol_record_id, p_project_id
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v_version.workspace_id
     AND m.suspended_at IS NULL
     AND m.role <> 'client_viewer'
     AND m.user_id IS DISTINCT FROM p_actor_user_id
     AND NOT EXISTS (SELECT 1 FROM api.protocol_acknowledgements a
                      WHERE a.protocol_version_id = v_version.id AND a.user_id = m.user_id)
     AND (p_project_id IS NULL OR EXISTS (
           SELECT 1 FROM api.project_access pa
            WHERE pa.workspace_id = v_version.workspace_id
              AND pa.project_id = p_project_id
              AND (pa.user_id = m.user_id
                   OR EXISTS (SELECT 1 FROM api.workspace_group_memberships g
                               WHERE g.workspace_id = pa.workspace_id
                                 AND g.group_id = pa.group_id AND g.user_id = m.user_id))
              AND coalesce(pa.can_view OR pa.can_edit OR pa.can_review OR pa.can_manage, false)))
     AND NOT EXISTS (SELECT 1 FROM internal.notifications n
                      WHERE n.user_id = m.user_id
                        AND n.event_type = 'protocol_training_required'
                        AND n.record_id = v_version.protocol_record_id
                        AND n.project_id IS NOT DISTINCT FROM p_project_id
                        AND n.title = v_title);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."notify_protocol_training"(uuid, uuid, text) FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- 1. A version becoming effective reminds the people already required to read it.
CREATE OR REPLACE FUNCTION "internal"."notify_from_change_event"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  submission api.review_submissions;
  reviewer text;
  recipient text;
  project uuid;
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
  ELSIF NEW.entity_type = 'protocol_version' AND NEW.operation = 'update'
        AND NEW.payload->>'status' = 'effective' THEN
    -- One reminder per project already pinned to this exact version.
    FOR project IN SELECT pp.project_id FROM api.project_protocols pp
                    WHERE pp.protocol_version_id = NEW.entity_uuid LOOP
      PERFORM internal.notify_protocol_training(NEW.entity_uuid, project, NEW.actor_user_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- 2. Pinning a version to a project reminds that project's untrained members.
CREATE OR REPLACE FUNCTION "internal"."notify_project_protocol_training"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM internal.notify_protocol_training(NEW.protocol_version_id, NEW.project_id,
    api.current_user_id());
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."notify_project_protocol_training"() FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

DROP TRIGGER IF EXISTS notify_project_protocol_training ON api.project_protocols;
--> statement-breakpoint
CREATE TRIGGER notify_project_protocol_training
  AFTER INSERT OR UPDATE ON api.project_protocols
  FOR EACH ROW EXECUTE FUNCTION internal.notify_project_protocol_training();
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
