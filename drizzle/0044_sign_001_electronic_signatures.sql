-- SIGN-001: initial electronic signatures for the Sheetbase ELN.
--
-- Adds an immutable, workspace-scoped api.signatures table that records the
-- signer identity, the stated signature meaning, the assurance level, the
-- revision integrity reference the signer was looking at, and the
-- authentication evidence (session id, role, auth method). A signature is
-- the post-approval attestation that locks in the signer's intent against a
-- specific frozen revision; it is never a compliance label.
--
-- The single SECURITY DEFINER RPC `api.sign_revision` is the only writer.
-- Guards (defence-in-depth, UI mirrors these so the workspace never offers
-- signing it cannot honour):
--   * workspace membership (claim_probe + is_workspace_member)
--   * submission belongs to the claimed workspace
--   * submission.state = 'approved' → only an approved review can be signed
--   * the pinned revision is not superseded
--   * the revision integrity digest matches p_expected_revision_digest
--     → prevents a stale-action race between view and sign
--   * actor is an assigned reviewer of the submission
--   * the latest review check result for the revision has no blocking
--     failures → required checks must pass before signing
--   * the signer's confirmation phrase matches their recorded display name
--     → verifies current signing intent at the 'standard' assurance level
--   * the signer has not already signed this submission
--     → one signature per (submission, signer)
--
-- Assurance level: 'standard'. Authentication method: 'session+name-
-- confirmation' — the existing authenticated session plus an explicit
-- typed confirmation that matches the signer's recorded name. No compliance
-- claim (21 CFR Part 11, EU Annex 11, etc.) is made or implied; the
-- assurance level is a stated property of the evidence, not a validation.

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'comment',
    'review_submission', 'signature'
  ));
--> statement-breakpoint

CREATE TABLE "api"."signatures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL
    REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  "submission_id" uuid NOT NULL
    REFERENCES "api"."review_submissions"("id") ON DELETE RESTRICT,
  "revision_id" uuid NOT NULL
    REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "record_id" uuid NOT NULL
    REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  -- The stated meaning of this signature. Fixed vocabulary so the evidence
  -- is machine-readable and stable; the UI presents the human-readable form.
  -- approve-for-record: the signer attests the reviewed revision is the
  --   authoritative record they approve for locking.
  -- witness: the signer witnesses that the review and approval took place.
  "signature_meaning" text NOT NULL,
  -- Stated assurance level. 'standard' for the initial implementation. This
  -- is a property of the evidence, not a compliance certification.
  "assurance_level" text NOT NULL DEFAULT 'standard',
  -- The digest of the revision the signer was looking at, pinned so a later
  -- superseding revision cannot retroactively change what was signed.
  "revision_integrity_digest" text NOT NULL,
  -- Authentication evidence.
  "signer_user_id" text NOT NULL
    REFERENCES "internal"."user"("id") ON DELETE RESTRICT,
  "signer_session_id" text NOT NULL,
  "signer_role" text NOT NULL,
  -- How the signing intent was verified. 'session+name-confirmation' for the
  -- initial assurance level.
  "auth_method" text NOT NULL,
  -- The confirmation phrase the signer typed (must have matched their name).
  -- Stored so the evidence is self-describing; the match was verified by the
  -- RPC at sign time.
  "confirmation_phrase" text NOT NULL,
  "signed_at" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_signatures_meaning"
    CHECK (signature_meaning IN ('approve-for-record', 'witness')),
  CONSTRAINT "chk_signatures_assurance_level"
    CHECK (assurance_level IN ('standard')),
  CONSTRAINT "chk_signatures_auth_method"
    CHECK (auth_method IN ('session+name-confirmation')),
  CONSTRAINT "chk_signatures_digest"
    CHECK (revision_integrity_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_signatures_confirmation_phrase"
    CHECK (length(confirmation_phrase) BETWEEN 1 AND 200),
  -- One signature per (submission, signer). A signer cannot sign the same
  -- approved submission twice; a re-sign requires a new submission/revision.
  CONSTRAINT "uq_signatures_submission_signer"
    UNIQUE (submission_id, signer_user_id)
);
--> statement-breakpoint

