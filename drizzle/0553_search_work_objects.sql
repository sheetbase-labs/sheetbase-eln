-- SEARCH-02 — projects, pipelines and analyses in api.search.
--
-- api.search indexed records, files, datasets, sheets, templates, comments and
-- cell values, so a person looking for a project, a pipeline or a saved analysis
-- found nothing; the browser filled the gap with three extra `ilike` reads
-- (src/lib/search-work-objects.ts), first page only, outside the RPC's ranking,
-- paging and total. Those classes are now indexed here, by name and identifier,
-- so they rank, page and count with everything else and honour the same
-- filters:
--
--   result types   `project`, `pipeline`, `analysis` (also valid for
--                  p_result_type)
--   matching       the full-text match every class uses, OR the query as a
--                  case-insensitive substring of the name or identifier, so
--                  typing the start of a name finds it
--   scope          p_project_id keeps the project itself and nothing for the
--                  classes that belong to no project; a record kind, status or
--                  owner filter suppresses them, as it does the other
--                  non-record classes
--   permission     unchanged: api.search is SECURITY INVOKER, so RLS bounds every
--                  row before it is matched
--
-- It also fixes a precedence slip in the final WHERE. The archived scope was
-- written `(NOT v_has_query) OR match AND (include OR NOT archived)`, and AND
-- binds tighter than OR, so a browse with no query ignored p_include_archived.
-- The scope now applies to every row whether or not there is a query.
DO $$
DECLARE
  definition text;
  before text;
BEGIN
  definition := pg_get_functiondef(
    'api.search(text,uuid,text,text,text,timestamptz,timestamptz,integer,integer,text,boolean)'::regprocedure
  );
  IF strpos(definition, 'project_hits') > 0 THEN
    RETURN;  -- already indexed
  END IF;

  -- 1. The new result types are valid filter values.
  before := E'(''record'', ''file'', ''dataset'', ''sheet'', ''template'', ''comment'', ''dataset_row'', ''sheet_row'')';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search result type anchor missing';
  END IF;
  definition := replace(definition, before,
    E'(''record'', ''file'', ''dataset'', ''sheet'', ''template'', ''comment'', ''dataset_row'', ''sheet_row'',\n     ''project'', ''pipeline'', ''analysis'')');

  -- 2. The three hit sets.
  before := E'  all_hits AS (';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search all_hits anchor missing';
  END IF;
  definition := replace(definition, before,
$hits$  ---------------------------------------------------------------------------
  -- Projects, by title, key and display id.
  ---------------------------------------------------------------------------
  project_hits AS (
    SELECT
      'project'::text AS result_type,
      p.id AS record_id,
      'project'::text AS kind,
      p.key AS identifier,
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
      pd.key AS identifier,
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
      SELECT ad.id, left(ad.id::text, 8), ad.name,
             ad.owner_user_id, ad.created_at, ad.updated_at
        FROM api.analysis_definitions ad
    ) a
    WHERE (v_result_type IS NULL OR v_result_type = 'analysis')
      AND p_project_id IS NULL
      AND (p_date_from IS NULL OR a.created_at >= p_date_from)
      AND (p_date_to IS NULL OR a.created_at <= p_date_to)
      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL
  ),
$hits$ || before);

  before := E'    SELECT * FROM file_content_hits\n  )';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search file_content_hits anchor missing';
  END IF;
  definition := replace(definition, before,
    E'    SELECT * FROM file_content_hits\n    UNION ALL\n    SELECT * FROM project_hits\n    UNION ALL\n    SELECT * FROM pipeline_hits\n    UNION ALL\n    SELECT * FROM analysis_hits\n  )');

  -- 3. Which part of the name matched, when it was a substring.
  before := E'      WHEN to_tsvector(''english'', h.identifier) @@ v_tsquery THEN ''identifier''';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search matched_field anchor missing';
  END IF;
  definition := replace(definition, before, before ||
    E'\n      WHEN h.result_type IN (''project'', ''pipeline'', ''analysis'')\n'
    || E'        AND position(lower(btrim(p_query)) in lower(h.title)) > 0 THEN ''title''\n'
    || E'      WHEN h.result_type IN (''project'', ''pipeline'', ''analysis'')\n'
    || E'        AND position(lower(btrim(p_query)) in lower(h.identifier)) > 0 THEN ''identifier''');

  -- 4. Where each opens.
  before := E'      WHEN h.kind = ''sample''\n';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search deep_link anchor missing';
  END IF;
  definition := replace(definition, before,
    E'      WHEN h.result_type = ''project''\n        THEN ''/projects/'' || h.record_id::text\n'
    || E'      WHEN h.result_type = ''pipeline''\n        THEN ''/pipelines/'' || h.record_id::text\n'
    || E'      WHEN h.result_type = ''analysis''\n        THEN ''/analysis/'' || h.record_id::text\n'
    || before);

  -- 5. The match: full text, or a substring of the name for the new classes;
  --    and the archived scope applied to every row.
  before := E'  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery\n    AND (p_include_archived OR NOT h.archived)';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search final where anchor missing';
  END IF;
  definition := replace(definition, before,
    E'  WHERE ((NOT v_has_query) OR h.search_vector @@ v_tsquery\n'
    || E'         OR (h.result_type IN (''project'', ''pipeline'', ''analysis'')\n'
    || E'             AND position(lower(btrim(p_query)) in lower(h.combined_text)) > 0))\n'
    || E'    AND (p_include_archived OR NOT h.archived)');

  EXECUTE definition;
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
