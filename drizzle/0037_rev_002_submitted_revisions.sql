-- REV-002: transactional submitted revisions and immutable frozen evidence.
-- Builds on ADR 0036 and the lightweight api.revisions table without adding
-- review decisions, comments, diffs, checks or signatures.

ALTER TABLE "api"."revisions"
  ADD COLUMN "workspace_id" uuid,
  ADD COLUMN "canonical_snapshot" jsonb,
  ADD COLUMN "integrity_algorithm" text NOT NULL DEFAULT 'sha256',
  ADD COLUMN "integrity_digest" text;
--> statement-breakpoint

UPDATE "api"."revisions" rev
SET workspace_id = r.workspace_id,
    canonical_snapshot = jsonb_build_object(
      'formatVersion', 0,
      'record', rev.metadata_snapshot,
      'blocks', rev.block_snapshot,
      'links', '[]'::jsonb,
      'scientificTables', '[]'::jsonb,
      'formulas', '[]'::jsonb,
      'files', '[]'::jsonb
    )
FROM "api"."records" r
WHERE r.id = rev.record_id;
--> statement-breakpoint

UPDATE "api"."revisions"
SET integrity_digest = encode(
  sha256(convert_to(canonical_snapshot::text, 'UTF8')),
  'hex'
);
--> statement-breakpoint

ALTER TABLE "api"."revisions"
  ALTER COLUMN "workspace_id" SET NOT NULL,
  ALTER COLUMN "canonical_snapshot" SET NOT NULL,
  ALTER COLUMN "integrity_digest" SET NOT NULL,
  ADD CONSTRAINT "revisions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "chk_revisions_integrity_algorithm"
    CHECK ("integrity_algorithm" = 'sha256'),
  ADD CONSTRAINT "chk_revisions_integrity_digest"
    CHECK ("integrity_digest" ~ '^[0-9a-f]{64}$');
--> statement-breakpoint

ALTER TABLE "api"."revisions"
  DROP CONSTRAINT "revisions_record_id_records_id_fk";
--> statement-breakpoint
ALTER TABLE "api"."revisions"
  ADD CONSTRAINT "revisions_record_id_records_id_fk"
  FOREIGN KEY ("record_id") REFERENCES "api"."records"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "api"."revisions"
  DROP CONSTRAINT "revisions_created_by_user_id_user_id_fk";
ALTER TABLE "api"."revisions"
  ADD CONSTRAINT "revisions_created_by_user_id_user_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
  ON DELETE RESTRICT;
--> statement-breakpoint

CREATE INDEX "idx_revisions_workspace_id"
  ON "api"."revisions" ("workspace_id");
--> statement-breakpoint

