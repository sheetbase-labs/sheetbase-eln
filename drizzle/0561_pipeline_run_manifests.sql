-- PIPE-EXEC: a signed manifest for every succeeded pipeline run.
--
-- The manifest records what a run consumed and produced: the pinned definition
-- version (with a digest of its configuration), each input Dataset Version with a
-- digest of the exact rows the transform saw, the parameters, the steps run, and
-- the output Dataset Version with a digest of the rows written. It is hashed
-- (SHA-256 over canonical JSON), signed by the application with an Ed25519 key
-- when one is configured, and chained to the workspace's previous manifest, so an
-- auditor can verify any run offline and detect a missing or altered entry.
--
-- Written once, in the transaction that completes the run. Immutable afterwards.

CREATE TABLE api.pipeline_run_manifests (
  run_id uuid PRIMARY KEY REFERENCES api.pipeline_runs(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  -- 1, 2, 3 ... per workspace, assigned under the workspace execution lock.
  sequence bigint NOT NULL,
  manifest jsonb NOT NULL,
  -- SHA-256 (hex) of the canonical JSON of `manifest`.
  manifest_digest text NOT NULL,
  -- Digest of the workspace's previous manifest; NULL only for sequence 1.
  previous_digest text,
  -- Base64 Ed25519 signature over the raw digest bytes. NULL when the
  -- deployment has no signing key: the manifest is then hashed and chained but
  -- not attributable to this deployment.
  signature text,
  signature_algorithm text,
  key_id text,
  signed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_pipeline_run_manifests_sequence UNIQUE (workspace_id, sequence),
  CONSTRAINT chk_pipeline_run_manifests_digest CHECK (manifest_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT chk_pipeline_run_manifests_previous CHECK (
    (sequence = 1) = (previous_digest IS NULL)
    AND (previous_digest IS NULL OR previous_digest ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT chk_pipeline_run_manifests_signature CHECK (
    (signature IS NULL) = (signature_algorithm IS NULL)
    AND (signature IS NULL) = (key_id IS NULL)
  )
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_manifests_workspace ON api.pipeline_run_manifests(workspace_id, sequence DESC);
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_run_manifests IS
  'PIPE-EXEC signed, hash-chained evidence of what a succeeded pipeline run consumed and produced. Immutable.';
--> statement-breakpoint

-- Evidence cannot be edited or removed, by anyone, once written.
CREATE OR REPLACE FUNCTION internal.pipeline_run_manifests_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'pipeline run manifests are immutable' USING ERRCODE = 'SB042';
END $$;
--> statement-breakpoint
CREATE TRIGGER trg_pipeline_run_manifests_immutable
  BEFORE UPDATE OR DELETE ON api.pipeline_run_manifests
  FOR EACH ROW EXECUTE FUNCTION internal.pipeline_run_manifests_immutable();
--> statement-breakpoint
CREATE TRIGGER trg_pipeline_run_manifests_no_truncate
  BEFORE TRUNCATE ON api.pipeline_run_manifests
  FOR EACH STATEMENT EXECUTE FUNCTION internal.pipeline_run_manifests_immutable();
--> statement-breakpoint

-- Readable by the workspace. Writes come only from the executor's trusted
-- connection; nobody gets a write grant.
ALTER TABLE api.pipeline_run_manifests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_run_manifests_select ON api.pipeline_run_manifests
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.pipeline_run_manifests TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
