-- ---------------------------------------------------------------------------
-- 0034: Workspace-scoped templates
--
-- Protocol templates (PRT-) and notebook templates (NBK-) are workspace-level
-- resources, not project-scoped. They are shared across all projects in a
-- workspace and instantiated into specific projects via instantiate_template.
--
-- Changes:
-- 1. Make api.records.project_id nullable (templates get NULL)
-- 2. Replace the (project_id, identifier) unique constraint with two partial
--    unique indexes: one for project-scoped records, one for workspace-scoped
--    templates
-- 3. Widen create_record to accept NULL p_project_id for template kinds,
--    using a workspace-scoped identifier sequence
-- 4. Update search RPC deep_link to route protocol_template to /templates
--    and handle NULL project_id
-- ---------------------------------------------------------------------------

-- 1. Drop NOT NULL on project_id
ALTER TABLE "api"."records" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint

-- 2. Replace unique constraint with indexes
--    A regular unique index on (project_id, identifier) preserves the existing
--    on-conflict targets used by Drizzle's onConflictDoUpdate. PostgreSQL
--    treats NULLs as distinct in unique indexes, so workspace-scoped templates
--    (project_id IS NULL) don't conflict with each other here.
--    A separate partial unique index enforces workspace-scoped uniqueness for
--    templates with NULL project_id.
ALTER TABLE "api"."records" DROP CONSTRAINT "uq_records_project_identifier";--> statement-breakpoint

CREATE UNIQUE INDEX "uq_records_project_identifier"
  ON "api"."records" ("project_id", "identifier");--> statement-breakpoint

CREATE UNIQUE INDEX "uq_records_workspace_template_identifier"
  ON "api"."records" ("workspace_id", "identifier")
  WHERE "project_id" IS NULL;--> statement-breakpoint

-- 3. Widen create_record: accept NULL p_project_id for template kinds
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
  v_is_template boolean;
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

  -- Templates (protocol_template, notebook_template) are workspace-scoped:
  -- they accept NULL p_project_id and use a workspace-scoped identifier sequence.
  v_is_template := p_kind IN ('protocol_template', 'notebook_template');

  IF v_is_template AND p_project_id IS NULL THEN
    -- Workspace-scoped template: sequence by (workspace_id, prefix, year)
    SELECT count(*) + 1 INTO v_seq
      FROM "api"."records"
      WHERE workspace_id = v_workspace_id
        AND project_id IS NULL
        AND identifier LIKE v_prefix || '-' || v_year || '-%';
  ELSE
    -- Project-scoped record (including templates explicitly assigned to a project)
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
  END IF;

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

