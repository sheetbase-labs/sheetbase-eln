-- DATA-02: export & portability.
--
-- 1. api.data_exports — durable receipts for every export operation so stewards
--    can audit who extracted what, when, in which format. Content itself is
--    deterministic and carries no wall-clock timestamps; the receipt is the
--    provenance record.
--
-- 2. api.revision_evidence_package — the one canonical machine-readable read
--    of a submitted revision as evidence: envelope, sheet evidence side table
--    and the pinned file manifest. SECURITY DEFINER because it must read
--    internal.revision_file_objects, which request roles can never see; it
--    re-checks workspace membership exactly like RLS would.

CREATE TABLE api.data_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  object_type text NOT NULL CHECK (object_type IN ('dataset','dataset_version','sheet_instance','record','revision')),
  object_id uuid NOT NULL,
  format text NOT NULL CHECK (length(btrim(format)) BETWEEN 1 AND 40),
  row_count integer CHECK (row_count IS NULL OR row_count >= 0),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  actor_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  actor_credential_id uuid REFERENCES internal.api_credentials(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_data_exports_actor_xor
    CHECK ((actor_user_id IS NOT NULL)::int + (actor_credential_id IS NOT NULL)::int <= 1)
);
CREATE INDEX idx_data_exports_workspace ON api.data_exports(workspace_id, created_at DESC);
CREATE INDEX idx_data_exports_object ON api.data_exports(object_type, object_id);

ALTER TABLE api.data_exports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.data_exports TO authenticated;

CREATE POLICY data_exports_select ON api.data_exports FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
-- No INSERT policy and no INSERT grant: receipts are written exclusively by
-- api.record_data_export below, which derives workspace and actor from the
-- verified request claims. A browser session therefore cannot fabricate or
-- reattribute audit rows through /api/db.
--> statement-breakpoint

CREATE FUNCTION api.revision_evidence_package(p_revision_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision api.revisions;
  v_package jsonb;
  v_record_snapshot jsonb;
BEGIN
  SELECT * INTO v_revision FROM api.revisions WHERE id = p_revision_id;
  IF v_revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found' USING ERRCODE = '22023';
  END IF;
  IF v_revision.workspace_id IS NULL
     OR v_revision.workspace_id <> api.current_workspace_id()
     OR NOT api.is_workspace_member(v_revision.workspace_id) THEN
    RAISE EXCEPTION 'revision denied' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(v_revision.metadata_snapshot->'record', v_revision.metadata_snapshot)
    INTO v_record_snapshot;


  SELECT jsonb_build_object(
    'revision', jsonb_build_object(
      'id', v_revision.id,
      'recordId', v_revision.record_id,
      'workspaceId', v_revision.workspace_id,
      'reason', v_revision.reason,
      'structureVersion', v_revision.structure_version,
      'metadataVersion', v_revision.metadata_version,
      'integrityAlgorithm', v_revision.integrity_algorithm,
      'integrityDigest', v_revision.integrity_digest,
      'supersededByRevisionId', v_revision.superseded_by_revision_id,
      'createdAt', v_revision.created_at
    ),
    -- Convenience record metadata comes strictly from the submitted
    -- snapshot (metadata_snapshot = envelope->'record'), never from the
    -- live row, so the package cannot drift after submission.
    'record', CASE
      WHEN v_record_snapshot ? 'identifier' THEN jsonb_build_object(
        'identifier', v_record_snapshot->'identifier',
        'title', v_record_snapshot->'title',
        'kind', v_record_snapshot->'kind',
        'status', v_record_snapshot->'status'
      )
      ELSE NULL
    END,
    'metadataSnapshot', v_revision.metadata_snapshot,
    'blockSnapshot', v_revision.block_snapshot,
    'canonicalSnapshot', v_revision.canonical_snapshot,
    'sheetEvidence', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'blockId', e.block_id,
        'instanceId', e.instance_id,
        'sourceDefinitionVersionId', e.source_definition_version_id,
        'instanceRevision', e.instance_revision,
        'instanceState', e.instance_state,
        'composedGrid', e.composed_grid,
        'datasetVersions', e.dataset_versions,
        'createdAt', e.created_at
      ) ORDER BY e.block_id), '[]'::jsonb)
      FROM api.revision_sheet_evidence e WHERE e.revision_id = v_revision.id
    ),
    'files', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'fileObjectId', f.file_object_id,
        'fileRecordId', f.file_record_id,
        'storageKey', f.storage_key,
        'storageBackend', f.storage_backend,
        'checksumAlgorithm', f.checksum_algorithm,
        'checksum', f.checksum,
        'byteSize', f.byte_size
      ) ORDER BY f.file_object_id), '[]'::jsonb)
      FROM internal.revision_file_objects f WHERE f.revision_id = v_revision.id
    ),
    'submission', (
      SELECT to_jsonb(s) FROM api.review_submissions s
      WHERE s.revision_id = v_revision.id AND s.workspace_id = v_revision.workspace_id
      LIMIT 1
    ),
    'decisions', (
      SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.created_at), '[]'::jsonb)
      FROM api.review_decisions d
      WHERE d.revision_id = v_revision.id AND d.workspace_id = v_revision.workspace_id
    ),
    'checkResults', (
      SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.run_at), '[]'::jsonb)
      FROM api.review_check_results c
      WHERE c.revision_id = v_revision.id AND c.workspace_id = v_revision.workspace_id
    ),
    'signatures', (
      SELECT coalesce(jsonb_agg(to_jsonb(sg) ORDER BY sg.signed_at), '[]'::jsonb)
      FROM api.signatures sg
      WHERE sg.revision_id = v_revision.id AND sg.workspace_id = v_revision.workspace_id
    ),
    'comments', (
      SELECT coalesce(jsonb_agg(to_jsonb(cm) ORDER BY cm.created_at), '[]'::jsonb)
      FROM api.comments cm
      WHERE cm.revision_id = v_revision.id AND cm.workspace_id = v_revision.workspace_id
    )
  ) INTO v_package;

  RETURN v_package;
