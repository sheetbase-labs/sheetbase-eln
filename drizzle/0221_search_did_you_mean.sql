-- SRCH-01.4 — "did you mean" for near-miss identifiers.
--
-- Trigram similarity over record identifiers. SECURITY DEFINER (so the
-- pg_trgm functions in public resolve) with an explicit workspace predicate,
-- so a caller only sees records in their active workspace.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_did_you_mean(
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(identifier text, title text, similarity real)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.identifier, r.title, public.similarity(r.identifier, p_query) AS similarity
  FROM api.records r
  WHERE r.workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(r.workspace_id)
    AND r.deleted_at IS NULL
    AND coalesce(btrim(p_query), '') <> ''
    AND public.similarity(r.identifier, p_query) >= 0.3
  ORDER BY similarity DESC, r.identifier ASC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_did_you_mean(text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_did_you_mean(text, integer) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