-- 4. Update search RPC: route protocol_template to /templates, handle NULL project_id
CREATE OR REPLACE FUNCTION "api"."search"(
  p_query text DEFAULT '',
  p_project_id uuid DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_owner_id text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  result_type text,
  record_id uuid,
  kind text,
  identifier text,
  title text,
  status text,
  project_id uuid,
  archived boolean,
  created_by_user_id text,
  created_at timestamptz,
  updated_at timestamptz,
  matched_context text,
  matched_field text,
  rank real,
  deep_link text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_workspace_id uuid;
  v_tsquery tsquery;
  v_has_query boolean;
  v_limit int;
  v_offset int;
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  v_has_query := btrim(coalesce(p_query, '')) <> '';

  IF v_has_query THEN
    v_tsquery := plainto_tsquery('english', p_query);
    IF numnode(v_tsquery) = 0 THEN
      v_has_query := false;
      v_tsquery := NULL;
    END IF;
  ELSE
    v_tsquery := NULL;
  END IF;

  v_limit := coalesce(p_limit, 20);
  IF v_limit < 1 THEN v_limit := 20; END IF;
  IF v_limit > 100 THEN v_limit := 100; END IF;
  v_offset := coalesce(p_offset, 0);
  IF v_offset < 0 THEN v_offset := 0; END IF;

  RETURN QUERY
  WITH searchable AS (
    SELECT
      r.id,
      r.kind,
      r.identifier,
      r.title,
      r.status,
      r.project_id,
      (r.archived_at IS NOT NULL) AS archived,
      r.created_by_user_id,
      r.created_at,
      r.updated_at,
      coalesce(
        (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = r.id),
        '') AS block_text,
      coalesce(
        (SELECT string_agg(
          coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = r.id),
        '') AS file_text,
      coalesce(
        internal.extract_jsonb_text(r.properties),
        '') AS property_text,
      coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '') AS link_text,
      coalesce(
        array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '),
        '') AS tag_text,
      setweight(to_tsvector('english', coalesce(r.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(r.identifier, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(r.kind, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(r.status, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(
        array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '), '')), 'B') ||
      setweight(to_tsvector('english', coalesce(
        internal.extract_jsonb_text(r.properties), '')), 'C') ||
      setweight(to_tsvector('english', coalesce(
        (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = r.id),
        '')), 'C') ||
      setweight(to_tsvector('english', coalesce(
        (SELECT string_agg(
          coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = r.id),
        '')), 'C') ||
      setweight(to_tsvector('english', coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '')), 'C')
      AS search_vector,
      coalesce(r.title, '') || ' ' || coalesce(r.identifier, '') || ' ' ||
      coalesce(array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '), '') || ' ' ||
      coalesce(internal.extract_jsonb_text(r.properties), '') || ' ' ||
      coalesce(
        (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = r.id),
        '') || ' ' ||
      coalesce(
        (SELECT string_agg(
          coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = r.id),
        '') || ' ' ||
      coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '') AS combined_text
    FROM api.records r
    WHERE r.deleted_at IS NULL
      AND (p_project_id IS NULL OR r.project_id = p_project_id)
      AND (p_kind IS NULL OR r.kind = p_kind)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_owner_id IS NULL OR r.created_by_user_id = p_owner_id)
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at <= p_date_to)
  )
  SELECT
    CASE WHEN s.kind = 'file' THEN 'file' ELSE 'record' END AS result_type,
    s.id AS record_id,
    s.kind,
    s.identifier,
    s.title,
    s.status,
    s.project_id,
    s.archived,
    s.created_by_user_id,
    s.created_at,
    s.updated_at,
    CASE
      WHEN NOT v_has_query THEN
        left(coalesce(s.title, '') || ' — ' || coalesce(s.identifier, ''), 120)
      ELSE
        ts_headline('english', s.combined_text, v_tsquery,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END AS matched_context,
    CASE
      WHEN NOT v_has_query THEN 'title'
      WHEN to_tsvector('english', s.title) @@ v_tsquery THEN 'title'
      WHEN to_tsvector('english', s.identifier) @@ v_tsquery THEN 'identifier'
      WHEN to_tsvector('english', s.kind) @@ v_tsquery THEN 'kind'
      WHEN to_tsvector('english', s.status) @@ v_tsquery THEN 'status'
      WHEN to_tsvector('english', s.tag_text) @@ v_tsquery THEN 'tags'
      WHEN to_tsvector('english', s.block_text) @@ v_tsquery THEN 'block_text'
      WHEN to_tsvector('english', s.file_text) @@ v_tsquery THEN 'file_metadata'
      WHEN to_tsvector('english', s.property_text) @@ v_tsquery THEN 'properties'
      ELSE 'relationship'
    END AS matched_field,
    CASE
      WHEN NOT v_has_query THEN 0::real
      ELSE ts_rank(s.search_vector, v_tsquery)
    END AS rank,
    CASE
      WHEN s.kind IN ('notebook_template', 'protocol_template') THEN '/templates'
      WHEN s.project_id IS NULL THEN '/templates'
      ELSE '/projects/' || s.project_id::text || '/experiments/' || s.id::text
    END AS deep_link,
    count(*) OVER () AS total_count
  FROM searchable s
  WHERE (NOT v_has_query) OR s.search_vector @@ v_tsquery
  ORDER BY
    (CASE WHEN v_has_query THEN ts_rank(s.search_vector, v_tsquery) ELSE 0 END) DESC,
    s.updated_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) TO api_client;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
