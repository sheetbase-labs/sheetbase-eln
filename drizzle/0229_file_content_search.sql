-- SRCH-01.3 — file content search (CSV, TXT, JSON).
--
-- extracted_text holds the extracted text with its original newlines. It is
-- folded into the maintained record search vector, and api.search_file_contents
-- returns the matching line. PDF text extraction needs a parser dependency and
-- is tracked separately.

CREATE OR REPLACE FUNCTION internal.compute_record_search_tsv_row(rec api.records)
RETURNS tsvector
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF rec.id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN
    setweight(to_tsvector('english', coalesce(rec.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(rec.identifier, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(rec.kind, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(rec.status, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      array_to_string(coalesce(rec.tags, ARRAY[]::text[]), ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(
      internal.extract_jsonb_text(rec.properties), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(internal.extract_jsonb_text(b.payload), ' ')
         FROM api.blocks b WHERE b.record_id = rec.id), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(
         coalesce(fo.display_name, '') || ' ' || coalesce(fo.media_type, ''), ' ')
         FROM api.file_objects fo WHERE fo.record_id = rec.id), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(coalesce(fo.extracted_text, ''), ' ')
         FROM api.file_objects fo
        WHERE fo.record_id = rec.id AND fo.deleted_at IS NULL), '')), 'C') ||
    setweight(to_tsvector('english', coalesce(
      (SELECT string_agg(
         coalesce(rl.target_identifier, '') || ' ' ||
         coalesce(rl.target_kind, '') || ' ' || coalesce(rl.link_type, ''), ' ')
         FROM api.record_links rl WHERE rl.source_record_id = rec.id), '')), 'C');
END;
$$;
--> statement-breakpoint

-- Backfill any record that already has a file, so the new term is present.
UPDATE api.records
   SET search_tsv = internal.compute_record_search_tsv(id)
 WHERE id IN (SELECT record_id FROM api.file_objects)
   AND deleted_at IS NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.record_file_text(
  p_file_id uuid,
  p_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_workspace_id
    FROM api.file_objects WHERE id = p_file_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'unknown file' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the workspace' USING ERRCODE = '42501';
  END IF;
  IF p_text IS NOT NULL AND length(p_text) > 2000000 THEN
    RAISE EXCEPTION 'extracted text exceeds the limit' USING ERRCODE = '22023';
  END IF;
  UPDATE api.file_objects
     SET extracted_text = p_text,
         extracted_at = CASE WHEN p_text IS NULL THEN NULL ELSE now() END,
         updated_at = now()
   WHERE id = p_file_id;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.record_file_text(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_file_text(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_file_contents(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  file_id uuid,
  record_id uuid,
  identifier text,
  display_name text,
  line_number integer,
  line_text text,
  snippet text,
  rank real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  WITH q AS (SELECT plainto_tsquery('english', p_query) AS tsq)
  SELECT fo.id, fo.record_id, r.identifier, fo.display_name,
         m.line_number, m.line_text,
         ts_headline('english', m.line_text, q.tsq) AS snippet,
         ts_rank(to_tsvector('english', m.line_text), q.tsq) AS rank
  FROM api.file_objects fo
  JOIN api.records r ON r.id = fo.record_id
  CROSS JOIN q
  CROSS JOIN LATERAL (
    SELECT t.ord::int AS line_number, t.line AS line_text
    FROM regexp_split_to_table(coalesce(fo.extracted_text, ''), E'\n')
         WITH ORDINALITY AS t(line, ord)
    WHERE to_tsvector('english', t.line) @@ q.tsq
    ORDER BY t.ord
    LIMIT 1
  ) m
  WHERE coalesce(btrim(p_query), '') <> ''
    AND fo.extracted_text IS NOT NULL
    AND fo.deleted_at IS NULL
  ORDER BY rank DESC, m.line_number ASC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.search_file_contents(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_file_contents(text, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
