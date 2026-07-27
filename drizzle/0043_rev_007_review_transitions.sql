-- REV-007: review transitions and the Review & Approvals workspace.
--
-- Widens api.review_submissions.state so a submission can move out of
-- 'submitted' through controlled SECURITY DEFINER RPCs, and adds an
-- append-only api.review_decisions audit table that records every
-- request-changes / reject / approve / withdraw decision with actor,
-- session, role, the revision integrity digest the actor was acting on,
-- and an optional note. Request roles get SELECT on review_decisions and
-- EXECUTE on the four transition RPCs and nothing else — no direct
-- UPDATE on review_submissions is granted, so only the migrator-owned
-- SECURITY DEFINER RPCs can change a submission's state.
--
-- Guards enforced by every transition RPC (defence-in-depth, UI mirrors
-- these so the workspace never offers an action it cannot honour):
--   * workspace membership (claim_probe + is_workspace_member)
--   * submission belongs to the claimed workspace
--   * submission.state = 'submitted' and p_expected_state matches
--     → prevents actions against a withdrawn / already-completed review
--   * the pinned revision is not superseded (superseded_by_revision_id
--     IS NULL) → prevents stale actions against a superseded revision
--   * the revision integrity digest matches p_expected_revision_digest
--     → prevents a stale-action race between view and action
--   * actor is an assigned reviewer for request_changes / reject /
--     approve, or the original submitter for withdraw
--     → permission boundary for collaborative review

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'comment',
    'review_submission'
  ));
--> statement-breakpoint

ALTER TABLE "api"."review_submissions" DROP CONSTRAINT "chk_review_submissions_state";
--> statement-breakpoint
ALTER TABLE "api"."review_submissions" ADD CONSTRAINT "chk_review_submissions_state"
  CHECK (state IN ('submitted', 'returned', 'rejected', 'approved', 'withdrawn'));
--> statement-breakpoint

