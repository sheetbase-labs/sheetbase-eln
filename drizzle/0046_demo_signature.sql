-- A demo-only way to sign.
--
-- The public demo has no sign-in, so nobody there can enter a signing
-- password and the review story stopped at "your signature is still needed".
-- A demo signature is confirmed by typing the signer's name, is recorded as
-- "demo" everywhere a signature is shown, and is honoured only for the demo's
-- own sign-in-free sessions (their ids start `dev-auth-free-session`). A real
-- sign-in session never has such an id, so a demo signature can neither be
-- issued for, nor pass as, a signature on a real install.

ALTER TABLE internal.signature_grants DROP CONSTRAINT chk_signature_grants_auth_method;
--> statement-breakpoint
ALTER TABLE internal.signature_grants ADD CONSTRAINT chk_signature_grants_auth_method
  CHECK (auth_method = ANY (ARRAY['password'::text, 'demo'::text]));
--> statement-breakpoint
ALTER TABLE api.signatures DROP CONSTRAINT chk_signatures_auth_method;
--> statement-breakpoint
ALTER TABLE api.signatures ADD CONSTRAINT chk_signatures_auth_method
  CHECK (auth_method = ANY (ARRAY['session+name-confirmation'::text, 'password'::text, 'demo'::text]));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.consume_signature_grant(p_token text, p_purpose text, p_workspace uuid, p_actor text, p_session text, p_submission uuid DEFAULT NULL::uuid, p_digest text DEFAULT NULL::text) RETURNS internal.signature_grants
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE g internal.signature_grants; c api.user_signature_certifications;
BEGIN
  -- Lock certification before the grant, matching issuance and withdrawal.
  c := internal.signature_identity(p_workspace,p_actor,p_session);
  IF p_purpose IN ('sign','practice','author-submit') AND
    (c.certified_at IS NULL OR c.revoked_at IS NOT NULL OR c.statement_version IS DISTINCT FROM coalesce(
       (SELECT s.signature_statement_version FROM api.workspace_settings s
         WHERE s.workspace_id = p_workspace), 1)
     OR c.auth_method NOT IN ('password','demo') OR c.auth_method IS NULL) THEN
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
    OR g.expires_at<=clock_timestamp()
    OR g.submission_id IS DISTINCT FROM p_submission
    OR g.revision_digest IS DISTINCT FROM p_digest THEN
    RAISE EXCEPTION 'fresh password token required' USING ERRCODE='SB002';
  END IF;
  -- A password grant needs a password-certified signer, as ever. A demo grant
  -- is only honoured in a demo (sign-in-free) session.
  IF g.auth_method = 'password' THEN
    IF p_purpose IN ('sign','practice','author-submit') AND c.auth_method IS DISTINCT FROM 'password' THEN
      RAISE EXCEPTION 'current signature certification required' USING ERRCODE='42501';
    END IF;
  ELSIF g.auth_method = 'demo' THEN
    IF p_session NOT LIKE 'dev-auth-free-session%' THEN
      RAISE EXCEPTION 'demo signatures are only available in the demo' USING ERRCODE='SB002';
    END IF;
  ELSE
    RAISE EXCEPTION 'fresh password token required' USING ERRCODE='SB002';
  END IF;
  UPDATE internal.signature_grants SET consumed_at=clock_timestamp() WHERE token_hash=g.token_hash;
  -- Carries how this signature was confirmed to the row written next.
  PERFORM set_config('sheetbase.signature_auth_method', g.auth_method, true);
  RETURN g;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.record_revision_signature(p_submission uuid, p_actor text, p_session text, p_meaning text, p_confirmation text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE s api.review_submissions; r api.revisions; sig api.signatures; n text; project uuid;
  method text := CASE WHEN current_setting('sheetbase.signature_auth_method', true) = 'demo'
    AND p_session LIKE 'dev-auth-free-session%' THEN 'demo' ELSE 'password' END;
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
      p_actor,n,p_session,'authenticated',method,p_confirmation,clock_timestamp(),clock_timestamp()) RETURNING * INTO sig;
  SELECT project_id INTO project FROM api.records WHERE id=s.record_id;
  PERFORM internal.emit_change_event(s.workspace_id,'signature',sig.id,'create',s.record_id,project,
    jsonb_build_object('signatureId',sig.id,'submissionId',s.id,'revisionId',r.id,
      'signerUserId',p_actor,'signatureMeaning',p_meaning,'assuranceLevel','standard','authMethod',method));
  RETURN jsonb_build_object('signatureId',sig.id,'submissionId',s.id,'revisionId',r.id,
    'signatureMeaning',p_meaning,'assuranceLevel','standard','signedAt',sig.signed_at);
END $$;
