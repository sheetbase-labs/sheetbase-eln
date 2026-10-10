-- PORTAL-02.3 — the portal shell's remaining reads. A client viewer has no
-- direct read access to anything; every row here is produced by a SECURITY
-- DEFINER function scoped to the caller's client and workspace, and limited
-- to approved content the client may see (explicit share or the project's
-- automatic share). Drafts, comments, dataset rows and files stay denied.
--
--  * client_portal_projects gains the project header fields the design shows
--    (status, modality, lead name, last update).
--  * client_portal_records gains the approval provenance (signature time and
--    signer) the "Approved" column shows.
--  * client_portal_milestones lists one project's milestones.
--  * client_portal_reports lists the shared approved report documents with
--    the records/revisions they cover.
--  * client_portal_record_document is the guard for the PDF byte route: it
--    returns the signed revision's frozen content, signature and a
--    verification code derived from the revision integrity digest.

DROP FUNCTION IF EXISTS api.client_portal_projects();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.client_portal_projects()
RETURNS TABLE(
  project_id uuid, display_id text, title text, stage text, status text,
  modality text, lead_name text, last_update timestamptz,
  client_name text, client_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.display_id, p.title, p.stage, p.status, p.modality,
         u.name,
         (SELECT max(r.updated_at)
            FROM api.records r
           WHERE r.project_id = p.id AND r.deleted_at IS NULL),
         c.name, c.code
    FROM api.projects p
    JOIN api.clients c ON c.id = p.client_id
    LEFT JOIN internal."user" u ON u.id = p.lead_user_id
   WHERE c.id = api.current_client_id()
     AND c.workspace_id = api.current_workspace_id()
     AND p.auto_share_to_client
   ORDER BY p.title
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_projects() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_projects() TO authenticated;
--> statement-breakpoint

DROP FUNCTION IF EXISTS api.client_portal_records();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.client_portal_records()
RETURNS TABLE(
  record_id uuid, identifier text, title text, kind text, status text,
  project_id uuid, shared_at timestamptz,
  approved_at timestamptz, approved_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.identifier, r.title, r.kind, r.status,
         coalesce(s.project_id, r.project_id),
         coalesce(s.shared_at, r.updated_at),
         sig.signed_at, sig.signer_name
    FROM api.records r
    JOIN api.projects p ON p.id = r.project_id
    LEFT JOIN api.client_portal_shares s
      ON s.record_id = r.id AND s.client_id = api.current_client_id()
    LEFT JOIN LATERAL (
      SELECT sg.signed_at, u.name AS signer_name
        FROM api.signatures sg
        JOIN internal."user" u ON u.id = sg.signer_user_id
       WHERE sg.record_id = r.id
         AND sg.signature_meaning = 'approve-for-record'
       ORDER BY sg.signed_at DESC
       LIMIT 1
    ) sig ON true
   WHERE p.client_id = api.current_client_id()
     AND p.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND r.status = 'approved'
     AND (s.id IS NOT NULL OR p.auto_share_to_client)
   ORDER BY coalesce(s.shared_at, r.updated_at) DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_records() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_records() TO authenticated;
--> statement-breakpoint

-- One project's milestones. Empty unless the project is in the caller's
-- portal, so a forged project id cannot enumerate another client's project.
CREATE OR REPLACE FUNCTION api.client_portal_milestones(p_project_id uuid)
RETURNS TABLE(
  milestone_id uuid, title text, status text, due_at timestamptz, sort_position integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.title, t.status, t.due_at, t.position
    FROM api.study_tasks t
    JOIN api.projects p ON p.id = t.project_id
    JOIN api.clients c ON c.id = p.client_id
   WHERE t.project_id = p_project_id
     AND t.task_type = 'milestone'
     AND c.id = api.current_client_id()
     AND c.workspace_id = api.current_workspace_id()
     AND p.auto_share_to_client
   ORDER BY t.position, t.due_at
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_milestones(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_milestones(uuid) TO authenticated;
--> statement-breakpoint

-- The shared approved report documents, with the records/revisions their
-- frozen sections cover ("EXP-0138 v2", "PRJ-0217"). Reports with no frozen
-- source render no covers.
CREATE OR REPLACE FUNCTION api.client_portal_reports()
RETURNS TABLE(
  record_id uuid, identifier text, title text, covers text, shared_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.id, r.identifier, r.title,
         (SELECT string_agg(x.label, ', ' ORDER BY x.label)
            FROM (
              SELECT DISTINCT
                     (coalesce(rec.identifier, rs.source_ref->>'recordIdentifier') ||
                      CASE WHEN rev.id IS NOT NULL
                           THEN ' v' || rev.structure_version::text ELSE '' END) AS label
                FROM api.report_sections rs
                LEFT JOIN api.revisions rev ON rev.id = rs.source_revision_id
                LEFT JOIN api.records rec ON rec.id = rev.record_id
               WHERE rs.report_id = d.id
                 AND coalesce(rec.identifier, rs.source_ref->>'recordIdentifier') IS NOT NULL
            ) x),
         coalesce(s.shared_at, r.updated_at)
    FROM api.records r
    JOIN api.projects p ON p.id = r.project_id
    JOIN api.report_definitions d ON d.record_id = r.id
    LEFT JOIN api.client_portal_shares s
      ON s.record_id = r.id AND s.client_id = api.current_client_id()
   WHERE p.client_id = api.current_client_id()
     AND p.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND r.status = 'approved'
     AND (s.id IS NOT NULL OR p.auto_share_to_client)
   ORDER BY coalesce(s.shared_at, r.updated_at) DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_reports() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_reports() TO authenticated;
--> statement-breakpoint

-- The PDF byte route's guard and payload. Returns NULL (no row) unless the
-- caller's client may see the record. An approved record carries its signed
-- revision, signature and verification code; a report carries its frozen
-- report sections. `verificationCode` is the short form of the signed
-- revision's integrity digest a client checks against the CDMO audit trail;
-- the full digest is returned alongside it.
CREATE OR REPLACE FUNCTION api.client_portal_record_document(p_record_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH visible AS (
    SELECT r.*, p.title AS project_title, d.id AS report_id
      FROM api.records r
      JOIN api.projects p ON p.id = r.project_id
      LEFT JOIN api.report_definitions d ON d.record_id = r.id
      LEFT JOIN api.client_portal_shares s
        ON s.record_id = r.id AND s.client_id = api.current_client_id()
     WHERE r.id = p_record_id
       AND r.deleted_at IS NULL
       AND r.status = 'approved'
       AND p.client_id = api.current_client_id()
       AND p.workspace_id = api.current_workspace_id()
       AND (s.id IS NOT NULL OR p.auto_share_to_client)
  ), sig AS (
    SELECT sg.signed_at, sg.signer_user_id, sg.revision_integrity_digest,
           sg.revision_id, sg.signature_meaning
      FROM api.signatures sg
     WHERE sg.record_id = p_record_id
       AND sg.signature_meaning = 'approve-for-record'
     ORDER BY sg.signed_at DESC
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'recordId', v.id,
    'identifier', v.identifier,
    'title', v.title,
    'kind', v.kind,
    'projectTitle', v.project_title,
    'approvedAt', sig.signed_at,
    'approvedByName', u.name,
    'signatureMeaning', sig.signature_meaning,
    'integrityDigest', sig.revision_integrity_digest,
    'verificationCode',
      CASE WHEN sig.revision_integrity_digest IS NOT NULL
           THEN upper(substr(sig.revision_integrity_digest, 1, 4)) || '-' ||
                upper(substr(sig.revision_integrity_digest, 5, 4))
           ELSE NULL END,
    'revisionStructureVersion', rev.structure_version,
    'blockSnapshot', rev.block_snapshot,
    'reportSections',
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'title', rs.title,
                 'description', rs.description,
                 'payload', rs.frozen_payload
               ) ORDER BY rs.position)
          FROM api.report_sections rs
         WHERE rs.report_id = v.report_id
      ), '[]'::jsonb)
  )
    FROM visible v
    LEFT JOIN sig ON true
    LEFT JOIN internal."user" u ON u.id = sig.signer_user_id
    LEFT JOIN api.revisions rev ON rev.id = sig.revision_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_record_document(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_record_document(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
