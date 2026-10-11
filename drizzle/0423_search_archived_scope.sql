-- R5-SHELL-04: the archived scope belongs to the canonical search boundary.
--
-- api.search has always returned archived objects alongside live ones, with an
-- `archived` flag on each row, and every surface filtered them out in the
-- browser. The scope is a property of the query, so the RPC gains an explicit
-- argument: `p_include_archived` (default true, preserving the existing
-- contract for callers that page through everything) drops archived rows from
-- every result class when a caller asks for live work only.
--
-- Permission is unchanged. api.search is SECURITY INVOKER, so RLS still bounds
-- every row before the scope is applied — a person can never see an archived
-- object they could not otherwise read.
DO $$
DECLARE
  definition text;
  before text;
BEGIN
  definition := pg_get_functiondef(
    'api.search(text,uuid,text,text,text,timestamptz,timestamptz,integer,integer,text)'::regprocedure
  );

  -- 1. The archived scope as a trailing boolean argument. It carries a default
  --    so existing named-argument callers are unaffected.
  before := 'p_result_type text DEFAULT NULL::text)';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search p_result_type anchor missing';
  END IF;
  definition := replace(definition, before,
    'p_result_type text DEFAULT NULL::text, p_include_archived boolean DEFAULT true)');

  -- 2. Apply the scope once, at the single point every result class flows
  --    through, so no branch can disagree about whether archived is included.
  before := E'  WHERE (NOT v_has_query) OR h.search_vector @@ v_tsquery';
  IF strpos(definition, before) = 0 THEN
    RAISE EXCEPTION 'api.search final where anchor missing';
  END IF;
  definition := replace(definition, before,
    before || E'\n    AND (p_include_archived OR NOT h.archived)');

  -- 3. Recreate under the widened signature. The old overload is dropped so
  --    PostgREST has exactly one api.search to resolve.
  EXECUTE 'DROP FUNCTION api.search(text,uuid,text,text,text,timestamptz,timestamptz,integer,integer,text)';
  EXECUTE definition;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search(text, uuid, text, text, text, timestamptz, timestamptz, integer, integer, text, boolean) TO api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
