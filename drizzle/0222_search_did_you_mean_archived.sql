-- SRCH-01.4 — include-archived flag for "did you mean".

DROP FUNCTION IF EXISTS api.search_did_you_mean(text, integer);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.search_did_you_mean(
  p_query text,
  p_limit integer DEFAULT 5,
  p_include_archived boolean DEFAULT false
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
    AND (p_include_archived OR r.archived_at IS NULL)
    AND coalesce(btrim(p_query), '') <> ''
    AND public.similarity(r.identifier, p_query) >= 0.3
  ORDER BY similarity DESC, r.identifier ASC
  LIMIT greatest(1, least(coalesce(p_limit, 5), 20))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_did_you_mean(text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_did_you_mean(text, integer, boolean) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
