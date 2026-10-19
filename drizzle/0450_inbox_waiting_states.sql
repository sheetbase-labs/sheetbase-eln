-- Phase 4 (Nobody waits without knowing) — every state where one person waits on
-- another becomes a work item.
--
-- Until now the Inbox covered review requests, witness requests, failed and
-- waiting runs, data issues, expiring materials and cell conflicts. The states
-- below left a person waiting with no signal at all:
--
--   review_returned       the author whose submission came back with changes
--   approval_unsigned     a reviewer who approved but has not signed yet
--   witness_signed        the person who asked for a witness, once they have signed
--   access_requested      a project manager asked for edit access on their project
--   access_decided        the requester, once their access request was decided
--   agent_proposal        a proposal an agent made that this person may decide
--   invitation_accepted   the person who invited someone who has now joined
--   sample_awaiting_release a sample the person owns that is quarantined
--   sample_hold_exceeded  a sample the person owns that passed its hold limit
--   calibration_overdue   an instrument the person added whose calibration is overdue
--
-- Each branch is derived, never stored: the item exists while the state holds
-- and disappears the moment it is resolved, so the list cannot show a decision
-- that is already made. Informational items (a decision, an acceptance) are
-- limited to the last fourteen days and are cleared by marking them seen.
--
-- Same shape as 0406: the previous definition is extended with UNION ALL, so
-- the column list and every earlier kind are unchanged. The seen key and the
-- needs-action count are computed from kind and source_id / record_id, so the
-- new kinds take part in both without any other change.
--
-- Qualification requests are deliberately absent: there is no request record to
-- derive an item from (instrument_qualifications is only the grant).

