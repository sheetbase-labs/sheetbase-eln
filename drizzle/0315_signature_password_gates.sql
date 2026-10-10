-- REV-03: request roles cannot mint password evidence or change failure counts.
REVOKE ALL ON internal.signature_grants, internal.signature_password_attempts,
  internal.signature_authentication_events FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
CREATE FUNCTION internal.signature_identity(p_workspace uuid, p_actor text, p_session text)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c api.user_signature_certifications;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships
    WHERE workspace_id=p_workspace AND user_id=p_actor AND suspended_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM internal.session
    WHERE id=p_session AND "userId"=p_actor AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'valid signing session required' USING ERRCODE='SB002';
  END IF;
  SELECT * INTO c FROM api.user_signature_certifications
    WHERE workspace_id=p_workspace AND user_id=p_actor FOR UPDATE;
  IF c.identity_verified_by IS NULL OR c.identity_verified_by=p_actor
    OR c.identity_verified_at IS NULL OR c.verified_email IS DISTINCT FROM
      (SELECT email FROM internal."user" WHERE id=p_actor) THEN
    RAISE EXCEPTION 'independent identity verification required' USING ERRCODE='42501';
  END IF;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION internal.signature_identity(uuid,text,text) FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
CREATE FUNCTION internal.consume_signature_grant(p_token text, p_purpose text,
  p_workspace uuid, p_actor text, p_session text, p_submission uuid DEFAULT NULL,
  p_digest text DEFAULT NULL)
RETURNS internal.signature_grants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g internal.signature_grants; c api.user_signature_certifications;
BEGIN
  -- Lock certification before the grant, matching issuance and withdrawal.
  c := internal.signature_identity(p_workspace,p_actor,p_session);
  IF p_purpose IN ('sign','practice') AND
    (c.certified_at IS NULL OR c.revoked_at IS NOT NULL OR c.statement_version<>1
     OR c.auth_method IS DISTINCT FROM 'password') THEN
    RAISE EXCEPTION 'current signature certification required' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT 1 FROM internal.signature_password_attempts
    WHERE user_id=p_actor AND locked_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'signing password locked' USING ERRCODE='SB002';
  END IF;
  SELECT * INTO g FROM internal.signature_grants
    WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
  IF g.token_hash IS NULL OR g.user_id IS DISTINCT FROM p_actor
    OR g.workspace_id IS DISTINCT FROM p_workspace OR g.session_id IS DISTINCT FROM p_session
    OR g.purpose IS DISTINCT FROM p_purpose OR g.consumed_at IS NOT NULL
    OR g.expires_at<=clock_timestamp() OR g.auth_method<>'password'
    OR g.submission_id IS DISTINCT FROM p_submission
    OR g.revision_digest IS DISTINCT FROM p_digest THEN
    RAISE EXCEPTION 'fresh password token required' USING ERRCODE='SB002';
  END IF;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp() WHERE token_hash=g.token_hash;
  RETURN g;
END $$;
REVOKE ALL ON FUNCTION internal.consume_signature_grant(text,text,uuid,text,text,uuid,text)
  FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
CREATE FUNCTION api.request_signature_identity_verification()
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid:=api.current_workspace_id(); a text:=api.current_user_id();
  s text:=api.claim_probe()->>'session_id'; c api.user_signature_certifications;
