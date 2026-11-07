-- Search by meaning.
--
-- Text that reads alike lands close together in a vector space, so a question
-- finds the notebook that answers it even when the words differ. Vectors are
-- kept per chunk of each searchable object (api.search_documents is the source
-- of text) and are only ever read through that table's row security: a chunk is
-- visible to a person exactly when its document is.
--
-- Everything is off until a workspace owner turns it on and names an embeddings
-- profile (a deployment-level provider, which can be a local model). Nothing
-- here sends data anywhere; the background job in the app does that, and only
-- for workspaces that opted in.
--
-- pgvector must be installed on the server (docker/db/Dockerfile builds the
-- image the compose files and Railway use). The extension is created as a
-- trusted one, so the migration role can do it without superuser rights.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Workspace opt-in.
-- ---------------------------------------------------------------------------
ALTER TABLE api.workspace_settings
  ADD COLUMN semantic_search_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN embeddings_profile text,
  ADD COLUMN literature_search_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE api.workspace_settings
  ADD CONSTRAINT chk_workspace_settings_embeddings_profile
  CHECK (embeddings_profile IS NULL OR length(btrim(embeddings_profile)) BETWEEN 1 AND 80);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The vectors. 1024 dimensions is the width every embedding model is padded
-- or asked to produce (cosine similarity is unchanged by zero padding), so one
-- HNSW index serves every workspace whatever model it chose.
-- ---------------------------------------------------------------------------
CREATE TABLE api.search_embeddings (
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  chunk_no integer NOT NULL CHECK (chunk_no >= 0),
  -- The passage the vector stands for, shown as the reason a result matched.
  chunk_text text NOT NULL,
  -- md5 of the whole document text this chunk came from, so an unchanged
  -- document is not embedded (and paid for) again.
  text_hash text NOT NULL,
  model_id text NOT NULL,
  embedding public.vector(1024) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_type, object_id, chunk_no),
  FOREIGN KEY (object_type, object_id)
    REFERENCES api.search_documents (object_type, object_id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.search_embeddings OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_search_embeddings_vec ON api.search_embeddings
  USING hnsw (embedding public.vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX idx_search_embeddings_workspace
  ON api.search_embeddings (workspace_id, object_type);
--> statement-breakpoint
COMMENT ON TABLE api.search_embeddings IS
  'Vectors for chunks of api.search_documents, written by the embedding job. Visible only where the document is.';
--> statement-breakpoint
GRANT SELECT ON api.search_embeddings TO authenticated, api_client;
--> statement-breakpoint
ALTER TABLE api.search_embeddings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The chunk is visible when the document is: the subquery runs under the
-- caller's own row security on api.search_documents, so project access, draft
-- privacy and per-object access all apply without being copied here.
CREATE POLICY search_embeddings_select ON api.search_embeddings
  FOR SELECT TO authenticated, api_client
  USING (workspace_id = api.current_workspace_id()
         AND EXISTS (SELECT 1 FROM api.search_documents d
                      WHERE d.object_type = search_embeddings.object_type
                        AND d.object_id = search_embeddings.object_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ranking. The caller's query vector comes in as a plain array (the app made it
-- with the workspace's profile); both calls are SECURITY INVOKER, so a hidden
-- row can never appear.
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.semantic_search(
  p_embedding real[],
  p_limit integer DEFAULT 20,
  p_types text[] DEFAULT NULL
) RETURNS TABLE (
  object_type text,
  object_id uuid,
  title text,
  identifier text,
  kind text,
  status text,
  archived boolean,
  deep_link text,
  project_id uuid,
  parent_type text,
  parent_id uuid,
  passage text,
  chunk_no integer,
  similarity real
)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
BEGIN
  IF p_embedding IS NULL OR cardinality(p_embedding) <> 1024 THEN
    RAISE EXCEPTION 'the query vector must have 1024 values' USING ERRCODE = '22023';
  END IF;
  -- Row security filters after the index scan; keep scanning until enough
  -- visible rows are found (pgvector 0.8).
  PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
  PERFORM set_config('hnsw.ef_search', '100', true);
  RETURN QUERY
  WITH near AS MATERIALIZED (
    SELECT e.object_type AS o_type, e.object_id AS o_id, e.chunk_no AS c_no,
           e.chunk_text AS c_text,
           (e.embedding OPERATOR(public.<=>) p_embedding::public.vector(1024)) AS dist
      FROM api.search_embeddings e
     WHERE e.workspace_id = api.current_workspace_id()
       AND (p_types IS NULL OR e.object_type = ANY (p_types))
     ORDER BY e.embedding OPERATOR(public.<=>) p_embedding::public.vector(1024)
     LIMIT v_limit * 8
  ),
  best AS (
    SELECT DISTINCT ON (n.o_type, n.o_id) n.*
      FROM near n
     ORDER BY n.o_type, n.o_id, n.dist
  )
  SELECT d.object_type, d.object_id, d.title, d.identifier, d.kind, d.status,
         d.archived, d.deep_link, d.project_id, d.parent_type, d.parent_id,
         b.c_text, b.c_no, (1 - b.dist)::real
    FROM best b
    JOIN api.search_documents d
      ON d.object_type = b.o_type AND d.object_id = b.o_id
   ORDER BY b.dist
   LIMIT v_limit;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.semantic_search(real[], integer, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.semantic_search(real[], integer, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.semantic_search(real[], integer, text[]) TO authenticated, api_client;
--> statement-breakpoint

-- Work that reads like this object: the average of its own chunks against
-- everyone else's. No provider call is needed, so the panel works from the
-- stored vectors alone.
CREATE FUNCTION api.similar_work(
  p_object_type text,
  p_object_id uuid,
  p_limit integer DEFAULT 8,
  p_types text[] DEFAULT NULL
) RETURNS TABLE (
  object_type text,
  object_id uuid,
  title text,
  identifier text,
  kind text,
  status text,
  archived boolean,
  deep_link text,
  project_id uuid,
  parent_type text,
  parent_id uuid,
  passage text,
  chunk_no integer,
  similarity real
)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 8), 1), 50);
  v_centroid public.vector(1024);
BEGIN
  SELECT public.avg(e.embedding) INTO v_centroid
    FROM api.search_embeddings e
   WHERE e.workspace_id = api.current_workspace_id()
     AND e.object_type = p_object_type AND e.object_id = p_object_id;
  IF v_centroid IS NULL THEN RETURN; END IF;
  PERFORM set_config('hnsw.iterative_scan', 'relaxed_order', true);
  PERFORM set_config('hnsw.ef_search', '100', true);
  RETURN QUERY
  WITH near AS MATERIALIZED (
    SELECT e.object_type AS o_type, e.object_id AS o_id, e.chunk_no AS c_no,
           e.chunk_text AS c_text,
           (e.embedding OPERATOR(public.<=>) v_centroid) AS dist
      FROM api.search_embeddings e
     WHERE e.workspace_id = api.current_workspace_id()
       AND NOT (e.object_type = p_object_type AND e.object_id = p_object_id)
       AND (p_types IS NULL OR e.object_type = ANY (p_types))
     ORDER BY e.embedding OPERATOR(public.<=>) v_centroid
     LIMIT v_limit * 10
  ),
  best AS (
    SELECT DISTINCT ON (n.o_type, n.o_id) n.*
      FROM near n
     ORDER BY n.o_type, n.o_id, n.dist
  )
  SELECT d.object_type, d.object_id, d.title, d.identifier, d.kind, d.status,
         d.archived, d.deep_link, d.project_id, d.parent_type, d.parent_id,
         b.c_text, b.c_no, (1 - b.dist)::real
    FROM best b
    JOIN api.search_documents d
      ON d.object_type = b.o_type AND d.object_id = b.o_id
   ORDER BY b.dist
   LIMIT v_limit;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.similar_work(text, uuid, integer, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.similar_work(text, uuid, integer, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.similar_work(text, uuid, integer, text[]) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Settings and status.
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.semantic_search_settings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_s api.workspace_settings;
  v_indexed bigint;
  v_total bigint;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of this workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_s FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  SELECT count(DISTINCT (e.object_type, e.object_id)) INTO v_indexed
    FROM api.search_embeddings e WHERE e.workspace_id = p_workspace_id;
  SELECT count(*) INTO v_total
    FROM api.search_documents d
   WHERE d.workspace_id = p_workspace_id
     AND d.object_type = ANY (internal.semantic_object_types());
  RETURN jsonb_build_object(
    'enabled', coalesce(v_s.semantic_search_enabled, false),
    'profile', v_s.embeddings_profile,
    'literatureEnabled', coalesce(v_s.literature_search_enabled, false),
    'indexedDocuments', v_indexed,
    'totalDocuments', v_total);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.semantic_search_settings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.semantic_search_settings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.semantic_search_settings(uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Which kinds of object are read into vectors: the ones that hold writing.
CREATE FUNCTION internal.semantic_object_types() RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT ARRAY['record', 'file', 'dataset', 'sheet', 'template', 'comment',
               'project', 'analysis', 'deviation']::text[]
$$;
--> statement-breakpoint
ALTER FUNCTION internal.semantic_object_types() OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.set_semantic_search_settings(
  p_workspace_id uuid,
  p_enabled boolean,
  p_profile text,
  p_literature boolean
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_profile text := nullif(btrim(p_profile), '');
BEGIN
  -- Choosing where text is sent is a person's decision: a browser session, not
  -- a token.
  IF api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'session_id', '') = ''
     OR coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'human session required for search settings' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF p_enabled AND v_profile IS NULL THEN
    RAISE EXCEPTION 'choose an embeddings profile first' USING ERRCODE = '22023';
  END IF;
  -- A different model makes every stored vector meaningless: start again.
  IF v_profile IS DISTINCT FROM (SELECT s.embeddings_profile FROM api.workspace_settings s
                                  WHERE s.workspace_id = p_workspace_id) THEN
    DELETE FROM api.search_embeddings WHERE workspace_id = p_workspace_id;
  END IF;
  UPDATE api.workspace_settings
     SET semantic_search_enabled = coalesce(p_enabled, false),
         embeddings_profile = v_profile,
         literature_search_enabled = coalesce(p_literature, false),
         ai_updated_by_user_id = api.current_user_id(),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;
  RETURN api.semantic_search_settings(p_workspace_id);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_semantic_search_settings(uuid, boolean, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_semantic_search_settings(uuid, boolean, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_semantic_search_settings(uuid, boolean, text, boolean) TO authenticated;
--> statement-breakpoint

-- Throw every vector away so the job reads everything again.
CREATE FUNCTION api.reindex_embeddings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_user_id() IS NULL
     OR p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.search_embeddings WHERE workspace_id = p_workspace_id;
  RETURN api.semantic_search_settings(p_workspace_id);
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.reindex_embeddings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reindex_embeddings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.reindex_embeddings(uuid) TO authenticated;
