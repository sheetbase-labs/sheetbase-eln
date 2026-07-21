-- SCI-003: file records and the object-storage boundary (decision 0028).
-- file becomes a records.kind; universal storage metadata lives on a 1:1
-- api.file_objects table. Lifecycle states active/quarantined/deleted/missing
-- are enforced at the database. The change-event stream gains the file entity.

-- ---------------------------------------------------------------------------
-- 1. Widen records.kind and the create_record prefix map.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."records" DROP CONSTRAINT "chk_records_kind";--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "chk_records_kind"
  CHECK ("api"."records"."kind" IN ('experiment', 'protocol_template', 'report', 'sample', 'reagent', 'file'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."create_record"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_properties jsonb DEFAULT '{}'
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_prefix text;
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
  v_identifier text;
  v_row "api"."records";
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  v_prefix := CASE p_kind
    WHEN 'experiment' THEN 'EXP'
    WHEN 'protocol_template' THEN 'PRT'
    WHEN 'report' THEN 'RPT'
    WHEN 'sample' THEN 'SMP'
    WHEN 'reagent' THEN 'RGT'
    WHEN 'file' THEN 'FILE'
    ELSE NULL
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'unsupported record kind: %', p_kind USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "api"."projects" p
    WHERE p.id = p_project_id
      AND p.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) + 1 INTO v_seq
    FROM "api"."records"
    WHERE project_id = p_project_id
      AND identifier LIKE v_prefix || '-' || v_year || '-%';

  v_identifier := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  p_title := btrim(coalesce(p_title, ''));
  IF p_title = '' THEN
    p_title := v_identifier;
  END IF;

  INSERT INTO "api"."records"
    (workspace_id, project_id, kind, identifier, title, status, tags,
     properties, created_by_user_id)
  VALUES
    (v_workspace_id, p_project_id, p_kind, v_identifier, p_title, p_status,
     p_tags, COALESCE(p_properties, '{}'::jsonb), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[], jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[], jsonb) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. file_objects: universal storage-boundary metadata, 1:1 with a file record.
-- ---------------------------------------------------------------------------
CREATE TABLE "api"."file_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE CASCADE,
  "record_id" uuid NOT NULL UNIQUE REFERENCES "api"."records"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "media_type" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "checksum" text,
  "checksum_algorithm" text NOT NULL DEFAULT 'sha256',
  "status" text NOT NULL DEFAULT 'active',
  "status_reason" text,
  "storage_backend" text NOT NULL DEFAULT 'local',
  "quarantined_at" timestamptz,
  "deleted_at" timestamptz,
  "version" integer NOT NULL DEFAULT 1,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chk_file_objects_status"
    CHECK ("status" IN ('active', 'quarantined', 'deleted', 'missing')),
  CONSTRAINT "chk_file_objects_byte_size"
    CHECK ("byte_size" BETWEEN 0 AND 104857600),
  CONSTRAINT "chk_file_objects_media_type"
    CHECK ("media_type" IN (
      'text/csv', 'text/plain', 'application/json', 'application/pdf',
      'image/png', 'image/jpeg', 'image/tiff', 'image/webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/octet-stream'
    )),
  CONSTRAINT "chk_file_objects_storage_backend"
    CHECK ("storage_backend" IN ('local', 's3')),
  CONSTRAINT "chk_file_objects_checksum_algorithm"
    CHECK ("checksum_algorithm" = 'sha256'),
  CONSTRAINT "chk_file_objects_storage_key"
    CHECK ("storage_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}$'),
  CONSTRAINT "chk_file_objects_deleted_consistency"
    CHECK (("status" = 'deleted') = ("deleted_at" IS NOT NULL)),
  CONSTRAINT "chk_file_objects_quarantined_consistency"
    CHECK (("status" = 'quarantined') = ("quarantined_at" IS NOT NULL))
);--> statement-breakpoint

CREATE INDEX "idx_file_objects_workspace" ON "api"."file_objects"("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_file_objects_record" ON "api"."file_objects"("record_id");--> statement-breakpoint

ALTER TABLE "api"."file_objects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "file_objects_select" ON "api"."file_objects"
  FOR SELECT TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  );--> statement-breakpoint

CREATE POLICY "file_objects_insert" ON "api"."file_objects"
  FOR INSERT TO authenticated
  WITH CHECK (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
    AND created_by_user_id = "api"."current_user_id"()
  );--> statement-breakpoint

CREATE POLICY "file_objects_update" ON "api"."file_objects"
  FOR UPDATE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id)
  )
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "file_objects_delete" ON "api"."file_objects"
  FOR DELETE TO authenticated
  USING (
    workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(workspace_id, 'owner')
  );--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."file_objects" TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."file_objects" TO api_client;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Widen the change-event vocabulary for file entities and quarantine.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("entity_type" IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation', 'record_field_definition', 'file'));--> statement-breakpoint

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_operation";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_operation"
  CHECK ("operation" IN ('create', 'update', 'move', 'delete', 'archive', 'restore', 'link', 'unlink', 'quarantine'));--> statement-breakpoint

-- file_objects: create / quarantine / restore / update / delete. project_id is
-- recovered via the parent file record.
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_file_objects"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
  v_record "api"."records";
  v_project_id uuid;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = NEW.record_id;
    v_project_id := v_record.project_id;
    v_op := 'create';
    v_payload := jsonb_build_object(
      'recordId', NEW.record_id, 'storageKey', NEW.storage_key,
      'displayName', NEW.display_name, 'mediaType', NEW.media_type,
      'byteSize', NEW.byte_size, 'status', NEW.status
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'file', NEW.id, v_op, NEW.record_id, v_project_id, v_payload
    );
  ELSIF (TG_OP = 'UPDATE') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = NEW.record_id;
    v_project_id := v_record.project_id;
    IF OLD.status = 'active' AND NEW.status = 'quarantined' THEN
      v_op := 'quarantine';
    ELSIF OLD.status = 'quarantined' AND NEW.status = 'active' THEN
      v_op := 'restore';
    ELSIF OLD.status <> 'deleted' AND NEW.status = 'deleted' THEN
      v_op := 'delete';
    ELSIF OLD.status = 'deleted' AND NEW.status = 'active' THEN
      v_op := 'restore';
    ELSIF OLD.status <> 'missing' AND NEW.status = 'missing' THEN
      v_op := 'update';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'recordId', NEW.record_id, 'status', NEW.status,
      'statusReason', NEW.status_reason,
      'byteSize', NEW.byte_size, 'checksum', NEW.checksum,
      'version', NEW.version
    );
    PERFORM "internal"."emit_change_event"(
      NEW.workspace_id, 'file', NEW.id, v_op, NEW.record_id, v_project_id, v_payload
    );
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT * INTO v_record FROM "api"."records" WHERE id = OLD.record_id;
    v_project_id := COALESCE(v_record.project_id, NULL);
    PERFORM "internal"."emit_change_event"(
      OLD.workspace_id, 'file', OLD.id, 'delete', OLD.record_id, v_project_id,
      jsonb_build_object('recordId', OLD.record_id, 'storageKey', OLD.storage_key)
    );
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_file_objects"() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER "change_event_file_objects"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."file_objects"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_file_objects"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. transition_file_status: transactional lifecycle RPC for file objects.
-- SECURITY INVOKER: the UPDATE is still subject to file_objects RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."transition_file_status"(
  p_file_id uuid,
  p_target_status text,
  p_expected_version int,
  p_reason text DEFAULT NULL
)
RETURNS "api"."file_objects"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."file_objects";
  v_transition_key text;
  v_allowed text[];
