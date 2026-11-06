-- Out of office, with a delegate.
--
-- Someone going away names the dates and a colleague to cover. While they are
-- away, reviews waiting on them also go to the colleague, who decides and
-- signs as themselves: a signature is personal and never carried by another
-- name, so the colleague becomes one of the review's assigned reviewers for the
-- time being and the review says whom they are covering. When the absence
-- ends or is cancelled the colleague is taken off any review they have not
-- acted on.
--
--   api.member_absences   who is away, from when to when, and who covers;
--   api.review_cover      each review the cover reached, kept as history;
--   api.set_member_absence / api.cancel_member_absence
--                         set it yourself, or (for the members area) for
--                         someone else;
--   internal.sync_absence_cover
--                         applies and lifts cover; runs when an absence
--                         changes, when a review is submitted, and on a sweep.
--
-- Approvals that go to anyone holding a role need no cover, as anyone with the
-- role can act.

CREATE TABLE api.member_absences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    delegate_user_id text,
    note text,
    cancelled_at timestamp with time zone,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT member_absences_pkey PRIMARY KEY (id),
    CONSTRAINT chk_member_absences_dates CHECK (ends_on >= starts_on AND ends_on <= starts_on + 366),
    CONSTRAINT chk_member_absences_delegate CHECK (delegate_user_id IS NULL OR delegate_user_id <> user_id),
    CONSTRAINT chk_member_absences_note CHECK (note IS NULL OR length(note) <= 500),
    CONSTRAINT member_absences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT member_absences_user_id_fkey FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT member_absences_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT member_absences_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.member_absences OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_member_absences_user ON api.member_absences (workspace_id, user_id, ends_on DESC);
--> statement-breakpoint
CREATE INDEX idx_member_absences_open ON api.member_absences (workspace_id, ends_on) WHERE cancelled_at IS NULL;
--> statement-breakpoint
ALTER TABLE api.member_absences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY member_absences_select ON api.member_absences FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.member_absences TO authenticated;
--> statement-breakpoint