DO $$
DECLARE previous text;
BEGIN
  SELECT rtrim(pg_get_viewdef('api.my_work_items'::regclass,true),E';\n ') INTO previous;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS
    SELECT old.* FROM ('||previous||') old

    UNION ALL
    -- A returned review waits on its author until they submit a newer revision.
    SELECT ''review_returned''::text,r.id,r.identifier,r.title,r.project_id,
      ''Changes requested. Resolve the comments and resubmit''::text,NULL::timestamptz,
      ''needs_action''::text,rs.updated_at,
      ''review_submission''::text,rs.id,NULL::uuid,NULL::uuid,rs.revision_id
    FROM api.review_submissions rs
    JOIN api.records r ON r.id=rs.record_id
    WHERE rs.workspace_id=api.current_workspace_id()
      AND rs.state=''returned''
      AND rs.submitted_by_user_id=api.current_user_id()
      AND NOT EXISTS(SELECT 1 FROM api.review_submissions later
        WHERE later.record_id=rs.record_id AND later.submitted_at>rs.submitted_at)

    UNION ALL
    -- An approved review whose assigned reviewer has not signed it yet.
    SELECT ''approval_unsigned''::text,r.id,r.identifier,r.title,r.project_id,
      ''Approved. Your signature is still needed''::text,NULL::timestamptz,
      ''needs_action''::text,rs.updated_at,
      ''review_submission''::text,rs.id,NULL::uuid,NULL::uuid,rs.revision_id
    FROM api.review_submissions rs
    JOIN api.records r ON r.id=rs.record_id
    JOIN api.revisions v ON v.id=rs.revision_id
    WHERE rs.workspace_id=api.current_workspace_id()
      AND rs.state=''approved''
      AND api.current_user_id()=ANY(rs.assigned_reviewer_user_ids)
      AND rs.submitted_by_user_id<>api.current_user_id()
      AND v.superseded_by_revision_id IS NULL
      AND r.locked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM api.signatures sig
        WHERE sig.submission_id=rs.id AND sig.signer_user_id=api.current_user_id())

    UNION ALL
    -- The witness signed: the person who asked now knows the request is answered.
    SELECT ''witness_signed''::text,r.id,r.identifier,r.title,r.project_id,
      ''Witness signature given''::text,NULL::timestamptz,
      ''needs_action''::text,sig.signed_at,
      ''signature_witness_request''::text,q.id,NULL::uuid,NULL::uuid,v.id
    FROM api.signature_witness_requests q
    JOIN api.review_submissions s ON s.id=q.submission_id
    JOIN api.revisions v ON v.id=s.revision_id
    JOIN api.records r ON r.id=s.record_id
    JOIN api.signatures sig ON sig.submission_id=s.id
      AND sig.signer_user_id=q.witness_user_id
      AND sig.signature_meaning=''witnessed''
      AND sig.revision_integrity_digest=q.revision_digest
    WHERE q.workspace_id=api.current_workspace_id()
      AND q.requested_by_user_id=api.current_user_id()
      AND sig.signed_at>now()-interval ''14 days''

    UNION ALL
    -- Someone asked for edit access to a project this person manages.
    SELECT ''access_requested''::text,NULL::uuid,p.key,p.title,p.id,
      a.reason,NULL::timestamptz,''needs_action''::text,a.created_at,
      ''project_access_request''::text,a.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.project_access_requests a
    JOIN api.projects p ON p.id=a.project_id
    WHERE a.workspace_id=api.current_workspace_id()
      AND a.status=''pending''
      AND a.user_id<>api.current_user_id()
      AND internal.can_manage_project(a.project_id)

    UNION ALL
    -- The person who asked for access learns how it was decided.
    SELECT ''access_decided''::text,NULL::uuid,p.key,p.title,p.id,
      CASE a.status WHEN ''approved'' THEN ''Your edit access request was approved''
        ELSE ''Your edit access request was denied'' END::text,
      NULL::timestamptz,''needs_action''::text,a.updated_at,
      ''project_access_request''::text,a.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.project_access_requests a
    JOIN api.projects p ON p.id=a.project_id
    WHERE a.workspace_id=api.current_workspace_id()
      AND a.status<>''pending''
      AND a.user_id=api.current_user_id()
      AND a.updated_at>now()-interval ''14 days''

    UNION ALL
    -- A pending agent proposal, for whoever holds the capability to decide it.
    SELECT ''agent_proposal''::text,NULL::uuid,NULL::text,ap.title,NULL::uuid,
      ap.summary,NULL::timestamptz,''needs_action''::text,ap.created_at,
      ''agent_operation_proposal''::text,ap.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.agent_operation_proposals ap
    WHERE ap.workspace_id=api.current_workspace_id()
      AND ap.status=''pending''
      AND CASE
        WHEN ap.operation_kind LIKE ''pipeline_definition.%''
          THEN api.has_capability(ap.workspace_id,''pipelines.manage'')
        WHEN ap.operation_kind=''dataset_rows.commit''
          THEN api.is_workspace_writer(ap.workspace_id)
        ELSE api.has_capability(ap.workspace_id,''schema.edit'')
      END

    UNION ALL
    -- The inviter learns the invitation was accepted.
    SELECT ''invitation_accepted''::text,NULL::uuid,NULL::text,wi.email,NULL::uuid,
      ''Accepted your invitation and joined as ''||wi.role,NULL::timestamptz,
      ''needs_action''::text,wi.accepted_at,
      ''workspace_invitation''::text,wi.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.workspace_invitations wi
    WHERE wi.workspace_id=api.current_workspace_id()
      AND wi.status=''accepted''
      AND wi.created_by_user_id=api.current_user_id()
      AND wi.accepted_at>now()-interval ''14 days''

    UNION ALL
    -- A quarantined sample waits on a release decision.
    SELECT ''sample_awaiting_release''::text,r.id,r.identifier,r.title,r.project_id,
      ''Quarantined. Release or dispose of it''::text,NULL::timestamptz,
      ''needs_action''::text,r.updated_at,
      NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.records r
    WHERE r.workspace_id=api.current_workspace_id()
      AND r.kind=''sample''
      AND r.status=''quarantined''
      AND r.archived_at IS NULL AND r.deleted_at IS NULL
      AND r.created_by_user_id=api.current_user_id()

    UNION ALL
    -- A sample past its hold limit waits on a decision about the stock.
    SELECT ''sample_hold_exceeded''::text,r.id,r.identifier,r.title,r.project_id,
      ''Hold limit exceeded. Use it, quarantine it or dispose of it''::text,NULL::timestamptz,
      ''needs_action''::text,r.updated_at,
      NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.records r
    WHERE r.workspace_id=api.current_workspace_id()
      AND r.kind=''sample''
      AND r.status=''hold_exceeded''
      AND r.archived_at IS NULL AND r.deleted_at IS NULL
      AND r.created_by_user_id=api.current_user_id()

    UNION ALL
    -- An instrument whose latest calibration is past due.
    SELECT ''calibration_overdue''::text,NULL::uuid,i.serial_number,i.name,NULL::uuid,
      ''Calibration was due ''||to_char(c.due_at,''YYYY-MM-DD'')::text,c.due_at,
      ''overdue''::text,c.due_at,
      ''instrument''::text,i.id,NULL::uuid,NULL::uuid,NULL::uuid
    FROM api.instruments i
    JOIN LATERAL (SELECT ic.due_at FROM api.instrument_calibrations ic
      WHERE ic.instrument_id=i.id ORDER BY ic.performed_at DESC,ic.created_at DESC LIMIT 1) c ON true
    WHERE i.workspace_id=api.current_workspace_id()
      AND i.created_by_user_id=api.current_user_id()
      AND c.due_at<now()';
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
