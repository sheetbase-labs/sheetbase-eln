-- WORK-01.1 — submit-time due-date override.
--
-- The canonical submission RPC (GOV-04/SCI-03) gains an optional explicit due
-- date. A NULL keeps the project's default review period, which the insert
-- trigger supplies. The evidence binding, digest and idempotency behaviour are
-- unchanged.

DROP FUNCTION IF EXISTS api.submit_record_revision(uuid, text, text, integer, text[], boolean, text);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.submit_record_revision(
  p_record_id uuid,
  p_expected_source_digest text,
  p_workflow_definition_key text,
  p_workflow_definition_version integer,
  p_reviewer_user_ids text[],
  p_confirmed boolean,
  p_idempotency_key text,
  p_due_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claimed_workspace uuid;
  actor text;
  session_id text;
  actor_role text;
  record_row api.records;
  envelope jsonb;
  actual_digest text;
  normalized_reviewers text[];
  revision_row api.revisions;
  submission_row api.review_submissions;
  existing_submission api.review_submissions;
  existing_revision api.revisions;
  submitted_at timestamptz := clock_timestamp();
  v_revision_id uuid;
BEGIN
  BEGIN
    claimed_workspace := nullif(api.claim_probe()->>'workspace_id', '')::uuid;
    actor := nullif(api.claim_probe()->>'sub', '');
    session_id := nullif(api.claim_probe()->>'session_id', '');
    actor_role := nullif(api.claim_probe()->>'role', '');
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END;
  IF claimed_workspace IS NULL OR actor IS NULL OR session_id IS NULL
     OR actor_role <> 'authenticated' OR p_confirmed IS DISTINCT FROM true
     OR NOT api.is_workspace_writer(claimed_workspace) THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_source_digest IS NULL
     OR p_expected_source_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'expected source digest is required' USING ERRCODE = '22023';
  END IF;
  IF p_workflow_definition_key IS NULL
     OR p_workflow_definition_key !~ '^[a-z0-9][a-z0-9_-]{0,127}$'
     OR coalesce(p_workflow_definition_version, 0) < 1 THEN
    RAISE EXCEPTION 'versioned workflow definition is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM internal.review_workflow_definitions definition
    WHERE definition.definition_key = p_workflow_definition_key
      AND definition.version = p_workflow_definition_version
  ) THEN
    RAISE EXCEPTION 'unknown workflow definition version' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(reviewer ORDER BY reviewer) INTO normalized_reviewers
  FROM (SELECT DISTINCT unnest(p_reviewer_user_ids) reviewer) reviewers
    WHERE reviewer IS NOT NULL AND reviewer <> '';
  IF coalesce(cardinality(normalized_reviewers), 0) = 0 THEN
    RAISE EXCEPTION 'at least one assigned reviewer is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(normalized_reviewers) reviewer
    WHERE NOT EXISTS (
      SELECT 1 FROM api.workspace_memberships membership
      WHERE membership.workspace_id = claimed_workspace
        AND membership.user_id = reviewer
    )
  ) THEN
    RAISE EXCEPTION 'assigned reviewer is not a workspace member' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO existing_submission
  FROM api.review_submissions
  WHERE workspace_id = claimed_workspace
    AND submitted_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  IF existing_submission.id IS NOT NULL THEN
    SELECT * INTO existing_revision FROM api.revisions
    WHERE id = existing_submission.revision_id;
    IF existing_submission.record_id <> p_record_id
       OR existing_submission.workflow_definition_key <> p_workflow_definition_key
       OR existing_submission.workflow_definition_version <> p_workflow_definition_version
       OR existing_submission.assigned_reviewer_user_ids <> normalized_reviewers
       OR existing_revision.integrity_digest <> p_expected_source_digest THEN
      RAISE EXCEPTION 'idempotency key was used for a different submission' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'revision', jsonb_build_object('id', existing_revision.id, 'integrityDigest', existing_revision.integrity_digest),
      'submission', jsonb_build_object('id', existing_submission.id, 'state', existing_submission.state),
      'idempotent', true
    );
  END IF;

  -- GOV-04: archived records fail closed exactly like deleted ones.
  SELECT * INTO record_row FROM api.records
  WHERE id = p_record_id
    AND workspace_id = claimed_workspace
    AND deleted_at IS NULL
    AND archived_at IS NULL
  FOR UPDATE;
  IF record_row.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  -- Evidence boundary: allocate the revision UUID, bind unbound frozen
  -- evidence to it, and only then capture the envelope (snapshot) and digest.
  v_revision_id := gen_random_uuid();
  PERFORM "internal"."bind_frozen_evidence_for_submission"(
    record_row.id, v_revision_id
  );

  envelope := internal.build_revision_envelope(record_row.id);
  actual_digest := internal.revision_integrity_digest(
    internal.envelope_for_digest(envelope)
  );
  IF actual_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION 'submission source changed' USING ERRCODE = 'SB001';
  END IF;

  INSERT INTO api.revisions (
    id, record_id, workspace_id, structure_version, metadata_version,
    metadata_snapshot, block_snapshot, canonical_snapshot,
    integrity_algorithm, integrity_digest, reason, created_at, updated_at,
    created_by_user_id
  ) VALUES (
    v_revision_id, record_row.id, record_row.workspace_id,
    record_row.structure_version, record_row.metadata_version,
    envelope->'record', envelope->'blocks', envelope,
    'sha256', actual_digest, 'submit', submitted_at, submitted_at, actor
  ) RETURNING * INTO revision_row;

  INSERT INTO api.review_submissions (
    workspace_id, record_id, revision_id, state,
    workflow_definition_key, workflow_definition_version,
    assigned_reviewer_user_ids, submitted_by_user_id, submitted_at,
    submitted_session_id, submitted_role, idempotency_key, due_at,
    created_at, updated_at
  ) VALUES (
    claimed_workspace, record_row.id, revision_row.id, 'submitted',
    p_workflow_definition_key, p_workflow_definition_version,
    normalized_reviewers, actor, submitted_at, session_id, actor_role, p_idempotency_key,
    p_due_at,
    submitted_at, submitted_at
  ) RETURNING * INTO submission_row;

  PERFORM "internal"."persist_revision_sheet_evidence"(revision_row.id);

  RETURN jsonb_build_object(
    'revision', jsonb_build_object('id', revision_row.id, 'integrityDigest', revision_row.integrity_digest),
    'submission', jsonb_build_object('id', submission_row.id, 'state', submission_row.state),
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO existing_submission
  FROM api.review_submissions
  WHERE workspace_id = claimed_workspace
    AND submitted_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  SELECT * INTO existing_revision FROM api.revisions
  WHERE id = existing_submission.revision_id;
  -- Mirror the normal idempotency pre-check exactly: any mismatch between
  -- the racing request and the winner means this key was reused for a
  -- different submission — surface the conflict instead of returning it.
  IF existing_submission.id IS NULL
     OR existing_submission.record_id <> p_record_id
     OR existing_submission.workflow_definition_key <> p_workflow_definition_key
     OR existing_submission.workflow_definition_version <> p_workflow_definition_version
     OR existing_submission.assigned_reviewer_user_ids <> normalized_reviewers
     OR existing_revision.id IS NULL
     OR existing_revision.integrity_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION 'idempotency key was used for a different submission' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object(
    'revision', jsonb_build_object('id', existing_revision.id, 'integrityDigest', existing_revision.integrity_digest),
    'submission', jsonb_build_object('id', existing_submission.id, 'state', existing_submission.state),
    'idempotent', true
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text, timestamptz)
  TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
