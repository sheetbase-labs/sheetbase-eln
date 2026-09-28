-- SRCH-01.1 — comment full-text search.
--
-- api.search_comments is SECURITY INVOKER, so the comments/records RLS scopes
-- every hit to what the caller can read. The generated search_vector column and
-- its GIN index are declared in src/db/schema.ts. Each hit carries the record
-- identity, the comment anchor (target), the author and the time.

DROP FUNCTION IF EXISTS api.search_comments(text, integer);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_comments(
  p_query text,
  p_limit integer DEFAULT 20
)
RETURNS TABLE(
  comment_id uuid,
  record_id uuid,
  identifier text,
  target_kind text,
  anchor jsonb,
  body text,
  author_user_id text,
  created_at timestamptz,
  rank real
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, api
AS $$
  SELECT c.id, c.record_id, r.identifier, c.target_kind, c.target, c.body,
         c.author_user_id, c.created_at,
         ts_rank(c.search_vector, plainto_tsquery('english', p_query)) AS rank
  FROM api.comments c
  JOIN api.records r ON r.id = c.record_id
  WHERE coalesce(btrim(p_query), '') <> ''
    AND c.search_vector @@ plainto_tsquery('english', p_query)
  ORDER BY rank DESC, c.created_at DESC
  LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_comments(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_comments(text, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
