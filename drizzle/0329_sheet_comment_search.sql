-- SHEET-03 — canonical search includes comments.
--
-- Comments join api.search as a first-class result type. Visibility is the
-- existing comment RLS (workspace membership plus per-object read authority),
-- applied before counting, ordering and pagination. A sheet comment's
-- destination is the sheet with a comment deep-link; the parent sheet's
-- lifecycle provides the archived flag.
DO $$ DECLARE definition text;
BEGIN
  definition := pg_get_functiondef(
    'api.search(text,uuid,text,text,text,timestamptz,timestamptz,int,int,text)'::regprocedure
  );

  -- 1. Accept the comment result type.
  IF strpos(definition, '''sheet'', ''template'')') = 0 THEN
    RAISE EXCEPTION 'Search result type anchor missing';
  END IF;
  definition := replace(definition,
    '''sheet'', ''template'')',
    '''sheet'', ''template'', ''comment'')');

  -- 2. Union comment hits alongside the existing result classes. The extra
  --    column carries the sheet a comment is anchored to so the destination can
  --    be built without widening every existing branch.
  IF strpos(definition, '  FROM all_hits h
  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery') = 0 THEN
    RAISE EXCEPTION 'Search all_hits anchor missing';
  END IF;
  definition := replace(definition,
    '  FROM all_hits h
  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery',
    $search$  FROM (
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
  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery$search$);

  -- 3. Comments report their body as the matched field, ahead of the generic
  --    title/description cases.
  IF strpos(definition, '      WHEN NOT v_has_query THEN ''title''') = 0 THEN
    RAISE EXCEPTION 'Search matched field anchor missing';
  END IF;
  definition := replace(definition,
    '      WHEN NOT v_has_query THEN ''title''',
    $search$      WHEN h.result_type = 'comment'
        AND to_tsvector('english', h.block_text) @@ v_tsquery THEN 'comment_body'
      WHEN NOT v_has_query THEN 'title'$search$);

  -- 4. Comment destination: the anchored sheet (or the record) with a comment
  --    deep-link.
  IF strpos(definition, '      WHEN h.result_type = ''dataset''') = 0 THEN
    RAISE EXCEPTION 'Search deep link anchor missing';
  END IF;
  definition := replace(definition,
    '      WHEN h.result_type = ''dataset''',
    $search$      WHEN h.result_type = 'comment' AND h.comment_sheet_id IS NOT NULL
        THEN '/sheets/' || h.comment_sheet_id::text || '?commentId=' || h.record_id::text
      WHEN h.result_type = 'comment'
        THEN '/records/' || h.record_id::text
      WHEN h.result_type = 'dataset'$search$);

  EXECUTE definition;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
