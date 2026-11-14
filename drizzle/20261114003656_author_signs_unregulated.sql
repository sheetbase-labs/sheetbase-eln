-- When Regulated lab is off, the author may sign their own record (as an assigned reviewer),
-- and the audit event says it was a self-signature. Regulated labs keep the nonauthor rule.
CREATE OR REPLACE FUNCTION internal.assert_signature_target(p_submission uuid, p_meaning text, p_digest text) RETURNS api.review_submissions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE s api.review_submissions; r api.revisions; c api.review_check_results;
  w uuid:=api.current_workspace_id(); a text:=api.current_user_id(); session_id text:=api.claim_probe()->>'session_id';
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' OR NOT api.is_workspace_writer(w)
    OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=w AND user_id=a AND suspended_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM internal.session WHERE id=session_id AND "userId"=a AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'valid human signing session required' USING ERRCODE='42501';
  END IF;
  IF p_meaning IS NULL OR p_meaning NOT IN('reviewed','reviewed-and-approved','witnessed') THEN
    RAISE EXCEPTION 'invalid post-submission signature meaning' USING ERRCODE='22023';
  END IF;
  SELECT * INTO s FROM api.review_submissions WHERE id=p_submission AND workspace_id=w;
  IF s.id IS NULL THEN RAISE EXCEPTION 'record denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM api.revisions WHERE id=s.revision_id AND workspace_id=w;
  IF r.id IS NULL THEN RAISE EXCEPTION 'record denied' USING ERRCODE='42501'; END IF;
  IF r.superseded_by_revision_id IS NOT NULL THEN RAISE EXCEPTION 'revision is superseded' USING ERRCODE='SB006'; END IF;
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR p_digest<>r.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE='SB001';
  END IF;
  IF s.state NOT IN('submitted','approved') OR (p_meaning='reviewed-and-approved' AND s.state<>'approved') THEN
    RAISE EXCEPTION 'review state does not support this meaning' USING ERRCODE='SB007';
  END IF;
  IF p_meaning IN('reviewed','reviewed-and-approved') THEN
 IF NOT internal.can_access_object('submission',p_submission,'review') THEN RAISE EXCEPTION 'Explicit Review rule required' USING ERRCODE='42501'; END IF;
    -- A lab that is not regulated may let the author sign their own record when they are an
    -- assigned reviewer, so a one-person lab is not stuck. A regulated lab keeps the rule.
    IF NOT(a=ANY(s.assigned_reviewer_user_ids))
      OR (a=s.submitted_by_user_id AND internal.is_regulated_lab(w)) THEN
      RAISE EXCEPTION 'only an assigned nonauthor reviewer may sign' USING ERRCODE='42501';
    END IF;
  ELSIF a=s.submitted_by_user_id OR NOT EXISTS(SELECT 1 FROM api.signature_witness_requests q
    WHERE q.submission_id=s.id AND q.workspace_id=w AND q.witness_user_id=a AND q.revision_digest=r.integrity_digest) THEN
    RAISE EXCEPTION 'an explicit nonauthor witness request is required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM api.review_check_results WHERE revision_id=r.id AND workspace_id=w ORDER BY run_at DESC LIMIT 1;
  IF c.id IS NULL OR c.blocking_failure_count>0 OR c.overall_status='fail'
    OR c.revision_integrity_digest<>r.integrity_digest THEN
    RAISE EXCEPTION 'required checks have not passed for this digest' USING ERRCODE='SB008';
  END IF;
  RETURN s;
END $_$;;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.record_revision_signature(p_submission uuid, p_actor text, p_session text, p_meaning text, p_confirmation text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE s api.review_submissions; r api.revisions; sig api.signatures; n text; project uuid;
BEGIN
  SELECT * INTO STRICT s FROM api.review_submissions WHERE id=p_submission;
  SELECT * INTO STRICT r FROM api.revisions WHERE id=s.revision_id;
  IF r.integrity_digest IS DISTINCT FROM internal.revision_integrity_digest(r.canonical_snapshot) THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE='SB001';
  END IF;
  SELECT name INTO n FROM internal."user" WHERE id=p_actor;
  IF n IS NULL OR btrim(lower(p_confirmation)) IS DISTINCT FROM btrim(lower(n)) THEN
    RAISE EXCEPTION 'confirmation phrase does not match signer name' USING ERRCODE='SB009';
  END IF;
  INSERT INTO api.signatures(workspace_id,submission_id,revision_id,record_id,signature_meaning,
    assurance_level,revision_integrity_digest,signer_user_id,signer_name,signer_session_id,
    signer_role,auth_method,confirmation_phrase,signed_at,created_at)
    VALUES(s.workspace_id,s.id,r.id,s.record_id,p_meaning,'standard',r.integrity_digest,
      p_actor,n,p_session,'authenticated','password',p_confirmation,clock_timestamp(),clock_timestamp()) RETURNING * INTO sig;
  SELECT project_id INTO project FROM api.records WHERE id=s.record_id;
  PERFORM internal.emit_change_event(s.workspace_id,'signature',sig.id,'create',s.record_id,project,
    jsonb_build_object('signatureId',sig.id,'submissionId',s.id,'revisionId',r.id,
      'signerUserId',p_actor,'selfSignature',p_actor=s.submitted_by_user_id,'signatureMeaning',p_meaning,'assuranceLevel','standard','authMethod','password'));
  RETURN jsonb_build_object('signatureId',sig.id,'submissionId',s.id,'revisionId',r.id,
    'signatureMeaning',p_meaning,'assuranceLevel','standard','signedAt',sig.signed_at);
END $$;;