CREATE TABLE "api"."review_decisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL
    REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  "submission_id" uuid NOT NULL
    REFERENCES "api"."review_submissions"("id") ON DELETE RESTRICT,
  "revision_id" uuid NOT NULL
    REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "record_id" uuid NOT NULL
    REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  -- request_changes | reject | approve | withdraw
  "decision" text NOT NULL,
  "note" text,
  -- The digest of the revision the actor was acting on, pinned so a
  -- later superseding revision cannot retroactively change what was
  -- decided. Matches api.revisions.integrity_digest at decision time.
  "revision_integrity_digest" text NOT NULL,
  "actor_user_id" text NOT NULL
    REFERENCES "internal"."user"("id") ON DELETE RESTRICT,
  "actor_session_id" text NOT NULL,
  "actor_role" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_review_decisions_decision"
    CHECK (decision IN ('request_changes', 'reject', 'approve', 'withdraw')),
  CONSTRAINT "chk_review_decisions_note"
    CHECK (note IS NULL OR length(note) BETWEEN 1 AND 8000),
  CONSTRAINT "chk_review_decisions_digest"
    CHECK (revision_integrity_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint

CREATE INDEX "idx_review_decisions_submission"
  ON "api"."review_decisions" ("submission_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_review_decisions_workspace_created"
  ON "api"."review_decisions" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_review_decisions_record"
  ON "api"."review_decisions" ("record_id", "created_at");
--> statement-breakpoint

ALTER TABLE "api"."review_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "review_decisions_select" ON "api"."review_decisions"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );
--> statement-breakpoint

GRANT SELECT ON "api"."review_decisions" TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Shared guard + record helper for the four transition RPCs. Validates the
-- actor, locks the submission, enforces the active / not-superseded /
-- digest-match / permission rules, and returns the locked row. SECURITY
-- DEFINER (migrator-owned) so it can read the submission and revision
-- regardless of caller role; not executable by request roles.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."lock_review_for_decision"(
  p_submission_id uuid,
  p_expected_state text,
  p_expected_revision_digest text,
  p_required_decision text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_actor text;
  v_session text;
  v_role text;
  v_submission api.review_submissions;
  v_revision api.revisions;
  v_record_project uuid;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  v_actor := nullif(v_claims->>'sub', '');
  v_session := nullif(v_claims->>'session_id', '');
  v_role := nullif(v_claims->>'role', '');
  IF v_workspace IS NULL OR v_actor IS NULL OR v_session IS NULL
     OR v_role <> 'authenticated'
     OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission FROM api.review_submissions
  WHERE id = p_submission_id AND workspace_id = v_workspace
  FOR UPDATE;
  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- Active-state guard: only a 'submitted' review can transition. This is
  -- the single check that prevents actions against a withdrawn or
  -- already-completed (approved / rejected / returned) review.
  IF v_submission.state <> 'submitted' THEN
    RAISE EXCEPTION 'review is not active' USING ERRCODE = 'SB004';
  END IF;
  -- Stale-view guard: the actor's expected state must match the current
  -- state, so a concurrent transition surfaces as a recoverable error
  -- rather than a silent second decision.
  IF p_expected_state IS NOT NULL AND p_expected_state <> v_submission.state THEN
    RAISE EXCEPTION 'review state changed' USING ERRCODE = 'SB005';
  END IF;

  SELECT * INTO v_revision FROM api.revisions
  WHERE id = v_submission.revision_id AND workspace_id = v_workspace;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  -- Superseded guard: a revision that has been superseded cannot be
  -- approved, rejected or returned — the superseding revision is the
  -- active subject of review.
  IF v_revision.superseded_by_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'revision is superseded' USING ERRCODE = 'SB006';
  END IF;
  -- Digest guard: the actor confirms the digest of the revision they
  -- viewed. The revision is immutable, so a mismatch means the actor's
  -- client was looking at a different (e.g. superseded) revision.
  IF p_expected_revision_digest IS NULL
     OR p_expected_revision_digest !~ '^[0-9a-f]{64}$'
     OR p_expected_revision_digest <> v_revision.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE = 'SB001';
  END IF;

  -- Permission boundary: review decisions require an assigned reviewer;
  -- withdraw is reserved for the original submitter.
  IF p_required_decision = 'withdraw' THEN
    IF v_submission.submitted_by_user_id <> v_actor THEN
      RAISE EXCEPTION 'only the submitter may withdraw' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM unnest(v_submission.assigned_reviewer_user_ids) reviewer
      WHERE reviewer = v_actor
    ) THEN
      RAISE EXCEPTION 'only an assigned reviewer may decide' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT project_id INTO v_record_project FROM api.records
  WHERE id = v_submission.record_id;

  RETURN jsonb_build_object(
    'workspace_id', v_workspace,
    'actor', v_actor,
    'session', v_session,
    'role', v_role,
    'submission', to_jsonb(v_submission),
    'revision', to_jsonb(v_revision),
    'record_project', v_record_project
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."lock_review_for_decision"(uuid, text, text, text)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- apply_review_decision: records the decision, transitions the submission
-- state, and emits a durable change event. Shared by the four public RPCs
-- so the transition logic lives in one place. SECURITY DEFINER, not
-- executable by request roles.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "internal"."apply_review_decision"(
  p_submission_id uuid,
  p_decision text,
  p_next_state text,
  p_note text,
  p_expected_state text,
  p_expected_revision_digest text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_lock jsonb;
  v_submission api.review_submissions;
  v_revision api.revisions;
  v_workspace uuid;
  v_actor text;
  v_session text;
  v_role text;
  v_record_project uuid;
  v_decision_id uuid;
  v_decided_at timestamptz := clock_timestamp();
BEGIN
  v_lock := internal.lock_review_for_decision(
    p_submission_id, p_expected_state, p_expected_revision_digest, p_decision
  );
  v_workspace := (v_lock->>'workspace_id')::uuid;
  v_actor := v_lock->>'actor';
  v_session := v_lock->>'session';
  v_role := v_lock->>'role';
  SELECT * INTO v_submission FROM jsonb_populate_record(NULL::api.review_submissions, v_lock->'submission');
  SELECT * INTO v_revision FROM jsonb_populate_record(NULL::api.revisions, v_lock->'revision');
  v_record_project := nullif(v_lock->>'record_project', '')::uuid;

  v_decision_id := gen_random_uuid();
  INSERT INTO api.review_decisions (
    id, workspace_id, submission_id, revision_id, record_id,
    decision, note, revision_integrity_digest,
    actor_user_id, actor_session_id, actor_role, created_at
  ) VALUES (
    v_decision_id, v_workspace, v_submission.id, v_revision.id, v_submission.record_id,
    p_decision, p_note, v_revision.integrity_digest,
    v_actor, v_session, v_role, v_decided_at
  );

  UPDATE api.review_submissions
  SET state = p_next_state, updated_at = v_decided_at
  WHERE id = v_submission.id;

  PERFORM internal.emit_change_event(
    v_workspace, 'review_submission', v_submission.id, 'update',
    v_submission.record_id, v_record_project,
    jsonb_build_object(
      'submissionId', v_submission.id, 'revisionId', v_revision.id,
      'decision', p_decision, 'nextState', p_next_state,
      'decisionId', v_decision_id, 'actorUserId', v_actor
    )
  );

  RETURN jsonb_build_object(
    'submissionId', v_submission.id,
    'revisionId', v_revision.id,
    'decision', p_decision,
    'state', p_next_state,
    'decisionId', v_decision_id,
    'createdAt', v_decided_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."apply_review_decision"(uuid, text, text, text, text, text)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Public transition RPCs. Each is a thin wrapper around
-- internal.apply_review_decision so the public surface is small and the
-- guard + transition logic stays in one place.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."request_changes_on_review"(
  p_submission_id uuid,
  p_note text DEFAULT NULL,
  p_expected_state text DEFAULT 'submitted',
  p_expected_revision_digest text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN internal.apply_review_decision(
    p_submission_id, 'request_changes', 'returned',
    p_note, p_expected_state, p_expected_revision_digest
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."request_changes_on_review"(uuid, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."request_changes_on_review"(uuid, text, text, text)
  TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."reject_review"(
  p_submission_id uuid,
  p_note text DEFAULT NULL,
  p_expected_state text DEFAULT 'submitted',
  p_expected_revision_digest text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN internal.apply_review_decision(
    p_submission_id, 'reject', 'rejected',
    p_note, p_expected_state, p_expected_revision_digest
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."reject_review"(uuid, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."reject_review"(uuid, text, text, text)
  TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."approve_review"(
  p_submission_id uuid,
  p_note text DEFAULT NULL,
  p_expected_state text DEFAULT 'submitted',
  p_expected_revision_digest text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN internal.apply_review_decision(
    p_submission_id, 'approve', 'approved',
    p_note, p_expected_state, p_expected_revision_digest
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."approve_review"(uuid, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."approve_review"(uuid, text, text, text)
  TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."withdraw_review"(
  p_submission_id uuid,
  p_note text DEFAULT NULL,
  p_expected_state text DEFAULT 'submitted',
  p_expected_revision_digest text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN internal.apply_review_decision(
    p_submission_id, 'withdraw', 'withdrawn',
    p_note, p_expected_state, p_expected_revision_digest
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."withdraw_review"(uuid, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."withdraw_review"(uuid, text, text, text)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
