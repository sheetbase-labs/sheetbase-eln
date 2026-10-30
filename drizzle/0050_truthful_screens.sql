-- Search facet counts come from the server. The results page used to count
-- the types and projects of the rows it had loaded, so a search for "a" said
-- "Records 20+" and each project "1+" even though 268 results matched. This
-- counts every match, grouped the way the page groups them.
--
-- api.search_facets reads the same matches as api.search (it is generated from
-- that function's body, minus paging), so the counts add up to its
-- total_count; tests/db/search-facets.test.ts checks they do. Change the two
-- together.
--> statement-breakpoint
CREATE FUNCTION api.search_facets(p_query text DEFAULT ''::text, p_project_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_owner_id text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_result_type text DEFAULT NULL::text, p_include_archived boolean DEFAULT true) RETURNS TABLE(result_type text, kind text, project_id uuid, in_text boolean, match_count bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_workspace_id uuid;
  v_tsquery tsquery;
  v_has_query boolean;
  v_result_type text;
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  v_result_type := nullif(btrim(coalesce(p_result_type, '')), '');
  IF v_result_type IS NOT NULL AND v_result_type NOT IN
    ('record', 'file', 'dataset', 'sheet', 'template', 'comment', 'dataset_row', 'sheet_row',
     'project', 'pipeline', 'analysis') THEN
    RAISE EXCEPTION 'invalid result type filter' USING ERRCODE = '22023';
  END IF;

  -- Track whether the caller provided a non-empty query. An empty query means
  -- "browse everything" mode: no tsquery match is required, results are
  -- ordered by recency, and matched_context is a title excerpt.
  v_has_query := btrim(coalesce(p_query, '')) <> '';

  IF v_has_query THEN
    v_tsquery := plainto_tsquery('english', p_query);
    IF v_tsquery = ''::tsquery THEN
      v_has_query := false;
    END IF;
  ELSE
    v_tsquery := ''::tsquery;
  END IF;

  RETURN QUERY
  SELECT s.result_type, s.kind, s.project_id,
         (s.matched_field IN ('block_text', 'comment_body')),
         count(*)
  FROM (
  WITH
  ---------------------------------------------------------------------------
  -- Records (indexed via api.records.search_tsv; the GIN index accelerates
  -- the @@ match and only matching rows pay for the text-correlation columns).
  ---------------------------------------------------------------------------
  record_hits AS (
    SELECT
      CASE WHEN r.kind = 'file' THEN 'file' ELSE 'record' END AS result_type,
      r.id AS record_id,
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
      coalesce(internal.extract_jsonb_text(r.properties), '') AS property_text,
      coalesce(
        (SELECT string_agg(
          coalesce(rl.target_identifier, '') || ' ' ||
          coalesce(rl.target_kind, '') || ' ' ||
          coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = r.id),
        '') AS link_text,
      coalesce(array_to_string(coalesce(r.tags, ARRAY[]::text[]), ' '), '') AS tag_text,
      coalesce(r.search_tsv, ''::tsvector) AS search_vector,
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
      AND (NOT v_has_query OR r.search_tsv @@ v_tsquery)
      AND NOT (r.kind = 'file' AND v_has_query AND EXISTS (
        SELECT 1 FROM api.file_objects fo
         WHERE fo.record_id = r.id AND fo.extracted_text IS NOT NULL
           AND to_tsvector('english', fo.extracted_text) @@ v_tsquery))
      AND (
        v_result_type IS NULL
        OR (v_result_type = 'file' AND r.kind = 'file')
        OR (v_result_type = 'record' AND r.kind <> 'file')
      )
      AND (p_project_id IS NULL OR r.project_id = p_project_id)
      AND (p_kind IS NULL OR r.kind = p_kind)
      AND (p_status IS NULL OR r.status = p_status)
      AND (p_owner_id IS NULL OR r.created_by_user_id = p_owner_id)
      AND (p_date_from IS NULL OR r.created_at >= p_date_from)
      AND (p_date_to IS NULL OR r.created_at <= p_date_to)
  ),
  ---------------------------------------------------------------------------
  -- Canonical Datasets. Live mutable objects: exported/searched as-is, never
  -- presented as evidence.
  ---------------------------------------------------------------------------
  dataset_hits AS (
    SELECT
      'dataset' AS result_type,
      d.id AS record_id,
      'dataset' AS kind,
      coalesce(d.display_id, d.id::text) AS identifier,
      d.name AS title,
      d.lifecycle AS status,
      d.primary_project_id AS project_id,
      (d.lifecycle = 'archived') AS archived,
      d.created_by_user_id,
      d.created_at,
      d.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(d.name, '')), 'A') ||
      setweight(to_tsvector('english', d.id::text), 'A') ||
      setweight(to_tsvector('english',
        coalesce(sd.key, '') || ' ' || coalesce(sd.name, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(d.description, '')), 'C')
      AS search_vector,
      coalesce(d.name, '') || ' ' || d.id::text || ' ' ||
      coalesce(sd.key, '') || ' ' || coalesce(sd.name, '') || ' ' ||
      coalesce(d.description, '') AS combined_text
    FROM api.datasets d
    JOIN api.dataset_schema_versions dsv ON dsv.id = d.schema_version_id
    JOIN api.dataset_schema_definitions sd ON sd.id = dsv.schema_id
    WHERE d.lifecycle IN ('active', 'archived')
      AND (v_result_type IS NULL OR v_result_type = 'dataset')
      AND (p_project_id IS NULL OR d.primary_project_id = p_project_id)
      AND (p_date_from IS NULL OR d.created_at >= p_date_from)
      AND (p_date_to IS NULL OR d.created_at <= p_date_to)
      -- A record-only filter implies the caller wants records; the new
      -- object classes are suppressed so legacy filters keep exact semantics.
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Sheet Instances (working sheets bound to Notebooks or projects).
  ---------------------------------------------------------------------------
  sheet_hits AS (
    SELECT
      'sheet' AS result_type,
      si.id AS record_id,
      'sheet_instance' AS kind,
      coalesce(si.display_id, si.id::text) AS identifier,
      si.name AS title,
      si.lifecycle AS status,
      si.project_id,
      (si.lifecycle = 'archived') AS archived,
      si.created_by_user_id,
      si.created_at,
      si.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(si.name, '')), 'A') ||
      setweight(to_tsvector('english', si.id::text), 'A') ||
      setweight(to_tsvector('english', coalesce(si.description, '')), 'C')
      AS search_vector,
      coalesce(si.name, '') || ' ' || si.id::text || ' ' ||
      coalesce(si.description, '') AS combined_text
    FROM api.sheet_instances si
    WHERE si.lifecycle IN ('active', 'archived')
      AND (v_result_type IS NULL OR v_result_type = 'sheet')
      AND (p_project_id IS NULL OR si.project_id = p_project_id)
      AND (p_date_from IS NULL OR si.created_at >= p_date_from)
      AND (p_date_to IS NULL OR si.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Notebook Templates (CORE-06 versioned catalogue; workspace-level).
  ---------------------------------------------------------------------------
  template_hits AS (
    SELECT
      'template' AS result_type,
      nt.id AS record_id,
      'notebook_template' AS kind,
      coalesce(nt.display_id, nt.key) AS identifier,
      nt.name AS title,
      nt.lifecycle AS status,
      NULL::uuid AS project_id,
      (nt.lifecycle = 'retired') AS archived,
      nt.created_by_user_id,
      nt.created_at,
      nt.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(nt.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(nt.key, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(nt.description, '')), 'C')
      AS search_vector,
      coalesce(nt.name, '') || ' ' || coalesce(nt.key, '') || ' ' ||
      coalesce(nt.description, '') AS combined_text
    FROM api.notebook_templates nt
    WHERE nt.lifecycle IN ('active', 'retired')
      AND (v_result_type IS NULL OR v_result_type = 'template')
      AND (p_date_from IS NULL OR nt.created_at >= p_date_from)
      AND (p_date_to IS NULL OR nt.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Dataset and Sheet cell values, with the matched column named.
  ---------------------------------------------------------------------------
  cell_hits AS (
    SELECT DISTINCT ON (c.result_type, c.record_id) c.*
    FROM (
    SELECT
      'dataset_row'::text AS result_type,
      cs.dataset_id AS record_id,
      'dataset_row'::text AS kind,
      coalesce(d.display_id, cs.dataset_id::text) AS identifier,
      d.name AS title,
      d.lifecycle AS status,
      d.primary_project_id AS project_id,
      (d.lifecycle = 'archived') AS archived,
      d.created_by_user_id,
      d.created_at,
      d.updated_at,
      cs.value_text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      cs.search_vector,
      cs.value_text || ' ' || cs.field_label AS combined_text
    FROM api.dataset_cell_search cs
    JOIN api.datasets d ON d.id = cs.dataset_id
    WHERE (v_result_type IS NULL OR v_result_type = 'dataset_row')
      AND ((NOT v_has_query) OR cs.search_vector @@ v_tsquery)
      AND (p_project_id IS NULL OR d.primary_project_id = p_project_id)
      AND (p_date_from IS NULL OR d.created_at >= p_date_from)
      AND (p_date_to IS NULL OR d.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
    UNION ALL
    SELECT
      'sheet_row'::text AS result_type,
      scs.instance_id AS record_id,
      'sheet_row'::text AS kind,
      coalesce(si.display_id, scs.instance_id::text) AS identifier,
      si.name AS title,
      si.lifecycle AS status,
      scs.project_id,
      (si.lifecycle = 'archived') AS archived,
      si.created_by_user_id,
      si.created_at,
      si.updated_at,
      scs.value_text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      scs.search_vector,
      scs.value_text || ' ' || scs.field_label AS combined_text
    FROM api.sheet_cell_search scs
    JOIN api.sheet_instances si ON si.id = scs.instance_id
    WHERE (v_result_type IS NULL OR v_result_type = 'sheet_row')
      AND ((NOT v_has_query) OR scs.search_vector @@ v_tsquery)
      AND (p_project_id IS NULL OR scs.project_id = p_project_id)
      AND (p_date_from IS NULL OR si.created_at >= p_date_from)
      AND (p_date_to IS NULL OR si.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  
    ) c
    ORDER BY c.result_type, c.record_id,
      (CASE WHEN v_has_query THEN ts_rank(c.search_vector, v_tsquery) ELSE 0 END) DESC
  ),
  ---------------------------------------------------------------------------
  -- Text inside an uploaded file, reported against the file's record.
  ---------------------------------------------------------------------------
  file_content_hits AS (
    SELECT
      'file'::text AS result_type,
      r.id AS record_id,
      'file'::text AS kind,
      r.identifier,
      coalesce(fo.display_name, r.title) AS title,
      r.status,
      r.project_id,
      (r.archived_at IS NOT NULL) AS archived,
      r.created_by_user_id,
      r.created_at,
      r.updated_at,
      fo.extracted_text AS block_text,
      coalesce(fo.media_type, '') AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      to_tsvector('english', coalesce(fo.extracted_text, '')) AS search_vector,
      coalesce(fo.extracted_text, '') AS combined_text
    FROM api.file_objects fo
    JOIN api.records r ON r.id = fo.record_id
    WHERE v_has_query
      AND fo.extracted_text IS NOT NULL
      AND to_tsvector('english', fo.extracted_text) @@ v_tsquery
      AND r.deleted_at IS NULL
      AND (v_result_type IS NULL OR v_result_type = 'file')
      AND (p_project_id IS NULL OR r.project_id = p_project_id)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Projects, by title, key and display id.
  ---------------------------------------------------------------------------
  project_hits AS (
    SELECT
      'project'::text AS result_type,
      p.id AS record_id,
      'project'::text AS kind,
      coalesce(p.display_id, p.key) AS identifier,
      p.title AS title,
      p.status AS status,
      p.id AS project_id,
      (p.archived_at IS NOT NULL) AS archived,
      coalesce(p.lead_user_id, '') AS created_by_user_id,
      p.created_at,
      p.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(p.title, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(p.key, '') || ' ' || coalesce(p.display_id, '')), 'A')
      AS search_vector,
      coalesce(p.title, '') || ' ' || coalesce(p.key, '') || ' ' ||
      coalesce(p.display_id, '') AS combined_text
    FROM api.projects p
    WHERE (v_result_type IS NULL OR v_result_type = 'project')
      AND (p_project_id IS NULL OR p.id = p_project_id)
      AND (p_date_from IS NULL OR p.created_at >= p_date_from)
      AND (p_date_to IS NULL OR p.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Pipelines, by name, key and description.
  ---------------------------------------------------------------------------
  pipeline_hits AS (
    SELECT
      'pipeline'::text AS result_type,
      pd.id AS record_id,
      'pipeline'::text AS kind,
      coalesce(pd.display_id, pd.key) AS identifier,
      pd.name AS title,
      pd.lifecycle AS status,
      NULL::uuid AS project_id,
      (pd.lifecycle = 'archived') AS archived,
      coalesce(pd.created_by_user_id, '') AS created_by_user_id,
      pd.created_at,
      pd.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(pd.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(pd.key, '') || ' ' || coalesce(pd.display_id, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(pd.description, '')), 'C')
      AS search_vector,
      coalesce(pd.name, '') || ' ' || coalesce(pd.key, '') || ' ' ||
      coalesce(pd.display_id, '') || ' ' || coalesce(pd.description, '') AS combined_text
    FROM api.pipeline_definitions pd
    WHERE (v_result_type IS NULL OR v_result_type = 'pipeline')
      AND p_project_id IS NULL
      AND (p_date_from IS NULL OR pd.created_at >= p_date_from)
      AND (p_date_to IS NULL OR pd.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  ---------------------------------------------------------------------------
  -- Analyses: saved views (chart builder) and saved statistics.
  ---------------------------------------------------------------------------
  analysis_hits AS (
    SELECT
      'analysis'::text AS result_type,
      a.id AS record_id,
      'analysis'::text AS kind,
      a.identifier,
      a.name AS title,
      ''::text AS status,
      NULL::uuid AS project_id,
      false AS archived,
      a.owner_user_id AS created_by_user_id,
      a.created_at,
      a.updated_at,
      ''::text AS block_text,
      ''::text AS file_text,
      ''::text AS property_text,
      ''::text AS link_text,
      ''::text AS tag_text,
      setweight(to_tsvector('english', coalesce(a.name, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(a.identifier, '')), 'A')
      AS search_vector,
      coalesce(a.name, '') || ' ' || coalesce(a.identifier, '') AS combined_text
    FROM (
      SELECT av.id, coalesce(av.display_id, left(av.id::text, 8)) AS identifier, av.name,
             av.owner_user_id, av.created_at, av.updated_at
        FROM api.analysis_views av
      UNION ALL
      SELECT ad.id, coalesce(ad.display_id, left(ad.id::text, 8)), ad.name,
             ad.owner_user_id, ad.created_at, ad.updated_at
        FROM api.analysis_definitions ad
    ) a
    WHERE (v_result_type IS NULL OR v_result_type = 'analysis')
      AND p_project_id IS NULL
      AND (p_date_from IS NULL OR a.created_at >= p_date_from)
      AND (p_date_to IS NULL OR a.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
  all_hits AS (
    SELECT * FROM record_hits
    UNION ALL
    SELECT * FROM dataset_hits
    UNION ALL
    SELECT * FROM sheet_hits
    UNION ALL
    SELECT * FROM template_hits
    UNION ALL
    SELECT * FROM cell_hits
    UNION ALL
    SELECT * FROM file_content_hits
    UNION ALL
    SELECT * FROM project_hits
    UNION ALL
    SELECT * FROM pipeline_hits
    UNION ALL
    SELECT * FROM analysis_hits
  )
  SELECT
    h.result_type,
    h.record_id,
    h.kind,
    h.identifier,
    h.title,
    h.status,
    h.project_id,
    h.archived,
    h.created_by_user_id,
    h.created_at,
    h.updated_at,
    CASE
      WHEN NOT v_has_query THEN
        left(coalesce(h.title, '') || ' — ' || coalesce(h.identifier, ''), 120)
      ELSE
        ts_headline('english', h.combined_text, v_tsquery,
          'MaxWords=30,MinWords=10,ShortWord=3')
    END AS matched_context,
    CASE
      WHEN h.result_type IN ('dataset_row', 'sheet_row')
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'cell_value'
      WHEN h.result_type = 'file'
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'file_contents'
      WHEN h.result_type = 'comment'
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'comment_body'
      WHEN NOT v_has_query THEN 'title'
      WHEN to_tsvector('english', h.title) @@ v_tsquery THEN 'title'
      WHEN to_tsvector('english', h.identifier) @@ v_tsquery THEN 'identifier'
      WHEN h.result_type IN ('project', 'pipeline', 'analysis')
        AND position(lower(btrim(p_query)) in lower(h.title)) > 0 THEN 'title'
      WHEN h.result_type IN ('project', 'pipeline', 'analysis')
        AND position(lower(btrim(p_query)) in lower(h.identifier)) > 0 THEN 'identifier'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.kind) @@ v_tsquery THEN 'kind'
      WHEN to_tsvector('english', h.status) @@ v_tsquery THEN 'status'
      WHEN to_tsvector('english', h.tag_text) @@ v_tsquery THEN 'tags'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'block_text'
      WHEN h.result_type IN ('record', 'file')
        AND to_tsvector('english', h.file_text) @@ v_tsquery THEN 'file_metadata'
      WHEN to_tsvector('english', h.property_text) @@ v_tsquery THEN 'properties'
      WHEN h.link_text <> ''
        AND to_tsvector('english', h.link_text) @@ v_tsquery THEN 'relationship'
      WHEN to_tsvector('english', h.combined_text) @@ v_tsquery THEN 'description'
      ELSE 'relationship'
    END AS matched_field,
    CASE
      WHEN NOT v_has_query THEN 0::real
      ELSE ts_rank(h.search_vector, v_tsquery) * CASE h.result_type
        WHEN 'dataset_row' THEN 0.5::real
        WHEN 'sheet_row' THEN 0.5::real
        WHEN 'file' THEN 0.6::real
        ELSE 1::real END
    END AS rank,
    CASE
      WHEN h.result_type = 'dataset_row'
        THEN '/datasets?dataset=' || h.record_id::text
      WHEN h.result_type = 'sheet_row'
        THEN '/sheets/' || h.record_id::text
      WHEN h.result_type = 'comment' AND h.comment_sheet_id IS NOT NULL
        THEN '/sheets/' || h.comment_sheet_id::text || '?commentId=' || h.record_id::text
      WHEN h.result_type = 'comment'
        THEN '/records/' || h.record_id::text
      WHEN h.result_type = 'dataset'
        THEN '/datasets?dataset=' || h.record_id::text
      WHEN h.result_type = 'sheet'
        THEN '/sheets/' || h.record_id::text
      WHEN h.result_type = 'template'
        THEN '/templates?template=' || h.record_id::text
      WHEN h.result_type = 'project'
        THEN '/projects/' || h.record_id::text
      WHEN h.result_type = 'pipeline'
        THEN '/pipelines/' || h.record_id::text
      WHEN h.result_type = 'analysis'
        THEN '/analysis/' || h.record_id::text
      WHEN h.kind = 'sample'
        THEN '/samples?selected=' || h.record_id::text
      WHEN h.kind = 'material'
        THEN '/materials?selected=' || h.record_id::text
      WHEN h.kind = 'protocol_template'
        THEN '/templates?protocol=' || h.record_id::text
      ELSE '/records/' || h.record_id::text
    END AS deep_link
  FROM (
    SELECT *, NULL::uuid AS comment_sheet_id FROM all_hits
    UNION ALL
    SELECT
      'comment'::text, c.id, 'comment'::text, c.id::text, left(c.body, 120), c.state,
      NULL::uuid, coalesce(si.lifecycle = 'archived', false), c.author_user_id,
      c.created_at, c.updated_at, c.body, ''::text, ''::text, ''::text, ''::text,
      c.search_vector, c.body, c.sheet_instance_id
    FROM api.comments c
    LEFT JOIN api.sheet_instances si ON si.id = c.sheet_instance_id
    WHERE (v_result_type IS NULL OR v_result_type = 'comment')
      AND (p_project_id IS NULL OR si.project_id = p_project_id)
      AND (p_date_from IS NULL OR c.created_at >= p_date_from)
      AND (p_date_to IS NULL OR c.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ) h
  WHERE ((NOT v_has_query) OR h.search_vector @@ v_tsquery
         OR (h.result_type IN ('project', 'pipeline', 'analysis')
             AND position(lower(btrim(p_query)) in lower(h.combined_text)) > 0))
    AND (p_include_archived OR NOT h.archived)
  ) s
  GROUP BY s.result_type, s.kind, s.project_id,
           (s.matched_field IN ('block_text', 'comment_body'));
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.search_facets(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.search_facets(text, uuid, text, text, text, timestamp with time zone, timestamp with time zone, text, boolean) TO api_client;
--> statement-breakpoint
-- Saved searches belong to the person, not the browser: they follow them to a
-- new machine. Written only through the two functions below, read back under
-- row security, like favourites. At most 20 are kept per person and workspace;
-- saving a new one past that drops the oldest.
CREATE TABLE api.saved_searches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    query text NOT NULL,
    facets jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_searches_pkey PRIMARY KEY (id),
    CONSTRAINT chk_saved_searches_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_saved_searches_query CHECK (char_length(query) <= 500),
    CONSTRAINT saved_searches_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT saved_searches_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.saved_searches OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_saved_searches_user_created ON api.saved_searches USING btree (workspace_id, user_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.saved_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_searches_select ON api.saved_searches FOR SELECT TO authenticated USING (((user_id = api.current_user_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.saved_searches TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.save_search(p_name text, p_query text, p_facets jsonb DEFAULT '{}'::jsonb) RETURNS api.saved_searches
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_row api.saved_searches;
BEGIN
  v_user_id := api.current_user_id();
  v_workspace_id := api.current_workspace_id();
  IF v_user_id IS NULL OR v_workspace_id IS NULL
     OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' OR char_length(btrim(p_name)) > 120 THEN
    RAISE EXCEPTION 'a saved search needs a name of up to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_query IS NULL OR btrim(p_query) = '' OR char_length(p_query) > 500 THEN
    RAISE EXCEPTION 'a saved search needs a query of up to 500 characters' USING ERRCODE = '22023';
  END IF;
  IF p_facets IS NOT NULL AND jsonb_typeof(p_facets) <> 'object' THEN
    RAISE EXCEPTION 'facets must be an object' USING ERRCODE = '22023';
  END IF;
  -- Saving the same search again replaces it rather than listing it twice.
  DELETE FROM api.saved_searches s
   WHERE s.workspace_id = v_workspace_id AND s.user_id = v_user_id
     AND s.name = btrim(p_name) AND s.query = btrim(p_query)
     AND s.facets = coalesce(p_facets, '{}'::jsonb);
  INSERT INTO api.saved_searches (workspace_id, user_id, name, query, facets)
  VALUES (v_workspace_id, v_user_id, btrim(p_name), btrim(p_query), coalesce(p_facets, '{}'::jsonb))
  RETURNING * INTO v_row;
  DELETE FROM api.saved_searches s
   WHERE s.workspace_id = v_workspace_id AND s.user_id = v_user_id
     AND s.id NOT IN (
       SELECT k.id FROM api.saved_searches k
        WHERE k.workspace_id = v_workspace_id AND k.user_id = v_user_id
        ORDER BY k.created_at DESC, k.id DESC LIMIT 20);
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_search(text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_search(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_search(text, text, jsonb) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.delete_saved_search(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
BEGIN
  v_user_id := api.current_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'SB033';
  END IF;
  -- Only the person's own search can be removed.
  DELETE FROM api.saved_searches s WHERE s.id = p_id AND s.user_id = v_user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_saved_search(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_saved_search(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_saved_search(uuid) TO authenticated;
