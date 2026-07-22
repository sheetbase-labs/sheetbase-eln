-- SCI-006: reusable notebook and protocol templates (decision 0031).
--
-- Extends the existing record infrastructure with:
-- 1. notebook_template record kind (NBK-YYYY-NNNN) alongside protocol_template
-- 2. record_links.link_metadata JSONB for template-version provenance
-- 3. 'template' link type
-- 4. 'validate' revision reason for template-validation snapshots
-- 5. notebook_template status transitions (draft → validated)
-- 6. instantiate_template RPC for transactional deep-copy instantiation
--
-- No new tables. Templates are records; their blocks, links, revisions,
-- events and audit attribution are inherited from existing infrastructure.

-- ---------------------------------------------------------------------------
-- 1. Schema DDL: widen checks and add link_metadata column.
-- ---------------------------------------------------------------------------

ALTER TABLE "api"."records" DROP CONSTRAINT "chk_records_kind";--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "chk_records_kind" CHECK ("api"."records"."kind" IN ('experiment', 'protocol_template', 'report', 'sample', 'reagent', 'file', 'notebook_template'));--> statement-breakpoint

ALTER TABLE "api"."record_links" DROP CONSTRAINT "chk_record_links_link_type";--> statement-breakpoint
ALTER TABLE "api"."record_links" ADD CONSTRAINT "chk_record_links_link_type" CHECK ("api"."record_links"."link_type" IN ('sample', 'protocol', 'dataset', 'reagent', 'analysis', 'file', 'general', 'template'));--> statement-breakpoint

ALTER TABLE "api"."record_links" ADD COLUMN IF NOT EXISTS "link_metadata" jsonb NOT NULL DEFAULT '{}';--> statement-breakpoint

-- Template-instantiation links must carry the source revision id so the
-- provenance version is durable and verifiable at the DB boundary, not just
-- opaque JSON. Other link types keep an empty metadata object.
ALTER TABLE "api"."record_links" DROP CONSTRAINT IF EXISTS "chk_record_links_template_metadata";--> statement-breakpoint
ALTER TABLE "api"."record_links" ADD CONSTRAINT "chk_record_links_template_metadata"
  CHECK ("link_type" <> 'template' OR "link_metadata" ? 'template_revision_id');--> statement-breakpoint

ALTER TABLE "api"."revisions" DROP CONSTRAINT "chk_revisions_reason";--> statement-breakpoint
ALTER TABLE "api"."revisions" ADD CONSTRAINT "chk_revisions_reason" CHECK ("api"."revisions"."reason" IN ('submit', 'sign', 'manual', 'validate'));--> statement-breakpoint

