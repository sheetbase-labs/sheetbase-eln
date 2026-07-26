-- REV-002 follow-up: retain the physical object identity behind every file
-- captured by submitted evidence, and make byte replacement create-only.

CREATE TABLE "internal"."revision_file_objects" (
  "revision_id" uuid NOT NULL
    REFERENCES "api"."revisions"("id") ON DELETE RESTRICT,
  "file_object_id" uuid NOT NULL
    REFERENCES "api"."file_objects"("id") ON DELETE RESTRICT,
  "workspace_id" uuid NOT NULL
    REFERENCES "api"."workspaces"("id") ON DELETE RESTRICT,
  "file_record_id" uuid NOT NULL
    REFERENCES "api"."records"("id") ON DELETE RESTRICT,
  "storage_key" text NOT NULL,
  "storage_backend" text NOT NULL,
  "checksum_algorithm" text NOT NULL,
  "checksum" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (revision_id, file_object_id),
  CONSTRAINT "uq_revision_file_objects_storage_key"
    UNIQUE (revision_id, storage_key),
  CONSTRAINT "chk_revision_file_objects_checksum_algorithm"
    CHECK (checksum_algorithm = 'sha256'),
  CONSTRAINT "chk_revision_file_objects_checksum"
    CHECK (checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_revision_file_objects_byte_size"
    CHECK (byte_size BETWEEN 0 AND 104857600)
);
CREATE INDEX "idx_revision_file_objects_file_object"
  ON "internal"."revision_file_objects" (file_object_id);
CREATE INDEX "idx_revision_file_objects_file_record"
  ON "internal"."revision_file_objects" (file_record_id);
REVOKE ALL ON "internal"."revision_file_objects"
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- Backfill any revisions created after 0037 was deployed. Fail closed if a
-- snapshot no longer matches its current storage row; silently claiming that
-- changed or absent bytes are retained would create false evidence.
INSERT INTO "internal"."revision_file_objects" (
  revision_id, file_object_id, workspace_id, file_record_id, storage_key,
  storage_backend, checksum_algorithm, checksum, byte_size, created_at
)
SELECT
  revision.id,
  file_object.id,
  revision.workspace_id,
  file_object.record_id,
  evidence->>'storageKey',
  evidence->>'storageBackend',
  evidence->>'checksumAlgorithm',
  evidence->>'checksum',
  (evidence->>'byteSize')::bigint,
  revision.created_at
FROM api.revisions revision
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(revision.canonical_snapshot->'files') = 'array'
    THEN revision.canonical_snapshot->'files' ELSE '[]'::jsonb END
) evidence
JOIN api.file_objects file_object
  ON file_object.id = (evidence->>'id')::uuid
 AND file_object.workspace_id = revision.workspace_id
 AND file_object.record_id = (evidence->>'recordId')::uuid
 AND file_object.storage_key = evidence->>'storageKey'
 AND file_object.storage_backend = evidence->>'storageBackend'
 AND file_object.checksum_algorithm = evidence->>'checksumAlgorithm'
 AND file_object.checksum = evidence->>'checksum'
 AND file_object.byte_size = (evidence->>'byteSize')::bigint
 AND file_object.status IN ('active', 'quarantined');
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM api.revisions revision
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(revision.canonical_snapshot->'files') = 'array'
        THEN revision.canonical_snapshot->'files' ELSE '[]'::jsonb END
    ) evidence
    WHERE NOT EXISTS (
      SELECT 1 FROM internal.revision_file_objects retained
      WHERE retained.revision_id = revision.id
        AND retained.file_object_id = (evidence->>'id')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'existing submitted file evidence cannot be retained safely'
      USING ERRCODE = 'SB001';
  END IF;
END;
$$;
--> statement-breakpoint

CREATE FUNCTION "internal"."retain_revision_files"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  evidence jsonb;
  evidence_file_id uuid;
  evidence_record_id uuid;
  file_object api.file_objects;
BEGIN
  IF jsonb_typeof(NEW.canonical_snapshot->'files') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'revision files must be a canonical array'
      USING ERRCODE = '22023';
  END IF;

  FOR evidence IN
    SELECT value FROM jsonb_array_elements(NEW.canonical_snapshot->'files')
  LOOP
    BEGIN
      evidence_file_id := (evidence->>'id')::uuid;
      evidence_record_id := (evidence->>'recordId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'revision file identity is invalid' USING ERRCODE = '22023';
    END;

    SELECT * INTO file_object FROM api.file_objects
    WHERE id = evidence_file_id
    FOR UPDATE;

    IF file_object.id IS NULL
       OR file_object.workspace_id <> NEW.workspace_id
       OR file_object.record_id <> evidence_record_id
       OR file_object.storage_key IS DISTINCT FROM evidence->>'storageKey'
       OR file_object.storage_backend IS DISTINCT FROM evidence->>'storageBackend'
       OR file_object.checksum_algorithm IS DISTINCT FROM evidence->>'checksumAlgorithm'
       OR file_object.checksum IS NULL
       OR file_object.checksum !~ '^[0-9a-f]{64}$'
       OR file_object.checksum IS DISTINCT FROM evidence->>'checksum'
       OR file_object.byte_size IS DISTINCT FROM (evidence->>'byteSize')::bigint
       OR file_object.display_name IS DISTINCT FROM evidence->>'displayName'
       OR file_object.media_type IS DISTINCT FROM evidence->>'mediaType'
       OR file_object.status IS DISTINCT FROM evidence->>'status'
       OR file_object.status NOT IN ('active', 'quarantined') THEN
      RAISE EXCEPTION 'submitted file changed or has no retained bytes'
        USING ERRCODE = 'SB001';
    END IF;

    INSERT INTO internal.revision_file_objects (
      revision_id, file_object_id, workspace_id, file_record_id, storage_key,
      storage_backend, checksum_algorithm, checksum, byte_size, created_at
    ) VALUES (
      NEW.id, file_object.id, NEW.workspace_id, file_object.record_id,
      file_object.storage_key, file_object.storage_backend,
      file_object.checksum_algorithm, file_object.checksum,
      file_object.byte_size, NEW.created_at
    );
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."retain_revision_files"()
  FROM PUBLIC, authenticated, api_client;
CREATE TRIGGER "retain_revision_files"
  AFTER INSERT ON "api"."revisions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."retain_revision_files"();
--> statement-breakpoint

CREATE FUNCTION "internal"."protect_retained_file_object"()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM internal.revision_file_objects retained
    WHERE retained.file_object_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF session_user = 'migrator' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE'
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.record_id IS DISTINCT FROM OLD.record_id
     OR NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.storage_backend IS DISTINCT FROM OLD.storage_backend
     OR NEW.checksum_algorithm IS DISTINCT FROM OLD.checksum_algorithm
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
     OR NEW.status IN ('missing', 'deleted') THEN
    RAISE EXCEPTION 'submitted file bytes are retained and immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION "internal"."protect_retained_file_object"()
  FROM PUBLIC, authenticated, api_client;
CREATE TRIGGER "protect_retained_file_object"
  BEFORE UPDATE OR DELETE ON "api"."file_objects"
  FOR EACH ROW EXECUTE FUNCTION "internal"."protect_retained_file_object"();
--> statement-breakpoint

-- An authorised upload begins in `missing`: metadata may exist before bytes,
-- but such a placeholder cannot be submitted as evidence.
CREATE OR REPLACE FUNCTION "api"."create_file_upload"(
  p_project_id uuid,
  p_display_name text,
  p_media_type text,
  p_byte_size bigint,
  p_storage_key text,
  p_checksum text DEFAULT NULL,
  p_storage_backend text DEFAULT 'local',
  p_file_object_id uuid DEFAULT gen_random_uuid()
)
RETURNS TABLE(
  record_id uuid,
  identifier text,
  file_object_id uuid,
  storage_key text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_record "api"."records";
BEGIN
  SELECT * INTO v_record FROM "api"."create_record"(
    p_project_id, 'file', p_display_name, 'active', ARRAY[]::text[], '{}'::jsonb
  );

  INSERT INTO "api"."file_objects" (
    id, workspace_id, record_id, storage_key, display_name, media_type,
    byte_size, checksum, status, status_reason, storage_backend,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_file_object_id, v_record.workspace_id, v_record.id, p_storage_key,
    p_display_name, p_media_type, p_byte_size, p_checksum, 'missing',
    'upload pending', p_storage_backend,
    "api"."current_user_id"(), "api"."current_user_id"()
  );

  RETURN QUERY
    SELECT v_record.id, v_record.identifier, p_file_object_id, p_storage_key;
END;
$$;
--> statement-breakpoint

-- Finalization is the only byte-pointer swap used by the upload route. The
-- row lock serializes it against retention and other upload attempts.
CREATE FUNCTION "api"."finalize_file_upload"(
  p_file_id uuid,
  p_expected_version integer,
  p_expected_storage_key text,
  p_new_storage_key text,
  p_byte_size bigint,
  p_checksum text
)
RETURNS "api"."file_objects"
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  file_object api.file_objects;
BEGIN
  SELECT * INTO file_object FROM api.file_objects
  WHERE id = p_file_id
    AND workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  FOR UPDATE;

  IF file_object.id IS NULL THEN
    RAISE EXCEPTION 'file object denied' USING ERRCODE = '42501';
  END IF;
  IF file_object.version <> p_expected_version
     OR file_object.storage_key IS DISTINCT FROM p_expected_storage_key THEN
    RAISE EXCEPTION 'file upload changed concurrently' USING ERRCODE = 'SB001';
  END IF;
  IF file_object.status NOT IN ('active', 'missing') THEN
    RAISE EXCEPTION 'file is not uploadable' USING ERRCODE = '42501';
  END IF;
  IF p_new_storage_key = file_object.storage_key
     OR p_new_storage_key !~ (
       '^' || file_object.workspace_id::text || '/' || file_object.id::text || '/[0-9a-f]{32}$'
     )
     OR p_checksum !~ '^[0-9a-f]{64}$'
     OR p_byte_size NOT BETWEEN 0 AND 104857600 THEN
    RAISE EXCEPTION 'invalid finalized file evidence' USING ERRCODE = '22023';
  END IF;

  UPDATE api.file_objects
  SET storage_key = p_new_storage_key,
      byte_size = p_byte_size,
      checksum = p_checksum,
      status = 'active',
      status_reason = NULL,
      quarantined_at = NULL,
      deleted_at = NULL,
      version = file_object.version + 1,
      updated_by_user_id = api.current_user_id(),
      updated_at = clock_timestamp()
  WHERE id = file_object.id
  RETURNING * INTO file_object;

  RETURN file_object;
END;
$$;
REVOKE EXECUTE ON FUNCTION "api"."finalize_file_upload"(uuid,integer,text,text,bigint,text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "api"."finalize_file_upload"(uuid,integer,text,text,bigint,text)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
