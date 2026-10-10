-- REV-002 / SCI-03 — recover the idempotency race in the submission wrapper.
--
-- The 0317 author-signature wrapper re-implemented `submit_record_revision` and
-- dropped the `unique_violation` recovery branch the previous body had. A
-- concurrent request that passed its pre-check while another held the same
-- idempotency key then surfaced a raw unique-constraint error instead of the
-- canonical "used for a different submission" outcome (or the idempotent
-- winner). The recovery branch is restored, matching the other body.
DO $$ DECLARE definition text; anchor text; handler text;
BEGIN
  definition := pg_get_functiondef('api.submit_record_revision(uuid,text,text,integer,text[],boolean,text,timestamptz,text,text)'::regprocedure);

  anchor := E'  RETURN jsonb_build_object(\n    ''revision'', jsonb_build_object(''id'', revision_row.id, ''integrityDigest'', revision_row.integrity_digest),\n    ''submission'', jsonb_build_object(''id'', submission_row.id, ''state'', submission_row.state),\n    ''signature'',signature_result,''idempotent'', false\n  );\nEND;';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'submit_record_revision tail anchor missing';
  END IF;

  handler := E'  RETURN jsonb_build_object(\n    ''revision'', jsonb_build_object(''id'', revision_row.id, ''integrityDigest'', revision_row.integrity_digest),\n    ''submission'', jsonb_build_object(''id'', submission_row.id, ''state'', submission_row.state),\n    ''signature'',signature_result,''idempotent'', false\n  );\nEXCEPTION WHEN unique_violation THEN\n  SELECT * INTO existing_submission FROM api.review_submissions\n   WHERE workspace_id = claimed_workspace\n     AND submitted_by_user_id = actor\n     AND idempotency_key = p_idempotency_key;\n  SELECT * INTO existing_revision FROM api.revisions WHERE id = existing_submission.revision_id;\n  IF existing_submission.id IS NULL\n     OR existing_submission.record_id <> p_record_id\n     OR existing_submission.workflow_definition_key <> p_workflow_definition_key\n     OR existing_submission.workflow_definition_version <> p_workflow_definition_version\n     OR existing_submission.assigned_reviewer_user_ids <> normalized_reviewers\n     OR existing_revision.id IS NULL\n     OR existing_revision.integrity_digest <> p_expected_source_digest THEN\n    RAISE EXCEPTION ''idempotency key was used for a different submission'' USING ERRCODE = ''23505'';\n  END IF;\n  RETURN jsonb_build_object(\n    ''revision'', jsonb_build_object(''id'', existing_revision.id, ''integrityDigest'', existing_revision.integrity_digest),\n    ''submission'', jsonb_build_object(''id'', existing_submission.id, ''state'', existing_submission.state),\n    ''idempotent'', true\n  );\nEND;';

  definition := replace(definition, anchor, handler);
  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
