-- LAB-07 / PROJ-03 — the members Training column reflects exact-version training.
--
-- `api.workspace_member_status` counted the coarse record-level
-- `api.protocol_training` rows, which are not what gates starting an
-- experiment. Training is now read from the exact-version authority: the
-- effective, still-current protocol versions pinned by the projects a member can
-- view, minus the versions that member has acknowledged. A version whose
-- periodic review is already due counts as overdue for an untrained member.
CREATE OR REPLACE FUNCTION "api"."workspace_member_status"()
RETURNS TABLE(user_id text, last_active_at timestamptz, training_required bigint, training_overdue bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH required AS (
    SELECT m.user_id, v.id AS version_id, v.review_due_at
      FROM api.workspace_memberships m
      JOIN api.project_access a
        ON a.workspace_id = m.workspace_id
       AND (a.user_id = m.user_id
            OR EXISTS (SELECT 1 FROM api.workspace_group_memberships g
                        WHERE g.workspace_id = m.workspace_id AND g.group_id = a.group_id
                          AND g.user_id = m.user_id))
      JOIN api.projects p ON p.id = a.project_id AND p.workspace_id = m.workspace_id
      JOIN api.project_protocols pp ON pp.project_id = p.id AND pp.workspace_id = m.workspace_id
      JOIN api.protocol_versions v ON v.id = pp.protocol_version_id
     WHERE m.workspace_id = api.current_workspace_id()
       AND m.suspended_at IS NULL
       AND m.role <> 'client_viewer'
       AND coalesce(a.can_view OR a.can_edit OR a.can_review OR a.can_manage, false)
       AND v.status = 'effective'
       AND internal.protocol_version_is_eligible(v.id, false)
  ), outstanding AS (
    SELECT r.user_id, r.review_due_at
      FROM required r
     WHERE NOT EXISTS (SELECT 1 FROM api.protocol_acknowledgements ack
                        WHERE ack.protocol_version_id = r.version_id AND ack.user_id = r.user_id)
  )
  SELECT m.user_id,
         (SELECT max(s."updatedAt") FROM internal.session s WHERE s."userId" = m.user_id),
         coalesce((SELECT count(*) FROM outstanding o WHERE o.user_id = m.user_id), 0),
         coalesce((SELECT count(*) FROM outstanding o
                    WHERE o.user_id = m.user_id AND o.review_due_at IS NOT NULL
                      AND o.review_due_at < now()), 0)
    FROM api.workspace_memberships m
   WHERE m.workspace_id = api.current_workspace_id()
     AND m.suspended_at IS NULL
     AND api.has_capability(m.workspace_id, 'workspace.admin')
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
