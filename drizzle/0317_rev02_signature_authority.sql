-- REV-02 keeps legacy signature rows byte-for-byte. New writes use the four
-- accepted ADR-0045 meanings and native password evidence, not legacy aliases.
ALTER TABLE api.signature_witness_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api.signature_witness_requests FROM PUBLIC, anon, authenticated, api_client;
GRANT SELECT ON api.signature_witness_requests TO authenticated;
CREATE POLICY signature_witness_read ON api.signature_witness_requests FOR SELECT TO authenticated
  USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
INSERT INTO internal.review_workflow_definitions(definition_key,version,definition)
VALUES('controlled-scientific-review',1,
  '{"steps":[{"key":"scientific-review","required":true}],"requiresSignature":true}');
--> statement-breakpoint
CREATE FUNCTION api.available_review_workflows()
RETURNS TABLE(definition_key text,version integer,requires_signature boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT d.definition_key,d.version,coalesce((d.definition->>'requiresSignature')::boolean,false)
  FROM internal.review_workflow_definitions d
  WHERE api.is_workspace_member(api.current_workspace_id()) ORDER BY d.definition_key,d.version;
$$;
REVOKE ALL ON FUNCTION api.available_review_workflows() FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.available_review_workflows() TO authenticated;
--> statement-breakpoint
-- Timestamp normalization is independent of the connection's timezone.
CREATE FUNCTION internal.signature_submission_arguments(p_record uuid,p_digest text,p_workflow text,
  p_version integer,p_reviewers text[],p_confirmed boolean,p_key text,p_due timestamptz)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('recordId',p_record,'revisionDigest',p_digest,
    'workflowDefinitionKey',p_workflow,'workflowDefinitionVersion',p_version,
    'reviewerUserIds',coalesce((SELECT jsonb_agg(x ORDER BY x) FROM
      (SELECT DISTINCT unnest(p_reviewers) x) r WHERE x IS NOT NULL AND x<>''),'[]'::jsonb),
    'confirmed',p_confirmed,'idempotencyKey',p_key,
    'dueAt',CASE WHEN p_due IS NULL THEN NULL ELSE
      to_char(p_due AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END);
$$;
REVOKE ALL ON FUNCTION internal.signature_submission_arguments(uuid,text,text,integer,text[],boolean,text,timestamptz)
  FROM PUBLIC,anon,authenticated,api_client;
--> statement-breakpoint
-- One persistence path for authored and post-submission attestations.
CREATE FUNCTION internal.record_revision_signature(p_submission uuid,p_actor text,p_session text,
  p_meaning text,p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s api.review_submissions; r api.revisions; sig api.signatures; n text; project uuid;
BEGIN
  SELECT * INTO STRICT s FROM api.review_submissions WHERE id=p_submission;
  SELECT * INTO STRICT r FROM api.revisions WHERE id=s.revision_id;
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
      'signerUserId',p_actor,'signatureMeaning',p_meaning,'assuranceLevel','standard','authMethod','password'));
  RETURN jsonb_build_object('signatureId',sig.id,'submissionId',s.id,'revisionId',r.id,
    'signatureMeaning',p_meaning,'assuranceLevel','standard','signedAt',sig.signed_at);
END $$;
REVOKE ALL ON FUNCTION internal.record_revision_signature(uuid,text,text,text,text)
  FROM PUBLIC,anon,authenticated,api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.lock_record_after_signature()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.signature_meaning='reviewed-and-approved' THEN
    PERFORM internal.lock_record(NEW.record_id,NEW.revision_id,NEW.signed_at);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Extend the canonical grant consumer, preserving session/certification,
-- lockout, expiry, workspace, digest and single-use guards unchanged.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('internal.consume_signature_grant(text,text,uuid,text,text,uuid,text)'::regprocedure) INTO d;
  IF position('p_purpose IN (''sign'',''practice'')' IN d)=0 THEN
    RAISE EXCEPTION 'unexpected signature grant consumer contract';
  END IF;
  d:=replace(d,'p_purpose IN (''sign'',''practice'')','p_purpose IN (''sign'',''practice'',''author-submit'')');
  EXECUTE d;
END $$;
--> statement-breakpoint
-- Extend the current canonical submission body rather than wrapping it in
-- another engine. Existing freeze/evidence/model/permission guards survive.
DO $$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz)'::regprocedure) INTO d;
  IF position('p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)' IN d)=0
    OR position('  SELECT * INTO existing_submission' IN d)=0
    OR position('  PERFORM "internal"."persist_revision_sheet_evidence"(revision_row.id);' IN d)=0 THEN
    RAISE EXCEPTION 'unexpected canonical submission contract';
  END IF;
  d:=replace(d,'p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone)',
    'p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_author_signing_token text DEFAULT NULL, p_author_confirmation_phrase text DEFAULT NULL)');
  d:=replace(d,'  v_revision_id uuid;',E'  v_revision_id uuid;\n  requires_author boolean;\n  signing_args jsonb;\n  author_grant internal.signature_grants;\n  author_signature api.signatures;\n  signature_result jsonb;');
  d:=replace(d,'  SELECT * INTO existing_submission', $insertion$
  IF NOT EXISTS(SELECT 1 FROM internal.session WHERE id=session_id AND "userId"=actor AND "expiresAt">clock_timestamp()) THEN
    RAISE EXCEPTION 'valid submission session required' USING ERRCODE='SB002';
  END IF;
  SELECT coalesce((definition->>'requiresSignature')::boolean,false) INTO requires_author
    FROM internal.review_workflow_definitions WHERE definition_key=p_workflow_definition_key AND version=p_workflow_definition_version;
  signing_args:=internal.signature_submission_arguments(p_record_id,p_expected_source_digest,
    p_workflow_definition_key,p_workflow_definition_version,normalized_reviewers,p_confirmed,p_idempotency_key,p_due_at);
  -- Serialize identical submissions before examining idempotency, including
  -- two concurrent requests that would otherwise both observe absence.
  PERFORM pg_advisory_xact_lock(hashtextextended(claimed_workspace::text||':'||actor||':'||p_idempotency_key,0));
  SELECT * INTO existing_submission$insertion$);
  -- The canonical function has both normal and unique-violation retry paths.
  d:=replace(d,'existing_revision.integrity_digest <> p_expected_source_digest',
    'existing_revision.integrity_digest <> p_expected_source_digest OR existing_submission.due_at IS DISTINCT FROM p_due_at');
  d:=replace(d,'    RETURN jsonb_build_object(', $retry$
    IF requires_author THEN
      SELECT * INTO author_signature FROM api.signatures WHERE submission_id=existing_submission.id
        AND signer_user_id=actor AND signature_meaning='authored';
      IF author_signature.id IS NULL THEN
        RAISE EXCEPTION 'existing submission has no authored signature' USING ERRCODE='SB002';
      END IF;
      IF author_signature.signer_session_id IS DISTINCT FROM session_id
        OR author_signature.confirmation_phrase IS DISTINCT FROM p_author_confirmation_phrase THEN
        RAISE EXCEPTION 'authored retry identity mismatch' USING ERRCODE='SB002';
      END IF;
      signature_result:=jsonb_build_object('signatureId',author_signature.id,'submissionId',existing_submission.id,
        'revisionId',existing_revision.id,'signatureMeaning','authored','assuranceLevel','standard','signedAt',author_signature.signed_at);
    END IF;
    RETURN jsonb_build_object($retry$);
  d:=replace(d,'''idempotent'', true', '''signature'',signature_result,''idempotent'', true');
  d:=replace(d,'  PERFORM "internal"."persist_revision_sheet_evidence"(revision_row.id);', $sign$
  PERFORM "internal"."persist_revision_sheet_evidence"(revision_row.id);
  IF requires_author THEN
    IF p_author_signing_token IS NULL THEN RAISE EXCEPTION 'fresh author password token required' USING ERRCODE='SB002'; END IF;
    author_grant:=internal.consume_signature_grant(p_author_signing_token,'author-submit',claimed_workspace,actor,session_id,NULL,actual_digest);
    IF author_grant.record_id IS DISTINCT FROM p_record_id OR author_grant.signature_meaning IS DISTINCT FROM 'authored'
      OR author_grant.submission_arguments IS DISTINCT FROM signing_args THEN
      RAISE EXCEPTION 'author token submission arguments mismatch' USING ERRCODE='SB002';
    END IF;
    signature_result:=internal.record_revision_signature(submission_row.id,actor,session_id,'authored',p_author_confirmation_phrase);
  END IF;$sign$);
  d:=replace(d,'''idempotent'', false', '''signature'',signature_result,''idempotent'', false');
  -- The advisory lock makes the catch branch unreachable for a matching key;
  -- never turn an unrelated unique error into an unsigned retry success.
  d:=regexp_replace(d,'EXCEPTION WHEN unique_violation THEN[\s\S]*?END;\n',E'END;\n');
  DROP FUNCTION api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz);
  EXECUTE d;
END $$;
REVOKE ALL ON FUNCTION api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text) TO authenticated;
--> statement-breakpoint
-- Issuance and consumption share one target/meaning authority. The signer is
-- the assigned workflow human, never simply an owner/admin membership label.
CREATE FUNCTION internal.assert_signature_target(p_submission uuid,p_meaning text,p_digest text)
RETURNS api.review_submissions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
    IF NOT(a=ANY(s.assigned_reviewer_user_ids)) OR a=s.submitted_by_user_id THEN
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
END $$;
REVOKE ALL ON FUNCTION internal.assert_signature_target(uuid,text,text) FROM PUBLIC,anon,authenticated,api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.sign_revision(p_submission_id uuid,p_signature_meaning text,
  p_confirmation_phrase text,p_expected_revision_digest text,p_signing_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s api.review_submissions; g internal.signature_grants;
  signer_name text;
  w uuid:=api.current_workspace_id(); a text:=api.current_user_id(); session_id text:=api.claim_probe()->>'session_id';
BEGIN
  IF NOT EXISTS(SELECT 1 FROM api.review_submissions WHERE id=p_submission_id AND workspace_id=w) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE='42501';
  END IF;
  -- Same lock order as password issuance and certification withdrawal.
  PERFORM internal.signature_identity(w,a,session_id);
  SELECT * INTO s FROM api.review_submissions WHERE id=p_submission_id AND workspace_id=w FOR UPDATE;
  s:=internal.assert_signature_target(p_submission_id,p_signature_meaning,p_expected_revision_digest);
  IF EXISTS(SELECT 1 FROM api.signatures WHERE submission_id=s.id AND signer_user_id=a
    AND signature_meaning=p_signature_meaning) THEN
    RAISE EXCEPTION 'signer has already recorded this meaning' USING ERRCODE='SB010';
  END IF;
  SELECT name INTO signer_name FROM internal."user" WHERE id=a;
  IF signer_name IS NULL OR btrim(lower(p_confirmation_phrase)) IS DISTINCT FROM btrim(lower(signer_name)) THEN
    RAISE EXCEPTION 'confirmation phrase does not match signer name' USING ERRCODE='SB009';
  END IF;
  IF p_signing_token IS NULL THEN RAISE EXCEPTION 'fresh password token required' USING ERRCODE='SB002'; END IF;
  g:=internal.consume_signature_grant(p_signing_token,'sign',w,a,session_id,s.id,p_expected_revision_digest);
  IF g.signature_meaning IS DISTINCT FROM p_signature_meaning THEN
    RAISE EXCEPTION 'password token meaning mismatch' USING ERRCODE='SB002';
  END IF;
  RETURN internal.record_revision_signature(s.id,a,session_id,p_signature_meaning,p_confirmation_phrase);
END $$;
--> statement-breakpoint
CREATE FUNCTION api.request_signature_witness(p_submission_id uuid,p_witness_user_id text,
  p_expected_revision_digest text,p_due_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION api.request_signature_witness(uuid,text,text,timestamptz) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.request_signature_witness(uuid,text,text,timestamptz) TO authenticated;
--> statement-breakpoint
-- Inbox is a derivation of request/evidence state, not a second work queue.
DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.*,NULL::uuid AS revision_id FROM ('||previous||') old UNION ALL
    SELECT ''witness_requested''::text,r.id,r.identifier,r.title,r.project_id,
      ''Witness this frozen revision''::text,q.due_at,''needs_action''::text,q.created_at,
      ''signature_witness_request''::text,q.id,NULL::uuid,NULL::uuid,v.id
    FROM api.signature_witness_requests q JOIN api.review_submissions s ON s.id=q.submission_id
    JOIN api.revisions v ON v.id=s.revision_id JOIN api.records r ON r.id=s.record_id
    WHERE q.workspace_id=api.current_workspace_id() AND q.witness_user_id=api.current_user_id()
      AND s.state IN(''submitted'',''approved'') AND v.superseded_by_revision_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM api.signatures sig WHERE sig.submission_id=s.id
        AND sig.signer_user_id=q.witness_user_id AND sig.signature_meaning=''witnessed''
        AND sig.revision_integrity_digest=q.revision_digest)';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
