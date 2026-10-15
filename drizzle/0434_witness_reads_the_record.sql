-- REV-03 — a witness must be able to read the record they are asked to witness.
--
-- api.request_signature_witness has required current project View on the named
-- witness since SET-02 (0325), but project View is not read authority. The
-- RESTRICTIVE policy records_draft_experiment_private (0391) keeps a draft
-- experiment readable only by its creator and by workspace owners, so a
-- workspace admin holding an explicit View rule still reads zero rows: the
-- request that RPC accepted was a dead end that never reached the witness's
-- inbox, and the witness could not open the record at all.
--
-- internal.record_readable_by answers the read question for a named person by
-- applying the same predicates the RLS policies apply to api.records for that
-- person: the permissive membership policy, records_live_read, and
-- records_draft_experiment_private. Both the request RPC and the picker's
-- candidate list read it, so the refusal the UI states before the call is the
-- refusal the server enforces.

-- The mirror below is only honest while the policy still says this. A future
-- change to draft-experiment privacy must fail here, loudly, instead of
-- leaving behind a witness rule that no longer describes the read it stands
-- for — which is exactly how the dead end this migration removes came about.
DO $$
DECLARE restrictive boolean; predicate text;
BEGIN
  SELECT NOT policy.polpermissive, pg_get_expr(policy.polqual, policy.polrelid)
    INTO restrictive, predicate
    FROM pg_policy policy
   WHERE policy.polname = 'records_draft_experiment_private';
  IF predicate IS NULL OR NOT restrictive
     OR strpos(predicate, '''draft''') = 0
     OR strpos(predicate, 'created_by_user_id') = 0
     OR strpos(predicate, 'workspace.admin') = 0 THEN
    RAISE EXCEPTION
      'records_draft_experiment_private no longer matches internal.record_readable_by'
      USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION internal.record_readable_by(p_record_id uuid, p_user_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM api.records record
      JOIN api.workspace_memberships membership
        ON membership.workspace_id = record.workspace_id
       AND membership.user_id = p_user_id
       AND membership.suspended_at IS NULL
       AND membership.role <> 'client_viewer'
      CROSS JOIN LATERAL internal.project_permissions_for(record.project_id, p_user_id) permissions
     WHERE record.id = p_record_id
       AND record.workspace_id = api.current_workspace_id()
       -- records_live_read: an unparented record needs no project grant.
       AND (record.project_id IS NULL OR permissions.can_view)
       -- records_draft_experiment_private: workspace.admin is the owner role.
       AND (NOT (record.kind = 'experiment' AND record.status = 'draft')
            OR record.created_by_user_id = p_user_id
            OR membership.role = 'owner')
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_readable_by(uuid, text) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

-- The existing eligibility check is kept exactly as SET-02 left it (the caller
-- must hold View, and the witness must hold View), and the witness's read
-- authority is added after it: a witness who cannot read the record is refused
-- before any request row, work item, notification or change event exists, so
-- nothing about the record reaches them. The caller check stays first, so a
-- caller who cannot read the record gets the same refusal as a foreign
-- submission and learns nothing about it.
CREATE OR REPLACE FUNCTION api.request_signature_witness(p_submission_id uuid, p_witness_user_id text, p_expected_revision_digest text, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s api.review_submissions; r api.revisions; q api.signature_witness_requests;
  w uuid:=api.current_workspace_id(); a text:=api.current_user_id(); session_id text:=api.claim_probe()->>'session_id';
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' OR NOT api.is_workspace_writer(w)
    OR NOT EXISTS(SELECT 1 FROM internal.session WHERE id=session_id AND "userId"=a AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'human witness request denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM api.review_submissions WHERE id=p_submission_id AND workspace_id=w FOR UPDATE;
  IF s.id IS NULL OR s.state NOT IN('submitted','approved') OR (a<>s.submitted_by_user_id AND NOT(a=ANY(s.assigned_reviewer_user_ids))) THEN
    RAISE EXCEPTION 'only author or assigned reviewer may request a witness' USING ERRCODE='42501';
  END IF;
  SELECT * INTO r FROM api.revisions WHERE id=s.revision_id AND workspace_id=w;
  IF r.superseded_by_revision_id IS NOT NULL OR p_expected_revision_digest IS DISTINCT FROM r.integrity_digest THEN
    RAISE EXCEPTION 'witness request digest mismatch' USING ERRCODE='SB001';
  END IF;
  IF p_witness_user_id=s.submitted_by_user_id OR p_witness_user_id=a OR NOT EXISTS(
    SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=w AND m.user_id=p_witness_user_id
      AND m.suspended_at IS NULL AND m.role IN('owner','admin','member','editor','reviewer','steward')) THEN
    RAISE EXCEPTION 'witness must be another permitted human member' USING ERRCODE='42501';
  END IF;
  IF NOT internal.can_access_object('record',s.record_id,'view') OR NOT (SELECT permissions.can_view FROM api.records record CROSS JOIN LATERAL internal.project_permissions_for(record.project_id,p_witness_user_id) permissions WHERE record.id=s.record_id) THEN RAISE EXCEPTION 'Witness requires current project View' USING ERRCODE='42501'; END IF;
  IF NOT internal.record_readable_by(s.record_id,p_witness_user_id) THEN
    RAISE EXCEPTION 'witness cannot read this record' USING ERRCODE='42501';
  END IF;
  SELECT * INTO q FROM api.signature_witness_requests WHERE submission_id=s.id AND witness_user_id=p_witness_user_id;
  IF q.id IS NOT NULL THEN
    IF q.revision_digest IS DISTINCT FROM p_expected_revision_digest OR q.due_at IS DISTINCT FROM p_due_at THEN
      RAISE EXCEPTION 'witness request already has different arguments' USING ERRCODE='23505';
    END IF;
  ELSE
    INSERT INTO api.signature_witness_requests(workspace_id,submission_id,revision_digest,witness_user_id,
      requested_by_user_id,requested_session_id,due_at) VALUES(w,s.id,r.integrity_digest,p_witness_user_id,a,session_id,p_due_at) RETURNING * INTO q;
    PERFORM internal.emit_change_event(w,'review_submission',s.id,'update',s.record_id,
      (SELECT project_id FROM api.records WHERE id=s.record_id),jsonb_build_object('action','witness-requested','requestId',q.id,'witnessUserId',p_witness_user_id,'submissionId',s.id,'revisionId',r.id));
  END IF;
  RETURN jsonb_build_object('id',q.id,'submissionId',s.id,'revisionId',r.id,'witnessUserId',p_witness_user_id);
END $function$;
--> statement-breakpoint

-- The picker pre-checks that same rule, so the refusal is stated before the
-- call. Scope is unchanged from SET-02's project_members-based list: active
-- human members of the project the record belongs to, with View, minus the
-- requester and the author. `can_read_record` is the server's answer for each
-- of them, so the picker never states a reason the request would not enforce.
CREATE FUNCTION api.signature_witness_candidates(p_submission_id uuid)
RETURNS TABLE(user_id text, name text, workspace_role text, can_read_record boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE s api.review_submissions;
  w uuid := api.current_workspace_id();
  a text := api.current_user_id();
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'human witness request denied' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM api.review_submissions WHERE id = p_submission_id AND workspace_id = w;
  IF s.id IS NULL OR (a <> s.submitted_by_user_id AND NOT (a = ANY (s.assigned_reviewer_user_ids))) THEN
    RAISE EXCEPTION 'only author or assigned reviewer may request a witness' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
    SELECT membership.user_id, member.name, membership.role,
           internal.record_readable_by(s.record_id, membership.user_id)
      FROM api.review_submissions submission
      JOIN api.records record ON record.id = submission.record_id
      JOIN api.projects project ON project.id = record.project_id
      JOIN api.workspace_memberships membership
        ON membership.workspace_id = w AND membership.suspended_at IS NULL
      JOIN internal."user" member ON member.id = membership.user_id
      CROSS JOIN LATERAL internal.project_permissions_for(project.id, membership.user_id) permissions
     WHERE submission.id = s.id
       AND membership.role IN ('owner','admin','member','editor','reviewer','steward')
       AND membership.user_id <> a
       AND membership.user_id <> s.submitted_by_user_id
       AND permissions.can_view
     ORDER BY member.name;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.signature_witness_candidates(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.signature_witness_candidates(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