BEGIN
  SELECT * INTO v_row FROM "api"."file_objects" WHERE id = p_file_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'file object not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.version <> p_expected_version THEN
    RAISE EXCEPTION 'file version mismatch: expected %, got %',
      p_expected_version, v_row.version USING ERRCODE = 'SB001';
  END IF;

  v_transition_key := v_row.status || '->' || p_target_status;
  v_allowed := ARRAY[
    'active->quarantined',
    'quarantined->active',
    'active->deleted',
    'quarantined->deleted',
    'deleted->active',
    'active->missing',
    'quarantined->missing',
    'missing->active',
    'missing->quarantined',
    'missing->deleted'
  ];

  IF NOT (v_transition_key = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid file status transition: % -> %',
      v_row.status, p_target_status USING ERRCODE = 'SB004';
  END IF;

  UPDATE "api"."file_objects"
    SET
      status = p_target_status,
      status_reason = CASE
        WHEN p_target_status IN ('quarantined','missing') THEN p_reason
        ELSE NULL
      END,
      quarantined_at = CASE
        WHEN p_target_status = 'quarantined' THEN clock_timestamp()
        ELSE NULL
      END,
      deleted_at = CASE
        WHEN p_target_status = 'deleted' THEN clock_timestamp()
        ELSE NULL
      END,
      version = v_row.version + 1,
      updated_by_user_id = "api"."current_user_id"(),
      updated_at = clock_timestamp()
    WHERE id = p_file_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."transition_file_status"(uuid, text, int, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."transition_file_status"(uuid, text, int, text) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Extend validate_scientific_block for the file block payload.
-- The file block references a file record in the same workspace; its cached
-- display metadata must match the live file_objects row at write time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."validate_scientific_block"() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  owner api.records; target api.records; rev api.revisions; item jsonb; old_item jsonb;
  actor text; item_id text;
BEGIN
  IF NEW.type NOT IN ('protocol_reference','procedure_step','materials','file') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.type IS NOT DISTINCT FROM OLD.type
    AND NEW.payload_schema_version IS NOT DISTINCT FROM OLD.payload_schema_version
    AND NEW.payload IS NOT DISTINCT FROM OLD.payload THEN RETURN NEW; END IF;
  IF NEW.payload_schema_version <> 1 OR jsonb_typeof(NEW.payload) <> 'object' THEN
    RAISE EXCEPTION 'invalid SCI-002 payload schema' USING ERRCODE='23514';
  END IF;
  SELECT * INTO owner FROM api.records WHERE id=NEW.record_id;
  IF owner.id IS NULL THEN RAISE EXCEPTION 'block owner not found' USING ERRCODE='23503'; END IF;

  IF NEW.type='protocol_reference' THEN
    IF NEW.payload='{}'::jsonb THEN
      IF owner.kind <> 'experiment' THEN RAISE EXCEPTION 'protocol draft requires experiment' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    IF current_user IN ('authenticated','api_client') THEN
      RAISE EXCEPTION 'populated protocol references require pin_protocol_reference' USING ERRCODE='42501';
    END IF;
    BEGIN
      SELECT * INTO target FROM api.records WHERE id=(NEW.payload->>'protocolRecordId')::uuid;
      SELECT * INTO rev FROM api.revisions WHERE id=(NEW.payload->>'protocolRevisionId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid protocol UUID' USING ERRCODE='23514'; END;
    IF TG_OP='UPDATE' AND OLD.payload <> '{}'::jsonb AND NEW.payload IS DISTINCT FROM OLD.payload THEN
      RAISE EXCEPTION 'pinned protocol reference is immutable' USING ERRCODE='23514';
    END IF;
    IF owner.kind<>'experiment' OR target.id IS NULL OR rev.id IS NULL OR target.deleted_at IS NOT NULL
       OR target.kind<>'protocol_template' OR target.workspace_id<>owner.workspace_id OR rev.record_id<>target.id
       OR NEW.payload->>'protocolIdentifier' IS DISTINCT FROM rev.metadata_snapshot->>'identifier'
       OR NEW.payload->>'protocolTitle' IS DISTINCT FROM rev.metadata_snapshot->>'title'
       OR NEW.payload->>'version' IS DISTINCT FROM COALESCE(rev.metadata_snapshot#>>'{properties,version}',rev.metadata_version::text)
       OR NEW.payload->>'approvalStatus' IS DISTINCT FROM rev.metadata_snapshot->>'status'
       OR (NEW.payload->>'pinnedAt')::timestamptz IS DISTINCT FROM rev.created_at
       OR NEW.payload->>'pinnedByUserId' IS DISTINCT FROM rev.created_by_user_id THEN
      RAISE EXCEPTION 'invalid pinned protocol reference' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.type='procedure_step' THEN
    IF jsonb_typeof(NEW.payload->'text') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'stepNumber') IS DISTINCT FROM 'number'
      OR (NEW.payload->>'stepNumber')::numeric <> trunc((NEW.payload->>'stepNumber')::numeric) THEN
      RAISE EXCEPTION 'invalid procedure definition' USING ERRCODE='23514';
    END IF;
    IF owner.kind='protocol_template' THEN
      IF NEW.payload ?| ARRAY['sourceProtocolRevisionId','sourceStepBlockId','completed','note','completedAt','completedByUserId'] THEN
        RAISE EXCEPTION 'protocol definition cannot carry execution state' USING ERRCODE='23514';
      END IF;
    ELSIF owner.kind='experiment' THEN
      actor := api.current_user_id();
      IF TG_OP='INSERT' AND current_user IN ('authenticated','api_client') THEN
        RAISE EXCEPTION 'execution steps are created by pin_protocol_reference' USING ERRCODE='42501';
      END IF;
      BEGIN
        SELECT * INTO rev FROM api.revisions WHERE id=(NEW.payload->>'sourceProtocolRevisionId')::uuid;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step') THEN
          RAISE EXCEPTION 'source step is not in revision' USING ERRCODE='23514';
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid step provenance' USING ERRCODE='23514'; END;
      IF rev.id IS NULL OR NOT EXISTS (SELECT 1 FROM api.records rr WHERE rr.id=rev.record_id AND rr.workspace_id=owner.workspace_id AND rr.kind='protocol_template')
        OR jsonb_typeof(NEW.payload->'completed') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(NEW.payload->'note') IS DISTINCT FROM 'string' THEN
        RAISE EXCEPTION 'invalid execution step' USING ERRCODE='23514';
      END IF;
      IF NEW.payload->'text' IS DISTINCT FROM (
          SELECT x->'payload'->'text' FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step'
        ) OR NEW.payload->'stepNumber' IS DISTINCT FROM (
          SELECT x->'payload'->'stepNumber' FROM jsonb_array_elements(rev.block_snapshot) x
          WHERE x->>'id'=NEW.payload->>'sourceStepBlockId' AND x->>'type'='procedure_step'
        ) THEN RAISE EXCEPTION 'execution step differs from pinned revision' USING ERRCODE='23514'; END IF;
      IF TG_OP='UPDATE' AND (NEW.payload->'text' IS DISTINCT FROM OLD.payload->'text'
        OR NEW.payload->'stepNumber' IS DISTINCT FROM OLD.payload->'stepNumber'
        OR NEW.payload->'sourceProtocolRevisionId' IS DISTINCT FROM OLD.payload->'sourceProtocolRevisionId'
        OR NEW.payload->'sourceStepBlockId' IS DISTINCT FROM OLD.payload->'sourceStepBlockId') THEN
        RAISE EXCEPTION 'execution step definition is immutable' USING ERRCODE='23514';
      END IF;
      IF TG_OP='INSERT' OR (OLD.payload->>'completed')::boolean IS DISTINCT FROM (NEW.payload->>'completed')::boolean THEN
        IF (NEW.payload->>'completed')::boolean THEN
          NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}',to_jsonb(clock_timestamp())),
            '{completedByUserId}',to_jsonb(actor));
        ELSE NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}','null'),'{completedByUserId}','null'); END IF;
      ELSE
        NEW.payload := jsonb_set(jsonb_set(NEW.payload,'{completedAt}',OLD.payload->'completedAt'),'{completedByUserId}',OLD.payload->'completedByUserId');
      END IF;
    ELSE RAISE EXCEPTION 'procedure step owner is invalid' USING ERRCODE='23514'; END IF;
  ELSIF NEW.type='file' THEN
    -- A draft file block (empty payload) is allowed; the upload flow populates
    -- it with a fileRecordId referencing a file record in this workspace.
    IF NEW.payload='{}'::jsonb THEN
      RETURN NEW;
    END IF;
    IF jsonb_typeof(NEW.payload->'fileRecordId') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'fileIdentifier') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'displayName') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'mediaType') IS DISTINCT FROM 'string'
      OR jsonb_typeof(NEW.payload->'byteSize') IS DISTINCT FROM 'number'
      OR (NEW.payload->>'byteSize')::numeric < 0 THEN
      RAISE EXCEPTION 'invalid file block payload' USING ERRCODE='23514';
    END IF;
    BEGIN
      SELECT * INTO target FROM api.records WHERE id=(NEW.payload->>'fileRecordId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid file record UUID' USING ERRCODE='23514'; END;
    IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.kind<>'file'
       OR target.workspace_id<>owner.workspace_id
       OR NEW.payload->>'fileIdentifier' IS DISTINCT FROM target.identifier THEN
      RAISE EXCEPTION 'invalid file block target' USING ERRCODE='23514';
    END IF;
    -- The cached display metadata must match the live storage object so the
    -- block cannot lie about name, type or size at write time. The live status
    -- is fetched by the UI; it is not cached in the block payload.
    IF NOT EXISTS (
      SELECT 1 FROM api.file_objects fo
      WHERE fo.record_id=target.id AND fo.workspace_id=owner.workspace_id
        AND fo.display_name = NEW.payload->>'displayName'
        AND fo.media_type = NEW.payload->>'mediaType'
        AND fo.byte_size = (NEW.payload->>'byteSize')::bigint
    ) THEN
      RAISE EXCEPTION 'file block metadata does not match storage object' USING ERRCODE='23514';
    END IF;
  ELSE
    IF current_user='api_client' THEN
      RAISE EXCEPTION 'credential-authored scientific block writes are not supported' USING ERRCODE='42501';
    END IF;
    actor := CASE WHEN current_user='authenticated' THEN api.current_user_id() ELSE NULL END;
    IF owner.kind<>'experiment' OR jsonb_typeof(NEW.payload->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid materials payload' USING ERRCODE='23514'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.payload->'items') i GROUP BY i->>'id' HAVING count(*)>1) THEN
      RAISE EXCEPTION 'duplicate material item id' USING ERRCODE='23514';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'items') LOOP
      item_id:=item->>'id';
      IF item_id IS NULL OR item_id='' OR jsonb_typeof(item->'materialRecordId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'kind') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'identifier') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'title') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item->'quantity') IS DISTINCT FROM 'number' OR (item->>'quantity')::numeric<=0
        OR jsonb_typeof(item->'unit') IS DISTINCT FROM 'object' OR jsonb_typeof(item#>'{unit,code}') IS DISTINCT FROM 'string'
        OR jsonb_typeof(item#>'{unit,symbol}') IS DISTINCT FROM 'string' OR btrim(item#>>'{unit,code}')='' OR btrim(item#>>'{unit,symbol}')=''
        OR item->>'observedAt' IS NULL THEN RAISE EXCEPTION 'invalid material item' USING ERRCODE='23514'; END IF;
      BEGIN PERFORM (item->>'observedAt')::timestamptz;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'invalid material observation timestamp' USING ERRCODE='23514'; END;
      IF TG_OP='UPDATE' THEN
        SELECT value INTO old_item FROM jsonb_array_elements(OLD.payload->'items') WHERE value->>'id'=item_id;
        IF old_item IS NOT NULL AND (item->'materialRecordId' IS DISTINCT FROM old_item->'materialRecordId'
          OR item->'kind' IS DISTINCT FROM old_item->'kind' OR item->'identifier' IS DISTINCT FROM old_item->'identifier'
          OR item->'title' IS DISTINCT FROM old_item->'title' OR item->'observedAt' IS DISTINCT FROM old_item->'observedAt') THEN
          RAISE EXCEPTION 'material observation identity is immutable' USING ERRCODE='23514'; END IF;
      END IF;
      IF old_item IS NULL THEN
        BEGIN SELECT * INTO target FROM api.records WHERE id=(item->>'materialRecordId')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'invalid material UUID' USING ERRCODE='23514'; END;
        IF target.id IS NULL OR target.deleted_at IS NOT NULL OR target.workspace_id<>owner.workspace_id
          OR target.kind NOT IN ('sample','reagent') OR item->>'kind' IS DISTINCT FROM target.kind
          OR item->>'identifier' IS DISTINCT FROM target.identifier OR item->>'title' IS DISTINCT FROM target.title THEN
          RAISE EXCEPTION 'invalid material target' USING ERRCODE='23514'; END IF;
        INSERT INTO api.record_links(source_record_id,target_record_id,target_kind,target_identifier,link_type,created_by_user_id)
        VALUES(owner.id,target.id,target.kind,target.identifier,target.kind,COALESCE(actor,NEW.created_by_user_id))
        ON CONFLICT (source_record_id,target_identifier,link_type) DO UPDATE SET target_record_id=EXCLUDED.target_record_id,target_kind=EXCLUDED.target_kind;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."validate_scientific_block"() FROM PUBLIC;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';--> statement-breakpoint
