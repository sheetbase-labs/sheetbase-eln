-- Approvals for personal tokens (scope reviews:write): approve or return an
-- approval request, approve / reject / ask for changes on a review.
-- A token acts as the person it belongs to, and every existing rule still
-- applies (assigned reviewer, approver role, independence, counts).
-- In a regulated lab a token may not decide: these stay with a signed-in session.
-- Signing is not touched: it still needs a fresh password check in the app.

CREATE OR REPLACE FUNCTION api.approve_approval_request(p_request_id uuid, p_reason text DEFAULT NULL::text) RETURNS api.approval_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
  v_approved_count integer;
  v_uncovered integer;
  v_technical_done boolean;
BEGIN
  IF internal.is_regulated_lab(api.current_workspace_id())
     AND coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'in a regulated lab an approval is made in the app' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL OR v_actor IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be approved' USING ERRCODE = 'SB086';
  END IF;
  SELECT m.role INTO v_role FROM api.workspace_memberships m
   WHERE m.workspace_id = v_row.workspace_id AND m.user_id = v_actor AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY(v_row.required_approver_roles)) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.require_independence AND v_row.submitted_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'an approver cannot approve their own submission' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM api.approval_request_decisions d
    WHERE d.request_id = v_row.id AND d.user_id = v_actor AND d.decision = 'approved') THEN
    RAISE EXCEPTION 'already approved by this approver' USING ERRCODE = 'SB086';
  END IF;
  -- Protocol chain: technical review (scientist/steward) must precede QA
  -- (reviewer/admin/owner).
  IF v_row.object_kind = 'protocol_revision'
    AND v_role IN ('reviewer', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM api.approval_request_decisions d
      WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role IN ('scientist', 'steward')) THEN
    RAISE EXCEPTION 'technical review must precede QA approval' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.approval_request_decisions(request_id, workspace_id, user_id, role, decision, reason)
  VALUES (v_row.id, v_row.workspace_id, v_actor, v_role, 'approved', nullif(btrim(coalesce(p_reason, '')), ''));
  SELECT count(DISTINCT d.user_id) INTO v_approved_count
    FROM api.approval_request_decisions d WHERE d.request_id = v_row.id AND d.decision = 'approved';
  IF v_row.object_kind = 'record_model_version' THEN
    SELECT count(*) INTO v_uncovered FROM unnest(v_row.required_approver_roles) AS required_role
     WHERE NOT EXISTS (SELECT 1 FROM api.approval_request_decisions d
        WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role = required_role);
  ELSE
    v_uncovered := 0;
  END IF;
  IF v_row.object_kind = 'protocol_revision' THEN
    SELECT EXISTS (SELECT 1 FROM api.approval_request_decisions d
      WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role IN ('scientist', 'steward')) INTO v_technical_done;
    IF NOT v_technical_done THEN v_uncovered := 1; END IF;
  END IF;
  IF v_approved_count >= v_row.required_approvals AND v_uncovered = 0 THEN
    UPDATE api.approval_requests
       SET state = 'approved', approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor],
           decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           decided_by_user_id = v_actor, decided_at = now(), updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
    IF v_row.object_kind = 'pipeline_definition_version' THEN
      PERFORM internal.publish_pipeline_definition_version(v_row.object_id, v_row.object_revision, v_row.submitted_by_user_id);
    END IF;
  ELSE
    UPDATE api.approval_requests
       SET approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor], updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.approve_approval_request(p_request_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.return_approval_request(p_request_id uuid, p_reason text) RETURNS api.approval_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
BEGIN
  IF internal.is_regulated_lab(api.current_workspace_id())
     AND coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'in a regulated lab an approval is made in the app' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL
     OR v_actor IS NULL
     OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be returned' USING ERRCODE = 'SB086';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a return reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT m.role INTO v_role
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v_row.workspace_id
     AND m.user_id = v_actor
     AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY(v_row.required_approver_roles)) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.require_independence
     AND v_row.submitted_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'an approver cannot return their own submission' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.approval_request_decisions(
    request_id, workspace_id, user_id, role, decision, reason
  ) VALUES (
    v_row.id, v_row.workspace_id, v_actor, v_role, 'returned', btrim(p_reason)
  );
  UPDATE api.approval_requests
     SET state = 'returned',
         decision_reason = btrim(p_reason),
         decided_by_user_id = v_actor,
         decided_at = now(),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.return_approval_request(p_request_id uuid, p_reason text) OWNER TO migrator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.lock_review_for_decision(p_submission_id uuid, p_expected_state text, p_expected_revision_digest text, p_required_decision text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
  -- A personal token (reviews:write) decides as its owner, recorded under the
  -- token's own id. In a regulated lab a decision needs a signed-in session.
  IF v_session IS NULL AND nullif(v_claims->>'credential_id', '') IS NOT NULL
     AND NOT internal.is_regulated_lab(v_workspace) THEN
    v_session := 'token:' || (v_claims->>'credential_id');
  END IF;
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
 PERFORM internal.assert_object_access('record',v_submission.record_id,CASE WHEN p_required_decision='withdraw' THEN 'edit' ELSE 'review' END);

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
$_$;
--> statement-breakpoint
ALTER FUNCTION internal.lock_review_for_decision(p_submission_id uuid, p_expected_state text, p_expected_revision_digest text, p_required_decision text) OWNER TO migrator;