ALTER TABLE "api"."record_field_definitions" DROP CONSTRAINT "chk_record_field_definitions_kind";--> statement-breakpoint
ALTER TABLE "api"."record_field_definitions" ADD CONSTRAINT "chk_record_field_definitions_kind" CHECK ("api"."record_field_definitions"."kind" IN ('sample', 'reagent', 'protocol_template', 'notebook_template'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Widen create_record: add notebook_template kind with NBK prefix.
-- ---------------------------------------------------------------------------
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
    WHEN 'notebook_template' THEN 'NBK'
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
-- 3. Widen transition_record_status: add notebook_template transitions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."transition_record_status"(
  p_record_id uuid,
  p_target_status text,
  p_expected_metadata_version int
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."records";
  v_allowed text[];
  v_transition_key text;
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived records are frozen; restore before transitioning'
      USING ERRCODE = 'SB004';
  END IF;

  v_transition_key := v_row.kind || ':' || v_row.status || '->' || p_target_status;
  v_allowed := ARRAY[
    'sample:available->reserved',
    'sample:available->consumed',
    'sample:available->quarantined',
    'sample:reserved->available',
    'sample:reserved->consumed',
    'sample:quarantined->available',
    'reagent:available->reserved',
    'reagent:available->consumed',
    'reagent:available->quarantined',
    'reagent:available->expired',
    'reagent:reserved->available',
    'reagent:reserved->consumed',
    'reagent:quarantined->available',
    'protocol_template:draft->active',
    'protocol_template:draft->under_review',
    'protocol_template:under_review->active',
    'protocol_template:under_review->draft',
    'protocol_template:active->draft',
    'notebook_template:draft->validated',
    'notebook_template:validated->draft'
  ];

  IF NOT (v_transition_key = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid status transition for kind %: % -> %',
      v_row.kind, v_row.status, p_target_status USING ERRCODE = 'SB004';
  END IF;

  UPDATE "api"."records"
    SET status = p_target_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."transition_record_status"(uuid, text, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."transition_record_status"(uuid, text, int) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. instantiate_template RPC.
--
-- Transactional deep-copy from a template record into a new record. Creates
-- an immutable revision snapshot of the template, a new record (experiment or
-- protocol_template) with deep-copied blocks, and a record_link carrying the
-- source revision ID in link_metadata. SECURITY DEFINER (matching
-- pin_protocol_reference) so the procedure_step execution-block trigger
-- permits the copy; explicit workspace/kind/status checks are the
-- authoritative access boundary, the same pattern as pin_protocol_reference.
--
-- Error codes:
--   42501 — permission denied (not member, cross-workspace, wrong kinds)
--   SB006 — template not instantiable (wrong status or archived)
--   SB001 — optimistic version mismatch (not used currently, reserved)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."instantiate_template"(
  p_template_record_id uuid,
  p_target_project_id uuid,
  p_target_kind text,
  p_title text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := "api"."current_user_id"();
  v_workspace_id uuid := "api"."current_workspace_id"();
  v_template "api"."records";
  v_new_record "api"."records";
  v_revision "api"."revisions";
  v_block jsonb;
  v_new_block "api"."blocks";
  v_copied_blocks jsonb[] := ARRAY[]::jsonb[];
  v_order real;
  v_i int := 0;
  v_link "api"."record_links";
  v_block_payload jsonb;
BEGIN
  -- Validate actor and workspace.
  IF v_actor IS NULL OR v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'instantiate_template requires an authenticated workspace member' USING ERRCODE = '42501';
  END IF;

  -- Lock the template record.
  SELECT * INTO v_template FROM "api"."records" WHERE id = p_template_record_id FOR UPDATE;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'template not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Same-workspace enforcement (defence in depth alongside RLS).
  IF v_template.workspace_id <> v_workspace_id THEN
    RAISE EXCEPTION 'template is in a different workspace' USING ERRCODE = '42501';
  END IF;

  -- Template kind must be a template kind.
  IF v_template.kind NOT IN ('protocol_template', 'notebook_template') THEN
    RAISE EXCEPTION 'record is not a template' USING ERRCODE = '42501';
  END IF;

  -- Template must not be archived.
  IF v_template.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot instantiate from an archived template' USING ERRCODE = 'SB006';
  END IF;

  -- Template must be in an instantiable status.
  IF v_template.kind = 'protocol_template' AND v_template.status <> 'active' THEN
    RAISE EXCEPTION 'cannot instantiate from a % protocol template (must be active)', v_template.status USING ERRCODE = 'SB006';
  END IF;
  IF v_template.kind = 'notebook_template' AND v_template.status <> 'validated' THEN
    RAISE EXCEPTION 'cannot instantiate from a % notebook template (must be validated)', v_template.status USING ERRCODE = 'SB006';
  END IF;

  -- Target kind must be compatible with template kind.
  IF v_template.kind = 'notebook_template' AND p_target_kind NOT IN ('experiment') THEN
    RAISE EXCEPTION 'notebook templates can only be instantiated as experiments' USING ERRCODE = '42501';
  END IF;
  IF v_template.kind = 'protocol_template' AND p_target_kind NOT IN ('experiment', 'protocol_template') THEN
    RAISE EXCEPTION 'protocol templates can only be instantiated as experiments or protocol templates' USING ERRCODE = '42501';
  END IF;

  -- Target project must be in the caller's workspace.
  IF NOT EXISTS (
    SELECT 1 FROM "api"."projects" p
    WHERE p.id = p_target_project_id AND p.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'target project not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Create an immutable revision snapshot of the template (like
  -- pin_protocol_reference). This captures the exact template version.
  INSERT INTO "api"."revisions"(
    record_id, structure_version, metadata_version, metadata_snapshot,
    block_snapshot, reason, created_by_user_id
  )
  SELECT
    v_template.id,
    v_template.structure_version,
    v_template.metadata_version,
    jsonb_build_object(
      'id', v_template.id,
      'identifier', v_template.identifier,
      'title', v_template.title,
      'status', v_template.status,
      'properties', v_template.properties,
      'tags', v_template.tags,
      'metadataVersion', v_template.metadata_version,
      'kind', v_template.kind
    ),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'type', b.type,
          'payload', b.payload,
          'payload_schema_version', b.payload_schema_version,
          'order', b."order",
          'version', b.version
        )
        ORDER BY b."order"
      )
      FILTER (WHERE b.id IS NOT NULL),
      '[]'::jsonb
    ),
    'validate',
    v_actor
  FROM "api"."blocks" b WHERE b.record_id = v_template.id
  RETURNING * INTO v_revision;

  -- Create the new record. Use a derived title if none provided.
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    p_title := v_template.title;
  END IF;
  v_new_record := "api"."create_record"(
    p_target_project_id,
    p_target_kind,
    p_title,
    'draft',
    '{}'::text[],
    '{}'::jsonb
  );

  -- Deep-copy template blocks into the new record. Skip protocol_reference
  -- blocks (experiment-specific pinning). For procedure_step blocks going
  -- into an experiment, add execution fields (like pin_protocol_reference).
  FOR v_block IN
    SELECT value FROM jsonb_array_elements(v_revision.block_snapshot)
    WHERE value->>'type' <> 'protocol_reference'
    ORDER BY (value->>'order')::real
  LOOP
    v_i := v_i + 1;
    v_order := v_i::real;
    v_block_payload := v_block->'payload';

    IF v_block->>'type' = 'procedure_step' AND p_target_kind = 'experiment' THEN
      -- Add execution fields for experiment copies.
      v_block_payload := v_block_payload || jsonb_build_object(
        'sourceProtocolRevisionId', v_revision.id,
        'sourceStepBlockId', v_block->>'id',
        'completed', false,
        'note', '',
        'completedAt', NULL,
        'completedByUserId', NULL
      );
    ELSIF v_block->>'type' = 'procedure_step' AND p_target_kind = 'protocol_template' THEN
      -- Strip any execution fields for protocol_template definitions.
      v_block_payload := v_block_payload - 'sourceProtocolRevisionId'
        - 'sourceStepBlockId' - 'completed' - 'note' - 'completedAt' - 'completedByUserId';
    END IF;

    INSERT INTO "api"."blocks"(
      record_id, type, payload, payload_schema_version, "order",
      created_by_user_id
    )
    VALUES(
      v_new_record.id,
      v_block->>'type',
      v_block_payload,
      COALESCE((v_block->>'payload_schema_version')::int, 1),
      v_order,
      v_actor
    )
    RETURNING * INTO v_new_block;

    v_copied_blocks := array_append(v_copied_blocks, to_jsonb(v_new_block));
  END LOOP;

  -- Create the source-template link with revision provenance.
  INSERT INTO "api"."record_links"(
    source_record_id, target_record_id, target_kind, target_identifier,
    link_type, link_metadata, created_by_user_id
  )
  VALUES(
    v_new_record.id,
    v_template.id,
    v_template.kind,
    v_template.identifier,
    'template',
    jsonb_build_object('template_revision_id', v_revision.id),
    v_actor
  )
  RETURNING * INTO v_link;

  -- Bump the new record's structure_version.
  UPDATE "api"."records"
    SET structure_version = structure_version + 1,
        updated_by_user_id = v_actor
    WHERE id = v_new_record.id
    RETURNING * INTO v_new_record;

  RETURN jsonb_build_object(
    'record', to_jsonb(v_new_record),
    'blocks', COALESCE(
      (SELECT jsonb_agg(e) FROM unnest(v_copied_blocks) AS e),
      '[]'::jsonb
    ),
    'revision', to_jsonb(v_revision),
    'link', to_jsonb(v_link)
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."instantiate_template"(uuid, uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."instantiate_template"(uuid, uuid, text, text) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