BEGIN
  -- Own-row operation: membership is checked directly, never a writer shortcut.
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id=w AND user_id=a AND suspended_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM internal.session
      WHERE id=s AND "userId"=a AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'valid workspace session required' USING ERRCODE='42501';
  END IF;
  INSERT INTO api.user_signature_certifications(workspace_id,user_id,credential_session_id,revoked_at)
    VALUES(w,a,s,clock_timestamp())
    ON CONFLICT(workspace_id,user_id) DO UPDATE SET credential_session_id=s,
      identity_verified_by=NULL,identity_verified_at=NULL,verified_email=NULL,
      credential_authorization_id=NULL,credential_authorization_consumed_at=NULL,
      revoked_at=clock_timestamp()
    RETURNING * INTO c;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
    WHERE user_id=a AND consumed_at IS NULL;
  INSERT INTO internal.signature_authentication_events(workspace_id,user_id,session_id,event)
    VALUES(w,a,s,'identity-verification-requested');
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION api.request_signature_identity_verification() FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.request_signature_identity_verification() TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.verify_signature_identity(p_user_id text,p_email text)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid:=api.current_workspace_id(); a text:=api.current_user_id();
  s text:=api.claim_probe()->>'session_id'; c api.user_signature_certifications;
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' OR a=p_user_id
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id=w AND user_id=a AND suspended_at IS NULL AND role IN ('owner','admin'))
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id=w AND user_id=p_user_id AND suspended_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM internal.session
      WHERE id=s AND "userId"=a AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'independent active administrator required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO c FROM api.user_signature_certifications
    WHERE workspace_id=w AND user_id=p_user_id FOR UPDATE;
  IF c.id IS NULL OR c.credential_session_id IS NULL OR
    NOT EXISTS (SELECT 1 FROM internal.session WHERE id=c.credential_session_id
      AND "userId"=p_user_id AND "expiresAt">clock_timestamp())
    OR p_email IS NULL OR p_email IS DISTINCT FROM
      (SELECT email FROM internal."user" WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'current requested session and verified email required' USING ERRCODE='22023';
  END IF;
  UPDATE api.user_signature_certifications SET identity_verified_by=a,
    identity_verified_at=clock_timestamp(),verified_email=p_email,
    credential_authorization_id=gen_random_uuid(),credential_authorization_consumed_at=NULL,
    revoked_at=clock_timestamp() WHERE id=c.id RETURNING * INTO c;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp()
    WHERE user_id=p_user_id AND consumed_at IS NULL;
  INSERT INTO internal.signature_authentication_events(workspace_id,user_id,session_id,event)
    VALUES(w,p_user_id,c.credential_session_id,'identity-verified');
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION api.verify_signature_identity(text,text) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.verify_signature_identity(text,text) TO authenticated;
--> statement-breakpoint
DROP FUNCTION api.certify_signature(uuid,integer);
CREATE FUNCTION api.certify_signature(p_workspace_id uuid,p_statement_version integer,p_signing_token text DEFAULT NULL)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c api.user_signature_certifications; a text:=api.current_user_id();
  s text:=api.claim_probe()->>'session_id';
BEGIN
  IF p_statement_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'invalid statement version' USING ERRCODE='22023';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'workspace denied' USING ERRCODE='42501';
  END IF;
  PERFORM internal.consume_signature_grant(p_signing_token,'certify',p_workspace_id,a,s);
  UPDATE api.user_signature_certifications SET certified_at=clock_timestamp(),
    statement_version=p_statement_version,revoked_at=NULL,certified_session_id=s,auth_method='password'
    WHERE workspace_id=p_workspace_id AND user_id=a RETURNING * INTO c;
  INSERT INTO internal.signature_authentication_events(workspace_id,user_id,session_id,event)
    VALUES(p_workspace_id,a,s,'signature-certified');
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION api.certify_signature(uuid,integer,text) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.certify_signature(uuid,integer,text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.withdraw_signature_certification(p_workspace_id uuid)
RETURNS api.user_signature_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c api.user_signature_certifications; a text:=api.current_user_id();
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated'
    OR NOT EXISTS (SELECT 1 FROM api.workspace_memberships
      WHERE workspace_id=p_workspace_id AND user_id=a AND suspended_at IS NULL) THEN
    RAISE EXCEPTION 'workspace denied' USING ERRCODE='42501';
  END IF;
  UPDATE api.user_signature_certifications SET revoked_at=clock_timestamp()
    WHERE workspace_id=p_workspace_id AND user_id=a AND revoked_at IS NULL RETURNING * INTO c;
  IF c.id IS NULL THEN RAISE EXCEPTION 'no active certification' USING ERRCODE='22023'; END IF;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp() WHERE user_id=a AND consumed_at IS NULL;
  RETURN c;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.practice_signature(p_signing_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w uuid:=api.current_workspace_id(); a text:=api.current_user_id();
  s text:=api.claim_probe()->>'session_id';
BEGIN
  IF api.claim_probe()->>'role' IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'workspace denied' USING ERRCODE='42501';
  END IF;
  PERFORM internal.consume_signature_grant(p_signing_token,'practice',w,a,s);
  INSERT INTO internal.signature_authentication_events(workspace_id,user_id,session_id,event)
    VALUES(w,a,s,'practice-signature');
  RETURN jsonb_build_object('practice',true,'authMethod','password','signedAt',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION api.practice_signature(text) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.practice_signature(text) TO authenticated;
--> statement-breakpoint
DROP FUNCTION api.workspace_signature_certifications();
CREATE FUNCTION api.workspace_signature_certifications()
RETURNS TABLE(user_id text,name text,statement_version integer,certified_at timestamptz,
  revoked_at timestamptz,identity_verified_at timestamptz,identity_verified_by text,
  verified_email text,verification_requested boolean,auth_method text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.user_id,u.name,c.statement_version,c.certified_at,c.revoked_at,
    c.identity_verified_at,c.identity_verified_by,c.verified_email,
    c.credential_session_id IS NOT NULL AND c.identity_verified_at IS NULL,c.auth_method
    FROM api.workspace_memberships m JOIN internal."user" u ON u.id=m.user_id
    LEFT JOIN api.user_signature_certifications c ON c.workspace_id=m.workspace_id AND c.user_id=m.user_id
    WHERE m.workspace_id=api.current_workspace_id() AND m.suspended_at IS NULL
      AND api.is_workspace_member(m.workspace_id) ORDER BY u.name;
$$;
REVOKE ALL ON FUNCTION api.workspace_signature_certifications() FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.workspace_signature_certifications() TO authenticated;
--> statement-breakpoint
-- Replace the single writer, retaining the original scientific/workflow guards.
DROP FUNCTION api.sign_revision(uuid,text,text,text);
CREATE FUNCTION api.sign_revision(p_submission_id uuid,p_signature_meaning text,
  p_confirmation_phrase text,p_expected_revision_digest text,p_signing_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb; v_workspace uuid; v_actor text; v_session text; v_role text;
  v_submission api.review_submissions; v_revision api.revisions;
  v_record_project uuid; v_signer_name text; v_latest_check api.review_check_results;
  v_signature_id uuid; v_signed_at timestamptz:=clock_timestamp(); v_session_row internal.session;
BEGIN
  v_claims:=api.claim_probe();
  v_workspace:=nullif(v_claims->>'workspace_id','')::uuid;
  v_actor:=nullif(v_claims->>'sub',''); v_session:=nullif(v_claims->>'session_id','');
  v_role:=nullif(v_claims->>'role','');
  IF v_workspace IS NULL OR v_actor IS NULL OR v_session IS NULL
    OR v_role IS DISTINCT FROM 'authenticated' OR NOT api.is_workspace_writer(v_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE='42501';
  END IF;
  IF p_signature_meaning IS NULL OR p_signature_meaning NOT IN ('approve-for-record','witness') THEN
    RAISE EXCEPTION 'invalid signature meaning' USING ERRCODE='22023';
  END IF;
  IF p_confirmation_phrase IS NULL OR length(p_confirmation_phrase) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'confirmation phrase is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_submission FROM api.review_submissions
    WHERE id=p_submission_id AND workspace_id=v_workspace FOR UPDATE;
  IF v_submission.id IS NULL THEN RAISE EXCEPTION 'record denied' USING ERRCODE='42501'; END IF;
  IF v_submission.state<>'approved' THEN RAISE EXCEPTION 'review is not approved' USING ERRCODE='SB007'; END IF;
  SELECT * INTO v_revision FROM api.revisions WHERE id=v_submission.revision_id AND workspace_id=v_workspace;
  IF v_revision.id IS NULL THEN RAISE EXCEPTION 'record denied' USING ERRCODE='42501'; END IF;
  IF v_revision.superseded_by_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'revision is superseded' USING ERRCODE='SB006';
  END IF;
  IF p_expected_revision_digest IS NULL OR p_expected_revision_digest !~ '^[0-9a-f]{64}$'
    OR p_expected_revision_digest<>v_revision.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE='SB001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_submission.assigned_reviewer_user_ids) reviewer WHERE reviewer=v_actor) THEN
    RAISE EXCEPTION 'only an assigned reviewer may sign' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_session_row FROM internal.session WHERE id=v_session AND "userId"=v_actor;
  IF v_session_row.id IS NULL OR v_session_row."expiresAt"<=clock_timestamp() THEN
    RAISE EXCEPTION 'session expired or invalid' USING ERRCODE='SB002';
  END IF;
  SELECT * INTO v_latest_check FROM api.review_check_results
    WHERE revision_id=v_revision.id AND workspace_id=v_workspace ORDER BY run_at DESC LIMIT 1;
  IF v_latest_check.id IS NULL THEN
    RAISE EXCEPTION 'required checks have not been run' USING ERRCODE='SB008';
  END IF;
  IF v_latest_check.blocking_failure_count>0 OR v_latest_check.overall_status='fail' THEN
    RAISE EXCEPTION 'required checks have blocking failures' USING ERRCODE='SB008';
  END IF;
  SELECT name INTO v_signer_name FROM internal."user" WHERE id=v_actor;
  IF v_signer_name IS NULL OR btrim(lower(p_confirmation_phrase))<>btrim(lower(v_signer_name)) THEN
    RAISE EXCEPTION 'confirmation phrase does not match signer name' USING ERRCODE='SB009';
  END IF;
  IF EXISTS (SELECT 1 FROM api.signatures WHERE submission_id=v_submission.id AND signer_user_id=v_actor) THEN
    RAISE EXCEPTION 'signer has already signed this submission' USING ERRCODE='SB010';
  END IF;
  IF p_signing_token IS NULL THEN RAISE EXCEPTION 'fresh password token required' USING ERRCODE='SB002'; END IF;
  PERFORM internal.consume_signature_grant(p_signing_token,'sign',v_workspace,v_actor,v_session,v_submission.id,v_revision.integrity_digest);
  SELECT project_id INTO v_record_project FROM api.records WHERE id=v_submission.record_id;
  v_signature_id:=gen_random_uuid();
  INSERT INTO api.signatures(id,workspace_id,submission_id,revision_id,record_id,
    signature_meaning,assurance_level,revision_integrity_digest,signer_user_id,signer_session_id,
    signer_role,auth_method,confirmation_phrase,signed_at,created_at)
    VALUES(v_signature_id,v_workspace,v_submission.id,v_revision.id,v_submission.record_id,
      p_signature_meaning,'standard',v_revision.integrity_digest,v_actor,v_session,v_role,
      'password',p_confirmation_phrase,v_signed_at,v_signed_at);
  PERFORM internal.emit_change_event(v_workspace,'signature',v_signature_id,'create',
    v_submission.record_id,v_record_project,jsonb_build_object('signatureId',v_signature_id,
      'submissionId',v_submission.id,'revisionId',v_revision.id,'signerUserId',v_actor,
      'signatureMeaning',p_signature_meaning,'assuranceLevel','standard','authMethod','password'));
  RETURN jsonb_build_object('signatureId',v_signature_id,'submissionId',v_submission.id,
    'revisionId',v_revision.id,'signatureMeaning',p_signature_meaning,'assuranceLevel','standard','signedAt',v_signed_at);
END $$;
REVOKE ALL ON FUNCTION api.sign_revision(uuid,text,text,text,text) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.sign_revision(uuid,text,text,text,text) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