CREATE INDEX "idx_signatures_submission"
  ON "api"."signatures" ("submission_id", "signed_at");
--> statement-breakpoint
CREATE INDEX "idx_signatures_workspace_signed"
  ON "api"."signatures" ("workspace_id", "signed_at");
--> statement-breakpoint
CREATE INDEX "idx_signatures_record"
  ON "api"."signatures" ("record_id", "signed_at");
--> statement-breakpoint
CREATE INDEX "idx_signatures_revision"
  ON "api"."signatures" ("revision_id");
--> statement-breakpoint

ALTER TABLE "api"."signatures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "signatures_select" ON "api"."signatures"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );
--> statement-breakpoint

GRANT SELECT ON "api"."signatures" TO authenticated;
--> statement-breakpoint

-- Immutability: once a signature is recorded it cannot be altered or deleted
-- by any application role. The migrator retains cleanup access for test
-- fixtures.
CREATE FUNCTION "internal"."prevent_signature_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'signatures are immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_signature_mutation"()
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
CREATE TRIGGER "prevent_signature_mutation"
  BEFORE UPDATE OR DELETE ON "api"."signatures"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_signature_mutation"();
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "api"."signatures"
  FROM authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sign_revision: the single public writer. SECURITY DEFINER (migrator-owned),