END;
$$;
-- Controlled receipt writer. SECURITY DEFINER so request roles need no
-- table INSERT grant; workspace and actor come from the verified claims,
-- never from arguments, making the audit trail authoritative. Export is a
-- read-plane action, so plain (unsuspended) membership is the gate here:
-- a viewer may export readable data while the system records the action.
CREATE FUNCTION api.record_data_export(
  p_object_type text,
  p_object_id uuid,
  p_format text,
  p_row_count integer DEFAULT NULL,
  p_byte_size bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_actor text := api.current_user_id();
BEGIN
  IF v_workspace IS NULL OR v_actor IS NULL THEN
    RAISE EXCEPTION 'workspace and authenticated actor required' USING ERRCODE = '42501';
  END IF;
  IF p_object_type NOT IN
    ('dataset','dataset_version','sheet_instance','record','revision') THEN
    RAISE EXCEPTION 'invalid export object type' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = v_workspace
       AND m.user_id = v_actor
       AND m.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'caller is not an active workspace member' USING ERRCODE = '42501';
  END IF;

  INSERT INTO api.data_exports (
    workspace_id, object_type, object_id, format,
    row_count, byte_size, actor_user_id
  ) VALUES (
    v_workspace, p_object_type, p_object_id, p_format,
    p_row_count, p_byte_size, v_actor
  );
END;
$fn$;
REVOKE EXECUTE ON FUNCTION api.record_data_export(text,uuid,text,integer,bigint) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.record_data_export(text,uuid,text,integer,bigint) TO authenticated;
--> statement-breakpoint

DROP FUNCTION IF EXISTS api.export_revision_evidence(uuid);
-- The SIGN-002 export_revision_evidence RPC is superseded by the package
-- above (it carried review/signature state but not Sheet evidence or the
-- pinned file manifest). Its callers now read revision_evidence_package.
DROP FUNCTION IF EXISTS api.export_revision_evidence(uuid);
REVOKE EXECUTE ON FUNCTION api.revision_evidence_package(uuid) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.revision_evidence_package(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
