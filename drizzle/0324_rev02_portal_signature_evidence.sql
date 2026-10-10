-- REV-02: portal approval provenance is immutable signature evidence, never
-- today's user profile. The record's locking revision wins over newer history.
-- Legacy approved records without a lock pointer retain their latest locking
-- signature; stored evidence is not backfilled or rewritten.
CREATE OR REPLACE FUNCTION api.client_portal_records()
RETURNS TABLE(
  record_id uuid, identifier text, title text, kind text, status text,
  project_id uuid, shared_at timestamptz,
  approved_at timestamptz, approved_by_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT r.id, r.identifier, r.title, r.kind, r.status,
         coalesce(s.project_id, r.project_id),
         coalesce(s.shared_at, r.updated_at),
         sig.signed_at, sig.signer_name
    FROM api.records r
    JOIN api.projects p ON p.id = r.project_id
    LEFT JOIN api.client_portal_shares s
      ON s.record_id = r.id AND s.client_id = api.current_client_id()
    LEFT JOIN LATERAL (
      SELECT sg.signed_at, sg.signer_name
        FROM api.signatures sg
        JOIN api.revisions rev ON rev.id = sg.revision_id
       WHERE sg.record_id = r.id AND sg.workspace_id = r.workspace_id
         AND rev.record_id = r.id AND rev.workspace_id = r.workspace_id
         AND sg.signature_meaning IN ('approve-for-record', 'reviewed-and-approved')
         AND (r.locked_by_revision_id IS NULL OR sg.revision_id = r.locked_by_revision_id)
       ORDER BY sg.signed_at DESC, sg.id DESC
       LIMIT 1
    ) sig ON true
   WHERE p.client_id = api.current_client_id()
     AND p.workspace_id = api.current_workspace_id()
     AND internal.can_portal_project(p.id)
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

CREATE OR REPLACE FUNCTION api.client_portal_record_document(p_record_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
       AND internal.can_portal_project(p.id)
       AND (s.id IS NOT NULL OR p.auto_share_to_client)
  ), sig AS (
    SELECT sg.*
      FROM visible v
      JOIN api.signatures sg ON sg.record_id = v.id AND sg.workspace_id = v.workspace_id
      JOIN api.revisions rev ON rev.id = sg.revision_id
        AND rev.record_id = v.id AND rev.workspace_id = v.workspace_id
     WHERE sg.signature_meaning IN ('approve-for-record', 'reviewed-and-approved')
       AND (v.locked_by_revision_id IS NULL OR sg.revision_id = v.locked_by_revision_id)
     ORDER BY sg.signed_at DESC, sg.id DESC
     LIMIT 1
  )
  SELECT jsonb_build_object(
    'recordId', v.id,
    'identifier', coalesce(rev.metadata_snapshot->>'identifier', v.identifier),
    'title', coalesce(rev.metadata_snapshot->>'title', v.title),
    'kind', v.kind, 'projectTitle', v.project_title,
    'approvedAt', sig.signed_at, 'approvedByName', sig.signer_name,
    'signatureMeaning', sig.signature_meaning,
    'integrityDigest', sig.revision_integrity_digest,
    'verificationCode',
      CASE WHEN sig.revision_integrity_digest IS NOT NULL
           THEN upper(substr(sig.revision_integrity_digest, 1, 4)) || '-' ||
                upper(substr(sig.revision_integrity_digest, 5, 4)) END,
    'revisionId', rev.id,
    'revisionStructureVersion', rev.structure_version,
    'blockSnapshot', rev.block_snapshot,
    'scientificTables', coalesce(rev.canonical_snapshot->'scientificTables', '[]'::jsonb),
    'sheetEvidence', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'blockId', e.block_id, 'instanceId', e.instance_id,
        'instanceRevision', e.instance_revision,
        'sourceDefinitionVersionId', e.source_definition_version_id,
        'instanceState', e.instance_state, 'datasetBindings', e.dataset_versions,
        'composedGrid', e.composed_grid
      ) ORDER BY e.block_id)
      FROM api.revision_sheet_evidence e
      WHERE e.revision_id = rev.id
    ), '[]'::jsonb),
    'signatures', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', evidence.id, 'revisionId', evidence.revision_id,
        'signerName', evidence.signer_name, 'signedAt', evidence.signed_at,
        'signatureMeaning', evidence.signature_meaning,
        'integrityDigest', evidence.revision_integrity_digest
      ) ORDER BY evidence.signed_at, evidence.id)
      FROM api.signatures evidence
      WHERE evidence.revision_id = rev.id AND evidence.record_id = v.id
        AND evidence.workspace_id = v.workspace_id
    ), '[]'::jsonb),
    'reportSections', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'title', rs.title, 'description', rs.description, 'payload', rs.frozen_payload
      ) ORDER BY rs.position)
      FROM api.report_sections rs WHERE rs.report_id = v.report_id
    ), '[]'::jsonb)
  )
    FROM visible v
    LEFT JOIN sig ON true
    LEFT JOIN api.revisions rev ON rev.id = sig.revision_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.client_portal_record_document(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.client_portal_record_document(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