CREATE TABLE "internal"."review_workflow_definitions" (
  "definition_key" text NOT NULL,
  "version" integer NOT NULL,
  "definition" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (definition_key, version),
  CONSTRAINT "chk_review_workflow_definition_key"
    CHECK (definition_key ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  CONSTRAINT "chk_review_workflow_definition_version" CHECK (version > 0),
  CONSTRAINT "chk_review_workflow_definition_shape"
    CHECK (jsonb_typeof(definition) = 'object' AND jsonb_typeof(definition->'steps') = 'array')
);
INSERT INTO "internal"."review_workflow_definitions"
  (definition_key, version, definition)
VALUES (
  'default-scientific-review',
  1,
  '{"steps":[{"key":"scientific-review","required":true}],"requiresSignature":false}'
);
REVOKE ALL ON "internal"."review_workflow_definitions"
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE TABLE "api"."review_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  "record_id" uuid NOT NULL REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  "revision_id" uuid NOT NULL UNIQUE REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "state" text NOT NULL DEFAULT 'submitted',
  "workflow_definition_key" text NOT NULL,
  "workflow_definition_version" integer NOT NULL,
  "assigned_reviewer_user_ids" text[] NOT NULL,
  "submitted_by_user_id" text NOT NULL REFERENCES "internal"."user"("id") ON DELETE RESTRICT,
  "submitted_session_id" text NOT NULL,
  "submitted_role" text NOT NULL,
  "submitted_at" timestamptz NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_review_submissions_state" CHECK (state = 'submitted'),
  CONSTRAINT "chk_review_submissions_workflow_key"
    CHECK (workflow_definition_key ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  CONSTRAINT "chk_review_submissions_workflow_version"
    CHECK (workflow_definition_version > 0),
  CONSTRAINT "chk_review_submissions_reviewers"
    CHECK (cardinality(assigned_reviewer_user_ids) > 0),
  CONSTRAINT "chk_review_submissions_idempotency_key"
    CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT "review_submissions_workflow_definition_fk"
    FOREIGN KEY (workflow_definition_key, workflow_definition_version)
    REFERENCES "internal"."review_workflow_definitions"(definition_key, version)
    ON DELETE RESTRICT,
  CONSTRAINT "uq_review_submissions_actor_idempotency"
    UNIQUE (workspace_id, submitted_by_user_id, idempotency_key)
);
--> statement-breakpoint

CREATE INDEX "idx_review_submissions_workspace_state"
  ON "api"."review_submissions" ("workspace_id", "state", "submitted_at" DESC);
CREATE INDEX "idx_review_submissions_record"
  ON "api"."review_submissions" ("record_id", "submitted_at" DESC);
--> statement-breakpoint

ALTER TABLE "api"."review_submissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "review_submissions_select" ON "api"."review_submissions"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );
--> statement-breakpoint

GRANT SELECT ON "api"."review_submissions" TO authenticated;
--> statement-breakpoint

-- Dynamic generated scientific tables are snapshotted through their
-- allowlisted resource_name from api.scientific_tables.
CREATE FUNCTION "internal"."revision_scientific_rows"(p_resource_name text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF p_resource_name !~ '^sheet_[a-z2-7]{26}$'
     OR to_regclass(format('api.%I', p_resource_name)) IS NULL THEN
    RAISE EXCEPTION 'invalid scientific resource' USING ERRCODE = '22023';
  END IF;
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.id), ''[]''::jsonb) FROM api.%I row_data',
    p_resource_name
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."revision_scientific_rows"(text)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION "internal"."build_revision_envelope"(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  record_row api.records;
  result jsonb;
BEGIN
  SELECT * INTO record_row FROM api.records WHERE id = p_record_id;
  IF record_row.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'formatVersion', 1,
    'record', jsonb_build_object(
      'id', record_row.id,
      'workspaceId', record_row.workspace_id,
      'projectId', record_row.project_id,
      'folderId', record_row.folder_id,
      'kind', record_row.kind,
      'identifier', record_row.identifier,
      'title', record_row.title,
      'status', record_row.status,
      'properties', record_row.properties,
      'tags', record_row.tags,
      'structureVersion', record_row.structure_version,
      'metadataVersion', record_row.metadata_version,
      'calculationInputRevision', record_row.calculation_input_revision,
      'createdAt', record_row.created_at,
      'createdByUserId', record_row.created_by_user_id,
      'updatedAt', record_row.updated_at,
      'updatedByUserId', record_row.updated_by_user_id
    ),
    'blocks', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id, 'type', b.type, 'payloadSchemaVersion', b.payload_schema_version,
          'version', b.version, 'order', b."order", 'payload', b.payload,
          'createdAt', b.created_at, 'createdByUserId', b.created_by_user_id,
          'updatedAt', b.updated_at, 'updatedByUserId', b.updated_by_user_id
        ) ORDER BY b."order", b.id
      ) FROM api.blocks b WHERE b.record_id = record_row.id
    ), '[]'::jsonb),
    'links', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', link.id, 'sourceRecordId', link.source_record_id,
          'targetRecordId', link.target_record_id, 'targetKind', link.target_kind,
          'targetIdentifier', link.target_identifier, 'linkType', link.link_type,
          'linkMetadata', link.link_metadata,
          'pinnedTargetRevisionId', coalesce(
            link.link_metadata->>'targetRevisionId',
            link.link_metadata->>'template_revision_id'
          ),
          'createdAt', link.created_at, 'createdByUserId', link.created_by_user_id
        ) ORDER BY link.id
      ) FROM api.record_links link WHERE link.source_record_id = record_row.id
    ), '[]'::jsonb),
    'scientificTables', coalesce((
      SELECT jsonb_agg(
        to_jsonb(table_row) || jsonb_build_object(
          'columns', coalesce((
            SELECT jsonb_agg(
              to_jsonb(column_row) || jsonb_build_object(
                'options', coalesce((
                  SELECT jsonb_agg(to_jsonb(option_row) ORDER BY option_row.display_order, option_row.id)
                  FROM api.scientific_category_options option_row
                  WHERE option_row.column_id = column_row.id
                ), '[]'::jsonb)
              ) ORDER BY column_row.display_order, column_row.id
            ) FROM api.scientific_columns column_row
            WHERE column_row.table_id = table_row.id
          ), '[]'::jsonb),
          'rows', internal.revision_scientific_rows(table_row.resource_name)
        ) ORDER BY table_row.id
      ) FROM api.scientific_tables table_row
      WHERE table_row.record_id = record_row.id
    ), '[]'::jsonb),
    'formulas', coalesce((
      SELECT jsonb_agg(
        to_jsonb(formula_row) || jsonb_build_object(
          'dependencies', coalesce((
            SELECT jsonb_agg(to_jsonb(dependency_row) ORDER BY dependency_row.source_table_id, dependency_row.source_row_id, dependency_row.source_column_id)
            FROM api.formula_dependencies dependency_row
            WHERE dependency_row.formula_id = formula_row.id
          ), '[]'::jsonb),
          'calculation', CASE WHEN calculation_row.formula_id IS NULL THEN NULL
            ELSE to_jsonb(calculation_row) END
        ) ORDER BY formula_row.id
      )
      FROM api.formula_definitions formula_row
      LEFT JOIN internal.formula_result_cache calculation_row
        ON calculation_row.formula_id = formula_row.id
      WHERE formula_row.record_id = record_row.id
    ), '[]'::jsonb),
    'files', coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', file_row.id,
          'recordId', file_row.record_id,
          'displayName', file_row.display_name,
          'mediaType', file_row.media_type,
          'byteSize', file_row.byte_size,
          'checksum', file_row.checksum,
          'checksumAlgorithm', file_row.checksum_algorithm,
          'storageKey', file_row.storage_key,
          'storageBackend', file_row.storage_backend,
          'status', file_row.status,
          'version', file_row.version,
          'attachments', coalesce((
            SELECT jsonb_agg(attachment ORDER BY attachment->>'kind', attachment->>'id')
            FROM (
              SELECT jsonb_build_object('kind','record','id',record_row.id,'target','direct') attachment
              WHERE file_row.record_id = record_row.id
              UNION ALL
              SELECT jsonb_build_object('kind','link','id',link.id,'target',link.link_metadata)
              FROM api.record_links link
              WHERE link.source_record_id = record_row.id AND link.target_record_id = file_row.record_id
              UNION ALL
              SELECT jsonb_build_object('kind','block','id',block_row.id,'target',block_row.payload)
              FROM api.blocks block_row
              WHERE block_row.record_id = record_row.id
                AND block_row.type = 'file'
                AND coalesce(block_row.payload->>'fileRecordId', block_row.payload->>'file_record_id') = file_row.record_id::text
            ) attachment_rows
          ), '[]'::jsonb)
        ) ORDER BY file_row.id
      )
      FROM api.file_objects file_row
      WHERE file_row.record_id = record_row.id
         OR EXISTS (
           SELECT 1 FROM api.record_links link
           WHERE link.source_record_id = record_row.id AND link.target_record_id = file_row.record_id
         )
         OR EXISTS (
           SELECT 1 FROM api.blocks block_row
           WHERE block_row.record_id = record_row.id
             AND block_row.type = 'file'
             AND coalesce(block_row.payload->>'fileRecordId', block_row.payload->>'file_record_id') = file_row.record_id::text
         )
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."build_revision_envelope"(uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION "internal"."revision_integrity_digest"(p_envelope jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = '' AS $$
  SELECT encode(sha256(convert_to(p_envelope::text, 'UTF8')), 'hex')
$$;
REVOKE EXECUTE ON FUNCTION "internal"."revision_integrity_digest"(jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- Preserve migrator/seed compatibility for legacy non-submission revisions;
-- request roles cannot INSERT after the grant revocation below.
CREATE FUNCTION "internal"."prepare_revision_insert"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.workspace_id IS NULL THEN
    SELECT workspace_id INTO NEW.workspace_id FROM api.records WHERE id = NEW.record_id;
  END IF;
  IF NEW.canonical_snapshot IS NULL THEN
    NEW.canonical_snapshot := jsonb_build_object(
      'formatVersion', 0,
      'record', NEW.metadata_snapshot,
      'blocks', NEW.block_snapshot,
      'links', '[]'::jsonb,
      'scientificTables', '[]'::jsonb,
      'formulas', '[]'::jsonb,
      'files', '[]'::jsonb
    );
  END IF;
  IF NEW.integrity_digest IS NULL THEN
    NEW.integrity_digest := internal.revision_integrity_digest(NEW.canonical_snapshot);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prepare_revision_insert"()
  FROM PUBLIC, authenticated, api_client;
CREATE TRIGGER "prepare_revision_insert"
  BEFORE INSERT ON "api"."revisions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prepare_revision_insert"();
--> statement-breakpoint

CREATE FUNCTION "internal"."prevent_frozen_revision_mutation"()
RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- The migration owner remains able to run controlled fixture cleanup and
  -- future migrations. Application, PostgREST and service roles all fail.
  IF current_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'submitted revision evidence is immutable' USING ERRCODE = '42501';
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."prevent_frozen_revision_mutation"()
  FROM PUBLIC, authenticated, api_client;
DROP TRIGGER IF EXISTS "set_updated_at" ON "api"."revisions";
CREATE TRIGGER "prevent_frozen_revision_mutation"
  BEFORE UPDATE OR DELETE ON "api"."revisions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."prevent_frozen_revision_mutation"();
--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON "api"."revisions" FROM authenticated, api_client;
DROP POLICY IF EXISTS "revisions_insert" ON "api"."revisions";
--> statement-breakpoint

CREATE FUNCTION "api"."preview_submission_digest"(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  claimed_workspace uuid;
  record_row api.records;
  envelope jsonb;
BEGIN
  BEGIN
    claimed_workspace := nullif(api.claim_probe()->>'workspace_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END;
  SELECT * INTO record_row FROM api.records
  WHERE id = p_record_id
    AND workspace_id = claimed_workspace
    AND api.is_workspace_member(workspace_id);
  IF record_row.id IS NULL OR record_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;
  envelope := internal.build_revision_envelope(record_row.id);
  RETURN jsonb_build_object(
    'recordId', record_row.id,
    'sourceDigest', internal.revision_integrity_digest(envelope),
    'structureVersion', record_row.structure_version,
    'metadataVersion', record_row.metadata_version,
    'calculationInputRevision', record_row.calculation_input_revision
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."preview_submission_digest"(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."preview_submission_digest"(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION "api"."submit_record_revision"(
  p_record_id uuid,
  p_expected_source_digest text,
  p_workflow_definition_key text,
  p_workflow_definition_version integer,
  p_reviewer_user_ids text[],
  p_confirmed boolean,
  p_idempotency_key text
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
     OR NOT api.is_workspace_member(claimed_workspace) THEN
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

  SELECT * INTO record_row FROM api.records
  WHERE id = p_record_id
    AND workspace_id = claimed_workspace
    AND deleted_at IS NULL
  FOR UPDATE;
  IF record_row.id IS NULL THEN
    RAISE EXCEPTION 'record denied' USING ERRCODE = '42501';
  END IF;

  envelope := internal.build_revision_envelope(record_row.id);
  actual_digest := internal.revision_integrity_digest(envelope);
  IF actual_digest <> p_expected_source_digest THEN
    RAISE EXCEPTION 'submission source changed' USING ERRCODE = 'SB001';
  END IF;

  INSERT INTO api.revisions (
    record_id, workspace_id, structure_version, metadata_version,
    metadata_snapshot, block_snapshot, canonical_snapshot,
    integrity_algorithm, integrity_digest, reason, created_at, updated_at,
    created_by_user_id
  ) VALUES (
    record_row.id, record_row.workspace_id, record_row.structure_version,
    record_row.metadata_version, envelope->'record', envelope->'blocks', envelope,
    'sha256', actual_digest, 'submit', submitted_at, submitted_at, actor
  ) RETURNING * INTO revision_row;

  INSERT INTO api.review_submissions (
    workspace_id, record_id, revision_id, state,
    workflow_definition_key, workflow_definition_version,
    assigned_reviewer_user_ids, submitted_by_user_id, submitted_at,
    submitted_session_id, submitted_role, idempotency_key, created_at, updated_at
  ) VALUES (
    claimed_workspace, record_row.id, revision_row.id, 'submitted',
    p_workflow_definition_key, p_workflow_definition_version,
    normalized_reviewers, actor, submitted_at, session_id, actor_role, p_idempotency_key,
    submitted_at, submitted_at
  ) RETURNING * INTO submission_row;

  RETURN jsonb_build_object(
    'revision', jsonb_build_object('id', revision_row.id, 'integrityDigest', revision_row.integrity_digest),
    'submission', jsonb_build_object('id', submission_row.id, 'state', submission_row.state),
    'idempotent', false
  );
EXCEPTION WHEN unique_violation THEN
  -- A concurrent retry may win the unique idempotency race. Re-read it and
  -- return the same result only when it describes this exact command.
  SELECT * INTO existing_submission
  FROM api.review_submissions
  WHERE workspace_id = claimed_workspace
    AND submitted_by_user_id = actor
    AND idempotency_key = p_idempotency_key;
  SELECT * INTO existing_revision FROM api.revisions
  WHERE id = existing_submission.revision_id;
  IF existing_submission.id IS NOT NULL
     AND existing_submission.record_id = p_record_id
     AND existing_submission.workflow_definition_key = p_workflow_definition_key
     AND existing_submission.workflow_definition_version = p_workflow_definition_version
     AND existing_submission.assigned_reviewer_user_ids = normalized_reviewers
     AND existing_revision.integrity_digest = p_expected_source_digest THEN
    RETURN jsonb_build_object(
      'revision', jsonb_build_object('id', existing_revision.id, 'integrityDigest', existing_revision.integrity_digest),
      'submission', jsonb_build_object('id', existing_submission.id, 'state', existing_submission.state),
      'idempotent', true
    );
  END IF;
  RAISE;
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."submit_record_revision"(uuid,text,text,integer,text[],boolean,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."submit_record_revision"(uuid,text,text,integer,text[],boolean,text)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
