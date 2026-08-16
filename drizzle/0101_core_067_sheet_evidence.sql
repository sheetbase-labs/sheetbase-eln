-- CORE-06.7 / 06.8: freeze reconstructable Sheet evidence inside the existing
-- REV-002 submit transaction. Preview remains STABLE. Live Dataset bindings
-- are snapshotted only on submit, after the digest matches.

CREATE TABLE api.revision_sheet_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES api.revisions(id) ON DELETE RESTRICT,
  block_id uuid NOT NULL,
  instance_id uuid NOT NULL REFERENCES api.sheet_instances(id) ON DELETE RESTRICT,
  source_definition_version_id uuid REFERENCES api.sheet_definition_versions(id) ON DELETE RESTRICT,
  instance_revision bigint NOT NULL,
  instance_state jsonb NOT NULL,
  dataset_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_revision_sheet_evidence_revision_block
    UNIQUE (revision_id, block_id)
);

ALTER TABLE api.revision_sheet_evidence ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.revision_sheet_evidence TO authenticated;
CREATE POLICY revision_sheet_evidence_read ON api.revision_sheet_evidence
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));

CREATE FUNCTION internal.notebook_sheet_evidence(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  rec api.records;
  block api.blocks;
  instance api.sheet_instances;
  definition_config jsonb;
  binding jsonb;
  dataset_row api.datasets;
  items jsonb := '[]'::jsonb;
  bindings jsonb;
BEGIN
  SELECT * INTO rec FROM api.records WHERE id = p_record_id;
  IF rec.id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  FOR block IN
    SELECT * FROM api.blocks
      WHERE record_id = rec.id AND type = 'sheet' AND payload ? 'instanceId'
      ORDER BY "order", id
  LOOP
    SELECT * INTO instance FROM api.sheet_instances
      WHERE id = (block.payload->>'instanceId')::uuid;
    IF instance.id IS NULL THEN
      RAISE EXCEPTION 'Sheet Instance for submitted block is missing' USING ERRCODE = 'SB092';
    END IF;
    definition_config := NULL;
    IF instance.source_definition_version_id IS NOT NULL THEN
      SELECT configuration INTO definition_config
        FROM api.sheet_definition_versions definition_version
        WHERE definition_version.id = instance.source_definition_version_id;
    END IF;
    bindings := '[]'::jsonb;
    FOR binding IN SELECT value FROM jsonb_array_elements(coalesce(instance.state->'bindings','[]'::jsonb)) LOOP
      IF binding->>'kind' = 'dataset' THEN
        SELECT * INTO dataset_row FROM api.datasets WHERE id = (binding->>'datasetId')::uuid;
        bindings := bindings || jsonb_build_array(jsonb_build_object(
          'bindingId', binding->>'bindingId',
          'parameterId', binding->>'parameterId',
          'datasetId', binding->>'datasetId',
          'policyMode', coalesce(binding->'policy'->>'mode','live'),
          'datasetVersionId', binding->'policy'->>'datasetVersionId',
          'datasetRevision', dataset_row.revision,
          'schemaVersionId', dataset_row.schema_version_id
        ));
      ELSE
        bindings := bindings || jsonb_build_array(binding);
      END IF;
    END LOOP;
    items := items || jsonb_build_array(jsonb_build_object(
      'blockId', block.id,
      'instanceId', instance.id,
      'instanceRevision', instance.revision,
      'sourceDefinitionVersionId', instance.source_definition_version_id,
      'definitionConfiguration', definition_config,
      'instanceState', instance.state,
      'datasetBindings', bindings
    ));
  END LOOP;
  RETURN items;
END
$$;

ALTER FUNCTION internal.build_revision_envelope(uuid)
  RENAME TO build_revision_envelope_without_sheet_evidence;

CREATE FUNCTION internal.build_revision_envelope(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  base jsonb;
BEGIN
  base := internal.build_revision_envelope_without_sheet_evidence(p_record_id);
  RETURN base || jsonb_build_object(
    'sheetEvidence', internal.notebook_sheet_evidence(p_record_id)
  );
END
$$;

CREATE FUNCTION internal.persist_revision_sheet_evidence(p_revision_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  revision api.revisions;
  item jsonb;
  binding jsonb;
  frozen jsonb;
  snapshot api.dataset_versions;
  dataset_row api.datasets;
  version_id uuid;
  seen jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO revision FROM api.revisions WHERE id = p_revision_id;
  IF revision.id IS NULL THEN
    RAISE EXCEPTION 'revision not found' USING ERRCODE = '22023';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(revision.canonical_snapshot->'sheetEvidence','[]'::jsonb)) LOOP
    frozen := '[]'::jsonb;
    FOR binding IN SELECT value FROM jsonb_array_elements(coalesce(item->'datasetBindings','[]'::jsonb)) LOOP
      IF binding->>'datasetId' IS NULL THEN
        CONTINUE;
      END IF;
      version_id := NULL;
      IF binding->>'policyMode' = 'version' AND binding->>'datasetVersionId' IS NOT NULL THEN
        version_id := (binding->>'datasetVersionId')::uuid;
      ELSE
        IF seen ? (binding->>'datasetId') THEN
          version_id := (seen->> (binding->>'datasetId'))::uuid;
        ELSE
          SELECT * INTO dataset_row FROM api.datasets WHERE id = (binding->>'datasetId')::uuid;
          IF dataset_row.id IS NULL THEN
            RAISE EXCEPTION 'Dataset for Sheet evidence is missing' USING ERRCODE = 'SB092';
          END IF;
          snapshot := api.snapshot_dataset(
            dataset_row.id,
            (binding->>'datasetRevision')::bigint,
            'Notebook revision sheet evidence'
          );
          version_id := snapshot.id;
          seen := seen || jsonb_build_object(binding->>'datasetId', version_id);
        END IF;
      END IF;
      frozen := frozen || jsonb_build_array(jsonb_build_object(
        'bindingId', binding->>'bindingId',
        'datasetId', binding->>'datasetId',
        'datasetVersionId', version_id,
        'policyMode', binding->>'policyMode'
      ));
    END LOOP;
    INSERT INTO api.revision_sheet_evidence(
      workspace_id, revision_id, block_id, instance_id,
      source_definition_version_id, instance_revision, instance_state, dataset_versions
    ) VALUES (
      revision.workspace_id,
      revision.id,
      (item->>'blockId')::uuid,
      (item->>'instanceId')::uuid,
      nullif(item->>'sourceDefinitionVersionId','')::uuid,
      (item->>'instanceRevision')::bigint,
      item->'instanceState',
      frozen
    )
    ON CONFLICT (revision_id, block_id) DO NOTHING;
  END LOOP;
END
$$;

ALTER FUNCTION api.submit_record_revision(uuid, text, text, integer, text[], boolean, text)
  RENAME TO submit_record_revision_core067;

CREATE FUNCTION api.submit_record_revision(
  p_record_id uuid,
  p_expected_source_digest text,
  p_workflow_definition_key text,
  p_workflow_definition_version integer,
  p_reviewer_user_ids text[],
  p_confirmed boolean,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  result := api.submit_record_revision_core067(
    p_record_id,
    p_expected_source_digest,
    p_workflow_definition_key,
    p_workflow_definition_version,
    p_reviewer_user_ids,
    p_confirmed,
    p_idempotency_key
  );
  IF coalesce(result->>'idempotent','false') <> 'true' THEN
    PERFORM internal.persist_revision_sheet_evidence((result->'revision'->>'id')::uuid);
  END IF;
  RETURN result;
END
$$;

REVOKE EXECUTE ON FUNCTION
  internal.notebook_sheet_evidence(uuid),
  internal.build_revision_envelope_without_sheet_evidence(uuid),
  internal.build_revision_envelope(uuid),
  internal.persist_revision_sheet_evidence(uuid),
  api.submit_record_revision_core067(uuid, text, text, integer, text[], boolean, text)
  FROM PUBLIC, authenticated, api_client, anon;
REVOKE EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.submit_record_revision(uuid, text, text, integer, text[], boolean, text)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