CREATE TABLE api.review_cover (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    absence_id uuid NOT NULL,
    absent_user_id text NOT NULL,
    delegate_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT review_cover_pkey PRIMARY KEY (id),
    CONSTRAINT uq_review_cover_submission_absence UNIQUE (submission_id, absence_id),
    CONSTRAINT review_cover_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT review_cover_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES api.review_submissions(id) ON DELETE CASCADE,
    CONSTRAINT review_cover_absence_id_fkey FOREIGN KEY (absence_id) REFERENCES api.member_absences(id) ON DELETE CASCADE,
    CONSTRAINT review_cover_absent_user_id_fkey FOREIGN KEY (absent_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT review_cover_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.review_cover OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_review_cover_delegate ON api.review_cover (delegate_user_id) WHERE ended_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_review_cover_submission ON api.review_cover (submission_id);
--> statement-breakpoint
ALTER TABLE api.review_cover ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY review_cover_select ON api.review_cover FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.review_cover TO authenticated;
--> statement-breakpoint

-- Apply cover for absences under way, and lift it for those that are over,
-- cancelled or not yet started. Safe to run at any time and as often as
-- wanted; p_workspace_id narrows it to one workspace.
CREATE FUNCTION internal.sync_absence_cover(p_workspace_id uuid DEFAULT NULL) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_changed integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT c.id, c.submission_id, c.delegate_user_id
      FROM api.review_cover c
      JOIN api.member_absences a ON a.id = c.absence_id
     WHERE c.ended_at IS NULL
       AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
       AND (a.cancelled_at IS NOT NULL OR a.ends_on < current_date OR a.starts_on > current_date)
  LOOP
    -- The colleague leaves the review unless they have already acted on it.
    UPDATE api.review_submissions s
       SET assigned_reviewer_user_ids = array_remove(s.assigned_reviewer_user_ids, r.delegate_user_id),
           updated_at = now()
     WHERE s.id = r.submission_id
       AND r.delegate_user_id = ANY (s.assigned_reviewer_user_ids)
       AND cardinality(array_remove(s.assigned_reviewer_user_ids, r.delegate_user_id)) > 0
       AND NOT EXISTS (SELECT 1 FROM api.review_decisions d
                        WHERE d.submission_id = s.id AND d.actor_user_id = r.delegate_user_id)
       AND NOT EXISTS (SELECT 1 FROM api.signatures g
                        WHERE g.submission_id = s.id AND g.signer_user_id = r.delegate_user_id);
    UPDATE api.review_cover SET ended_at = now() WHERE id = r.id;
    v_changed := v_changed + 1;
  END LOOP;

  FOR r IN
    SELECT s.id AS submission_id, s.workspace_id, a.id AS absence_id,
           a.user_id AS absent_user_id, a.delegate_user_id
      FROM api.review_submissions s
      JOIN api.records rec ON rec.id = s.record_id
      JOIN api.member_absences a
        ON a.workspace_id = s.workspace_id AND a.user_id = ANY (s.assigned_reviewer_user_ids)
     WHERE s.state IN ('submitted', 'approved')
       AND (p_workspace_id IS NULL OR s.workspace_id = p_workspace_id)
       AND a.cancelled_at IS NULL
       AND a.delegate_user_id IS NOT NULL
       AND a.starts_on <= current_date AND a.ends_on >= current_date
       AND NOT (a.delegate_user_id = ANY (s.assigned_reviewer_user_ids))
       AND a.delegate_user_id <> s.submitted_by_user_id
       -- Once approved, only the signing is left: nothing to cover if the
       -- absent reviewer has already signed.
       AND (s.state = 'submitted' OR NOT EXISTS (
              SELECT 1 FROM api.signatures g
               WHERE g.submission_id = s.id AND g.signer_user_id = a.user_id))
       AND EXISTS (SELECT 1 FROM api.workspace_memberships m
                    WHERE m.workspace_id = s.workspace_id AND m.user_id = a.delegate_user_id
                      AND m.suspended_at IS NULL)
       AND (rec.project_id IS NULL OR EXISTS (
              SELECT 1 FROM internal.project_permissions_for(rec.project_id, a.delegate_user_id) pp
               WHERE pp.can_review))
  LOOP
    UPDATE api.review_submissions s
       SET assigned_reviewer_user_ids = array_append(s.assigned_reviewer_user_ids, r.delegate_user_id),
           updated_at = now()
     WHERE s.id = r.submission_id;
    INSERT INTO api.review_cover (workspace_id, submission_id, absence_id, absent_user_id, delegate_user_id)
    VALUES (r.workspace_id, r.submission_id, r.absence_id, r.absent_user_id, r.delegate_user_id)
    ON CONFLICT (submission_id, absence_id) DO UPDATE SET ended_at = NULL;
    v_changed := v_changed + 1;
  END LOOP;
  RETURN v_changed;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.sync_absence_cover(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.sync_absence_cover(uuid) FROM PUBLIC;
--> statement-breakpoint

-- A review submitted while its reviewer is away is covered from the start.
CREATE FUNCTION internal.cover_new_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.sync_absence_cover(NEW.workspace_id);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.cover_new_review() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER cover_new_review AFTER INSERT ON api.review_submissions
    FOR EACH ROW EXECUTE FUNCTION internal.cover_new_review();
--> statement-breakpoint

CREATE FUNCTION api.set_member_absence(
    p_workspace_id uuid, p_starts_on date, p_ends_on date, p_delegate_user_id text,
    p_note text DEFAULT NULL, p_user_id text DEFAULT NULL
) RETURNS api.member_absences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_target text := coalesce(p_user_id, api.current_user_id());
  v_row api.member_absences;
BEGIN
  IF v_actor IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT (v_target = v_actor OR api.has_settings_access(p_workspace_id, 'members', 'manage')) THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships
                  WHERE workspace_id = p_workspace_id AND user_id = v_target) THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'SB052';
  END IF;
  IF p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on
     OR p_ends_on > p_starts_on + 366 OR p_ends_on < current_date THEN
    RAISE EXCEPTION 'choose dates that end today or later and last no more than a year' USING ERRCODE = '22023';
  END IF;
  IF p_delegate_user_id IS NOT NULL AND (
       p_delegate_user_id = v_target
       OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
                       WHERE m.workspace_id = p_workspace_id AND m.user_id = p_delegate_user_id
                         AND m.suspended_at IS NULL
                         AND m.role NOT IN ('viewer', 'client_viewer'))) THEN
    RAISE EXCEPTION 'the colleague covering must be an active member who can do work' USING ERRCODE = '22023';
  END IF;

  -- One absence at a time: a new one replaces any that has not finished.
  UPDATE api.member_absences
     SET cancelled_at = now()
   WHERE workspace_id = p_workspace_id AND user_id = v_target
     AND cancelled_at IS NULL AND ends_on >= current_date;

  INSERT INTO api.member_absences
    (workspace_id, user_id, starts_on, ends_on, delegate_user_id, note, created_by_user_id)
  VALUES (p_workspace_id, v_target, p_starts_on, p_ends_on, p_delegate_user_id,
          nullif(btrim(coalesce(p_note, '')), ''), v_actor)
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(
    p_workspace_id, 'member_absence', v_row.id, 'create', NULL, NULL,
    jsonb_build_object('action', 'absence-set', 'userId', v_target,
                       'startsOn', p_starts_on, 'endsOn', p_ends_on,
                       'delegateUserId', p_delegate_user_id));
  PERFORM internal.sync_absence_cover(p_workspace_id);
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_member_absence(uuid, date, date, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_member_absence(uuid, date, date, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_member_absence(uuid, date, date, text, text, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.cancel_member_absence(p_absence_id uuid) RETURNS api.member_absences
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_row api.member_absences;
BEGIN
  SELECT * INTO v_row FROM api.member_absences WHERE id = p_absence_id FOR UPDATE;
  IF v_actor IS NULL OR v_row.id IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT (v_row.user_id = v_actor
             OR api.has_settings_access(v_row.workspace_id, 'members', 'manage')) THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF v_row.cancelled_at IS NULL THEN
    UPDATE api.member_absences SET cancelled_at = now() WHERE id = v_row.id RETURNING * INTO v_row;
    PERFORM internal.emit_change_event(
      v_row.workspace_id, 'member_absence', v_row.id, 'update', NULL, NULL,
      jsonb_build_object('action', 'absence-cancelled', 'userId', v_row.user_id));
    PERFORM internal.sync_absence_cover(v_row.workspace_id);
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_member_absence(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_member_absence(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_member_absence(uuid) TO authenticated;
--> statement-breakpoint

-- The Inbox says whom a covered review is for.
ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_pre_cover;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT w.kind, w.record_id, w.identifier, w.title, w.project_id,
        CASE
          WHEN w.kind = 'review_requested' AND cover.absent_name IS NOT NULL
            THEN 'Covering for ' || cover.absent_name
          ELSE w.reason
        END AS reason,
        w.due_at, w.state, w.created_at,
        w.source_type, w.source_id, w.parser_version_id, w.connector_id, w.revision_id,
        w.dataset_id, w.row_id, w.field_id
   FROM internal.my_work_items_pre_cover w
   LEFT JOIN LATERAL (
        SELECT u.name AS absent_name
          FROM api.review_cover c
          JOIN api.review_submissions s ON s.id = c.submission_id
          JOIN internal."user" u ON u.id = c.absent_user_id
         WHERE c.delegate_user_id = api.current_user_id()
           AND c.ended_at IS NULL
           AND s.record_id = w.record_id
           AND s.state = 'submitted'
         ORDER BY c.created_at DESC
         LIMIT 1) cover ON w.kind = 'review_requested';
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_pre_cover TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker='true') AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_all
  WHERE NOT internal.inbox_kind_muted(kind);
