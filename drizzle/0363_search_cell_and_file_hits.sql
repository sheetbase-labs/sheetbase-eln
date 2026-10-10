-- SRCH-01 — the canonical search covers cell values and file contents.
--
-- The results page groups Samples, Sheet rows, Dataset rows, Comments,
-- Experiments and Files for one query, but `api.search` only returned records,
-- datasets, sheets, templates and comments: a query like the design's "C-150"
-- missed the sheet/dataset cell values and the text inside uploaded files. The
-- cell indexes (SRCH-01.2) and the extracted file text (SRCH-01.3) are folded
-- into the same 16-column result, with the matched column or the file content
-- named in `matched_field` and the snippet in `matched_context`.
DO $$ DECLARE definition text; anchor text; before text; after text;
BEGIN
  definition := pg_get_functiondef('api.search(text,uuid,text,text,text,timestamptz,timestamptz,integer,integer,text)'::regprocedure);

  -- 1. Accept the cell result types.
  before := E'    (''record'', ''file'', ''dataset'', ''sheet'', ''template'', ''comment'') THEN';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search result type anchor missing'; END IF;
  definition := replace(definition, before,
    E'    (''record'', ''file'', ''dataset'', ''sheet'', ''template'', ''comment'', ''dataset_row'', ''sheet_row'') THEN');

  -- 2. A file record whose contents match is reported as a content hit, not twice.
  before := E'      AND (NOT v_has_query OR r.search_tsv @@ v_tsquery)';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search record match anchor missing'; END IF;
  definition := replace(definition, before,
    before || E'\n      AND NOT (r.kind = ''file'' AND v_has_query AND EXISTS (\n'
      || E'        SELECT 1 FROM api.file_objects fo\n'
      || E'         WHERE fo.record_id = r.id AND fo.extracted_text IS NOT NULL\n'
      || E'           AND to_tsvector(''english'', fo.extracted_text) @@ v_tsquery))');

  -- 3. Cell hits (dataset and sheet values) and file-content hits.
  before := E'  all_hits AS (\n    SELECT * FROM record_hits';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search all_hits anchor missing'; END IF;
  after := E'  ---------------------------------------------------------------------------\n'
    || E'  -- Dataset and Sheet cell values, with the matched column named.\n'
    || E'  ---------------------------------------------------------------------------\n'
    || E'  cell_hits AS (\n'
    || E'    SELECT\n'
    || E'      ''dataset_row''::text AS result_type,\n'
    || E'      cs.dataset_id AS record_id,\n'
    || E'      ''dataset_row''::text AS kind,\n'
    || E'      coalesce(d.display_id, cs.dataset_id::text) AS identifier,\n'
    || E'      d.name AS title,\n'
    || E'      d.lifecycle AS status,\n'
    || E'      d.primary_project_id AS project_id,\n'
    || E'      (d.lifecycle = ''archived'') AS archived,\n'
    || E'      d.created_by_user_id,\n'
    || E'      d.created_at,\n'
    || E'      d.updated_at,\n'
    || E'      cs.value_text AS block_text,\n'
    || E'      ''''::text AS file_text,\n'
    || E'      ''''::text AS property_text,\n'
    || E'      ''''::text AS link_text,\n'
    || E'      ''''::text AS tag_text,\n'
    || E'      cs.search_vector,\n'
    || E'      cs.value_text || '' '' || cs.field_label AS combined_text\n'
    || E'    FROM api.dataset_cell_search cs\n'
    || E'    JOIN api.datasets d ON d.id = cs.dataset_id\n'
    || E'    WHERE (v_result_type IS NULL OR v_result_type = ''dataset_row'')\n'
    || E'      AND (p_project_id IS NULL OR d.primary_project_id = p_project_id)\n'
    || E'      AND (p_date_from IS NULL OR d.created_at >= p_date_from)\n'
    || E'      AND (p_date_to IS NULL OR d.created_at <= p_date_to)\n'
    || E'      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL\n'
    || E'    UNION ALL\n'
    || E'    SELECT\n'
    || E'      ''sheet_row''::text AS result_type,\n'
    || E'      scs.instance_id AS record_id,\n'
    || E'      ''sheet_row''::text AS kind,\n'
    || E'      scs.instance_id::text AS identifier,\n'
    || E'      si.name AS title,\n'
    || E'      si.lifecycle AS status,\n'
    || E'      scs.project_id,\n'
    || E'      (si.lifecycle = ''archived'') AS archived,\n'
    || E'      si.created_by_user_id,\n'
    || E'      si.created_at,\n'
    || E'      si.updated_at,\n'
    || E'      scs.value_text AS block_text,\n'
    || E'      ''''::text AS file_text,\n'
    || E'      ''''::text AS property_text,\n'
    || E'      ''''::text AS link_text,\n'
    || E'      ''''::text AS tag_text,\n'
    || E'      scs.search_vector,\n'
    || E'      scs.value_text || '' '' || scs.field_label AS combined_text\n'
    || E'    FROM api.sheet_cell_search scs\n'
    || E'    JOIN api.sheet_instances si ON si.id = scs.instance_id\n'
    || E'    WHERE (v_result_type IS NULL OR v_result_type = ''sheet_row'')\n'
    || E'      AND (p_project_id IS NULL OR scs.project_id = p_project_id)\n'
    || E'      AND (p_date_from IS NULL OR si.created_at >= p_date_from)\n'
    || E'      AND (p_date_to IS NULL OR si.created_at <= p_date_to)\n'
    || E'      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL\n'
    || E'  ),\n'
    || E'  ---------------------------------------------------------------------------\n'
    || E'  -- Text inside an uploaded file, reported against the file''s record.\n'
    || E'  ---------------------------------------------------------------------------\n'
    || E'  file_content_hits AS (\n'
    || E'    SELECT\n'
    || E'      ''file''::text AS result_type,\n'
    || E'      r.id AS record_id,\n'
    || E'      ''file''::text AS kind,\n'
    || E'      r.identifier,\n'
    || E'      coalesce(fo.display_name, r.title) AS title,\n'
    || E'      r.status,\n'
    || E'      r.project_id,\n'
    || E'      (r.archived_at IS NOT NULL) AS archived,\n'
    || E'      r.created_by_user_id,\n'
    || E'      r.created_at,\n'
    || E'      r.updated_at,\n'
    || E'      fo.extracted_text AS block_text,\n'
    || E'      coalesce(fo.media_type, '''') AS file_text,\n'
    || E'      ''''::text AS property_text,\n'
    || E'      ''''::text AS link_text,\n'
    || E'      ''''::text AS tag_text,\n'
    || E'      to_tsvector(''english'', coalesce(fo.extracted_text, '''')) AS search_vector,\n'
    || E'      coalesce(fo.extracted_text, '''') AS combined_text\n'
    || E'    FROM api.file_objects fo\n'
    || E'    JOIN api.records r ON r.id = fo.record_id\n'
    || E'    WHERE v_has_query\n'
    || E'      AND fo.extracted_text IS NOT NULL\n'
    || E'      AND to_tsvector(''english'', fo.extracted_text) @@ v_tsquery\n'
    || E'      AND r.deleted_at IS NULL\n'
    || E'      AND (v_result_type IS NULL OR v_result_type = ''file'')\n'
    || E'      AND (p_project_id IS NULL OR r.project_id = p_project_id)\n'
    || E'      AND p_kind IS NULL AND p_status IS NULL AND p_owner_id IS NULL\n'
    || E'  ),\n';
  definition := replace(definition, before, after || before);

  before := E'    SELECT * FROM template_hits\n  )';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search template union anchor missing'; END IF;
  definition := replace(definition, before,
    E'    SELECT * FROM template_hits\n    UNION ALL\n    SELECT * FROM cell_hits\n    UNION ALL\n    SELECT * FROM file_content_hits\n  )');

  -- 4. Name the matched field for the new result types.
  before := E'      WHEN h.result_type = ''comment''\n        AND to_tsvector(''english'', h.block_text) @@ v_tsquery THEN ''comment_body''';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search matched field anchor missing'; END IF;
  definition := replace(definition, before,
    E'      WHEN h.result_type IN (''dataset_row'', ''sheet_row'')\n'
      || E'        AND to_tsvector(''english'', h.block_text) @@ v_tsquery THEN ''cell_value''\n'
      || E'      WHEN h.result_type = ''file''\n'
      || E'        AND to_tsvector(''english'', h.block_text) @@ v_tsquery THEN ''file_contents''\n'
      || before);

  -- 5. Destinations for the new result types.
  before := E'      WHEN h.result_type = ''comment'' AND h.comment_sheet_id IS NOT NULL';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search deep link anchor missing'; END IF;
  definition := replace(definition, before,
    E'      WHEN h.result_type = ''dataset_row''\n'
      || E'        THEN ''/datasets?dataset='' || h.record_id::text\n'
      || E'      WHEN h.result_type = ''sheet_row''\n'
      || E'        THEN ''/sheets/'' || h.record_id::text\n'
      || before);

  -- 6. Name matches outrank incidental cell and file text, as the design's
  --    relevance ordering shows (name matches first, then cell values).
  before := E'      ELSE ts_rank(h.search_vector, v_tsquery)\n    END AS rank,';
  IF strpos(definition, before) = 0 THEN RAISE EXCEPTION 'search rank anchor missing'; END IF;
  definition := replace(definition, before,
    E'      ELSE ts_rank(h.search_vector, v_tsquery) * CASE h.result_type\n'
      || E'        WHEN ''dataset_row'' THEN 0.5::real\n'
      || E'        WHEN ''sheet_row'' THEN 0.5::real\n'
      || E'        WHEN ''file'' THEN 0.6::real\n'
      || E'        ELSE 1::real END\n    END AS rank,');

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