-- executable by authenticated. Enforces every guard above and records the
-- signature with authentication evidence. Returns the new signature id and
-- timestamp.
-- ---------------------------------------------------------------------------
CREATE FUNCTION "api"."sign_revision"(
  p_submission_id uuid,
  p_signature_meaning text,
  p_confirmation_phrase text,
  p_expected_revision_digest text
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
  v_signer_name text;
  v_latest_check api.review_check_results;
  v_signature_id uuid;
  v_signed_at timestamptz := clock_timestamp();
  v_session_row internal.session;
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

  -- Meaning and confirmation preconditions.
  IF p_signature_meaning IS NULL
     OR p_signature_meaning NOT IN ('approve-for-record', 'witness') THEN
    RAISE EXCEPTION 'invalid signature meaning' USING ERRCODE = '22023';
  END IF;
  IF p_confirmation_phrase IS NULL
     OR length(p_confirmation_phrase) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'confirmation phrase is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_submission FROM api.review_submissions
  WHERE id = p_submission_id AND workspace_id = v_workspace
  FOR UPDATE;
  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- Approved-state guard: only an approved review can be signed. This is the
  -- workflow-step check — signing follows approval.
  IF v_submission.state <> 'approved' THEN
    RAISE EXCEPTION 'review is not approved' USING ERRCODE = 'SB007';
  END IF;

  SELECT * INTO v_revision FROM api.revisions
  WHERE id = v_submission.revision_id AND workspace_id = v_workspace;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  -- Superseded guard: a superseded revision cannot be signed.
  IF v_revision.superseded_by_revision_id IS NOT NULL THEN
    RAISE EXCEPTION 'revision is superseded' USING ERRCODE = 'SB006';
  END IF;
  -- Digest guard: the signer confirms the digest of the revision they
  -- viewed. The revision is immutable, so a mismatch means the signer's
  -- client was looking at a different revision.
  IF p_expected_revision_digest IS NULL
     OR p_expected_revision_digest !~ '^[0-9a-f]{64}$'
     OR p_expected_revision_digest <> v_revision.integrity_digest THEN
    RAISE EXCEPTION 'revision integrity digest mismatch' USING ERRCODE = 'SB001';
  END IF;

  -- Permission boundary: only an assigned reviewer may sign.
  IF NOT EXISTS (
    SELECT 1 FROM unnest(v_submission.assigned_reviewer_user_ids) reviewer
    WHERE reviewer = v_actor
  ) THEN
    RAISE EXCEPTION 'only an assigned reviewer may sign'
      USING ERRCODE = '42501';
  END IF;

  -- Re-authentication / current-intent guard: the session backing this
  -- request must exist and not have expired. This is the re-authentication
  -- check for the 'standard' assurance level — a stale or expired session
  -- cannot produce a signature. It runs after the permission boundary so
  -- outsiders get a permission error, not a session error.
  SELECT * INTO v_session_row FROM internal.session
  WHERE id = v_session AND "userId" = v_actor;
  IF v_session_row.id IS NULL OR v_session_row."expiresAt" < now() THEN
    RAISE EXCEPTION 'session expired or invalid' USING ERRCODE = 'SB002';
  END IF;

  -- Required-checks guard: the latest check result for the revision must
  -- have no blocking failures. Checks must have been run at least once.
  SELECT * INTO v_latest_check FROM api.review_check_results
  WHERE revision_id = v_revision.id AND workspace_id = v_workspace
  ORDER BY run_at DESC
  LIMIT 1;
  IF v_latest_check.id IS NULL THEN
    RAISE EXCEPTION 'required checks have not been run'
      USING ERRCODE = 'SB008';
  END IF;
  IF v_latest_check.blocking_failure_count > 0
     OR v_latest_check.overall_status = 'fail' THEN
    RAISE EXCEPTION 'required checks have blocking failures'
      USING ERRCODE = 'SB008';
  END IF;

  -- Confirmation guard: the typed phrase must match the signer's recorded
  -- display name (case-insensitive, trimmed). This verifies current signing
  -- intent at the 'standard' assurance level.
  SELECT name INTO v_signer_name FROM internal.user WHERE id = v_actor;
  IF v_signer_name IS NULL
     OR btrim(lower(p_confirmation_phrase)) <> btrim(lower(v_signer_name)) THEN
    RAISE EXCEPTION 'confirmation phrase does not match signer name'
      USING ERRCODE = 'SB009';
  END IF;

  -- Duplicate-signature guard: one signature per (submission, signer). The
  -- unique constraint backs this, but an explicit check gives a clearer
  -- error code.
  IF EXISTS (
    SELECT 1 FROM api.signatures
    WHERE submission_id = v_submission.id AND signer_user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'signer has already signed this submission'
      USING ERRCODE = 'SB010';
  END IF;

  SELECT project_id INTO v_record_project FROM api.records
  WHERE id = v_submission.record_id;

  v_signature_id := gen_random_uuid();
  INSERT INTO api.signatures (
    id, workspace_id, submission_id, revision_id, record_id,
    signature_meaning, assurance_level, revision_integrity_digest,
    signer_user_id, signer_session_id, signer_role, auth_method,
    confirmation_phrase, signed_at, created_at
  ) VALUES (
    v_signature_id, v_workspace, v_submission.id, v_revision.id,
    v_submission.record_id,
    p_signature_meaning, 'standard', v_revision.integrity_digest,
    v_actor, v_session, v_role, 'session+name-confirmation',
    p_confirmation_phrase, v_signed_at, v_signed_at
  );

  PERFORM internal.emit_change_event(
    v_workspace, 'signature', v_signature_id, 'create',
    v_submission.record_id, v_record_project,
    jsonb_build_object(
      'signatureId', v_signature_id,
      'submissionId', v_submission.id,
      'revisionId', v_revision.id,
      'signerUserId', v_actor,
      'signatureMeaning', p_signature_meaning,
      'assuranceLevel', 'standard'
    )
  );

  RETURN jsonb_build_object(
    'signatureId', v_signature_id,
    'submissionId', v_submission.id,
    'revisionId', v_revision.id,
    'signatureMeaning', p_signature_meaning,
    'assuranceLevel', 'standard',
    'signedAt', v_signed_at
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."sign_revision"(uuid, text, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."sign_revision"(uuid, text, text, text)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
