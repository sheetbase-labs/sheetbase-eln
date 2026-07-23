-- ===========================================================================
-- SCI-008 (decision 0033): initial scientific search.
--
-- Real-time (query-time) full-text search. No index table, no triggers, no
-- indexing delay. A SECURITY INVOKER function builds a tsvector at query time
-- from record metadata, block text, file metadata, configurable properties
-- and record-relationship context. RLS remains authoritative: every table
-- read inside the function is subject to row-level security, so cross-workspace
-- records are invisible.
--
-- No applied migration is modified. No schema columns are added.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- internal.extract_jsonb_text: recursively extract all string-valued leaves
-- from a JSONB value. Used to extract searchable plain text from:
--   - rich_text block payloads (Tiptap JSON: paragraphs, H2/H3, prose lists)
--   - checklist items, callout text, procedure notes, materials notes
--   - metric labels, file display names, protocol reference identifiers
--   - record_links target identifiers and kinds
--   - records.properties string values
--
-- H1 is not present in block content (ADR 0025: H1 is the record title outside
-- prose, already indexed as record metadata). Non-string JSONB values (numbers,
-- booleans, nulls) are not indexed; they are not useful for keyword search.
--
-- IMMUTABLE so it can be used in generated columns or indexes if a future
-- ticket adds a materialised search index.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "internal"."extract_jsonb_text"(v jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  parts text[] := ARRAY[]::text[];
  elem jsonb;
  key text;
  val jsonb;
BEGIN
  IF v IS NULL THEN RETURN ''; END IF;
  CASE jsonb_typeof(v)
    WHEN 'string' THEN
      RETURN v #>> '{}';
    WHEN 'object' THEN
      FOR key, val IN SELECT * FROM jsonb_each(v) LOOP
        IF jsonb_typeof(val) IN ('string', 'object', 'array') THEN
          parts := array_append(parts, internal.extract_jsonb_text(val));
        END IF;
      END LOOP;
    WHEN 'array' THEN
      FOR elem IN SELECT * FROM jsonb_array_elements(v) LOOP
        parts := array_append(parts, internal.extract_jsonb_text(elem));
      END LOOP;
    ELSE
      RETURN '';
  END CASE;
  RETURN array_to_string(parts, ' ');
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."extract_jsonb_text"(jsonb) FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.search: keyword full-text search with structured filters.
--
-- SECURITY INVOKER: all table reads are subject to RLS. The function
-- explicitly checks workspace membership and raises 42501 if the caller has
-- no active workspace, but RLS is the authoritative boundary — cross-workspace
-- records, blocks, file_objects and record_links are invisible before the
-- tsvector is built.
--
-- Parameters:
--   p_query       — search text (plain English, no tsquery syntax needed)
--   p_project_id  — filter by project (NULL = all projects)
--   p_kind        — filter by record kind (NULL = all kinds)
--   p_status      — filter by status (NULL = all statuses)
--   p_owner_id    — filter by created_by_user_id (NULL = all owners)
--   p_date_from   — filter by created_at >= (NULL = no lower bound)
--   p_date_to     — filter by created_at <= (NULL = no upper bound)
--   p_limit       — page size (default 20, clamped to 1–100)
--   p_offset      — page offset (default 0)
--
-- Returns one row per matching record. Archived records (archived_at NOT NULL,
-- deleted_at IS NULL) are included with archived = true. Soft-deleted records
-- (deleted_at NOT NULL) are excluded.
--
-- Result columns:
--   result_type        — 'record' or 'file' (kind = 'file')
--   record_id          — records.id
--   kind, identifier, title, status, project_id
--   archived           — boolean
--   created_by_user_id, created_at, updated_at
--   matched_context    — ts_headline snippet with <b> highlights
--   matched_field      — which source matched: title, identifier, kind, status,
--                         block_text, file_metadata, properties, relationship
--   rank               — ts_rank (0 when query is empty)
--   deep_link          — stable route path
--   total_count        — total matching rows (before pagination)
-- ---------------------------------------------------------------------------

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

  -- Build tsquery from the query text. plainto_tsquery handles special chars
  -- safely and matches the query as a phrase conjunction.
  v_tsquery := plainto_tsquery('english', coalesce(p_query, ''));

  -- Clamp pagination parameters.
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
      -- Extracted text per source, kept as separate columns so the
      -- matched_field CASE can check each source independently.
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
      -- Build a weighted tsvector from all searchable text sources.
      -- Weight A: title and identifier (highest priority).
      -- Weight B: kind, status and tags.
      -- Weight C: block text, file metadata, properties and relationship context.
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
      -- Combined text for headline generation.
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
    -- Matched context: ts_headline over the combined text, or a title excerpt
    -- when browsing with an empty query.
    CASE
      WHEN v_tsquery = ''::tsquery THEN
        left(coalesce(s.title, '') || ' — ' || coalesce(s.identifier, ''), 120)
      ELSE
        ts_headline('english', s.combined_text, v_tsquery,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END AS matched_context,
    -- Matched field: which source contributed the match.
    CASE
      WHEN v_tsquery = ''::tsquery THEN 'title'
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
    -- Rank: ts_rank for ordering, 0 when browsing.
    CASE
      WHEN v_tsquery = ''::tsquery THEN 0::real
      ELSE ts_rank(s.search_vector, v_tsquery)
    END AS rank,
    -- Deep link: experiments/samples/reagents/protocols/files link through the
    -- notebook route; notebook templates link to /templates.
    CASE
      WHEN s.kind = 'notebook_template' THEN '/templates'
      ELSE '/projects/' || s.project_id::text || '/experiments/' || s.id::text
    END AS deep_link,
    -- Total count before pagination (window function computed pre-LIMIT).
    count(*) OVER () AS total_count
  FROM searchable s
  WHERE v_tsquery = ''::tsquery OR s.search_vector @@ v_tsquery
  ORDER BY
    (CASE WHEN v_tsquery = ''::tsquery THEN 0 ELSE 1 END) DESC,
    ts_rank(s.search_vector, v_tsquery) DESC,
    s.updated_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."search"(text, uuid, text, text, text, timestamptz, timestamptz, int, int) TO api_client;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
