-- Saved searches can be shared with the whole workspace, and can be read, kept and
-- run through the API. A search is private to the person who saved it unless they
-- share it. Anyone who is not a viewer can share one; the person who saved it can
-- rename, unshare or delete it, and so can the people who manage the workspace's
-- setup (owner, admin, steward). Private searches keep their limit of twenty per
-- person; a workspace keeps up to one hundred shared ones, with unique names.
--
-- `arguments` holds the exact inputs `api.search` takes (query, filter tree, sort,
-- archived, dates...), so a script can run a saved search without knowing how the
-- results page remembers its facets. `facets` still restores the page itself.

ALTER TABLE api.saved_searches
    ADD COLUMN visibility text DEFAULT 'private' NOT NULL,
    ADD COLUMN arguments jsonb,
    ADD COLUMN updated_at timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE api.saved_searches
    ADD CONSTRAINT chk_saved_searches_visibility CHECK (visibility IN ('private', 'workspace')),
    ADD CONSTRAINT chk_saved_searches_arguments CHECK (
      arguments IS NULL OR (
        jsonb_typeof(arguments) = 'object'
        AND arguments - ARRAY['p_query', 'p_project_id', 'p_kind', 'p_status', 'p_owner_id',
          'p_date_from', 'p_date_to', 'p_result_type', 'p_include_archived', 'p_filter',
          'p_sort'] = '{}'::jsonb
      ));
--> statement-breakpoint
CREATE UNIQUE INDEX uq_saved_searches_shared_name
    ON api.saved_searches USING btree (workspace_id, lower(btrim(name)))
    WHERE visibility = 'workspace';
--> statement-breakpoint
DROP POLICY saved_searches_select ON api.saved_searches;
--> statement-breakpoint
CREATE POLICY saved_searches_select ON api.saved_searches FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND (user_id = api.current_user_id() OR visibility = 'workspace'));
--> statement-breakpoint
CREATE POLICY saved_searches_client_select ON api.saved_searches FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id() AND visibility = 'workspace');
--> statement-breakpoint
GRANT SELECT ON TABLE api.saved_searches TO api_client;
--> statement-breakpoint

DROP FUNCTION api.save_search(text, text, jsonb);
--> statement-breakpoint
CREATE FUNCTION api.save_search(
    p_name text, p_query text, p_facets jsonb DEFAULT '{}'::jsonb,
    p_visibility text DEFAULT 'private', p_arguments jsonb DEFAULT NULL)
  RETURNS api.saved_searches
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_visibility text;
  v_row api.saved_searches;
BEGIN
  v_user_id := api.current_user_id();
  v_workspace_id := api.current_workspace_id();
  IF v_user_id IS NULL OR v_workspace_id IS NULL
     OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = 'SB033';
  END IF;
  v_visibility := coalesce(nullif(btrim(p_visibility), ''), 'private');
  IF v_visibility NOT IN ('private', 'workspace') THEN
    RAISE EXCEPTION 'a saved search is either private or shared with the workspace'
      USING ERRCODE = '22023';
  END IF;
  IF v_visibility = 'workspace' AND NOT api.has_capability(v_workspace_id, 'record.create') THEN
    RAISE EXCEPTION 'your role cannot share searches with the workspace'
      USING ERRCODE = '42501';
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
  IF p_arguments IS NOT NULL AND jsonb_typeof(p_arguments) <> 'object' THEN
    RAISE EXCEPTION 'arguments must be an object' USING ERRCODE = '22023';
  END IF;
  IF v_visibility = 'workspace' THEN
    -- Saving a shared search under a name you already used replaces your own.
    DELETE FROM api.saved_searches s
     WHERE s.workspace_id = v_workspace_id AND s.user_id = v_user_id
       AND s.visibility = 'workspace' AND lower(btrim(s.name)) = lower(btrim(p_name));
    IF EXISTS (SELECT 1 FROM api.saved_searches s
                WHERE s.workspace_id = v_workspace_id AND s.visibility = 'workspace'
                  AND lower(btrim(s.name)) = lower(btrim(p_name))) THEN
      RAISE EXCEPTION 'a shared search with that name already exists' USING ERRCODE = '23505';
    END IF;
    IF (SELECT count(*) FROM api.saved_searches s
         WHERE s.workspace_id = v_workspace_id AND s.visibility = 'workspace') >= 100 THEN
      RAISE EXCEPTION 'the workspace already has 100 shared searches' USING ERRCODE = '54000';
    END IF;
  ELSE
    -- Saving the same search again replaces it rather than listing it twice.
    DELETE FROM api.saved_searches s
     WHERE s.workspace_id = v_workspace_id AND s.user_id = v_user_id
       AND s.visibility = 'private'
       AND s.name = btrim(p_name) AND s.query = btrim(p_query)
       AND s.facets = coalesce(p_facets, '{}'::jsonb);
  END IF;
  INSERT INTO api.saved_searches (workspace_id, user_id, name, query, facets, visibility, arguments)
  VALUES (v_workspace_id, v_user_id, btrim(p_name), btrim(p_query),
          coalesce(p_facets, '{}'::jsonb), v_visibility, p_arguments)
  RETURNING * INTO v_row;
  DELETE FROM api.saved_searches s
   WHERE s.workspace_id = v_workspace_id AND s.user_id = v_user_id
     AND s.visibility = 'private'
     AND s.id NOT IN (
       SELECT k.id FROM api.saved_searches k
        WHERE k.workspace_id = v_workspace_id AND k.user_id = v_user_id
          AND k.visibility = 'private'
        ORDER BY k.created_at DESC, k.id DESC LIMIT 20);
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_search(text, text, jsonb, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_search(text, text, jsonb, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_search(text, text, jsonb, text, jsonb) TO authenticated;
--> statement-breakpoint

-- Rename a search, or move it between private and shared. Whoever saved it can;
-- so can the people who manage the workspace's setup, for a shared one.
CREATE FUNCTION api.update_saved_search(
    p_id uuid, p_name text DEFAULT NULL, p_visibility text DEFAULT NULL)
  RETURNS api.saved_searches
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_current api.saved_searches;
  v_name text;
  v_visibility text;
  v_row api.saved_searches;
BEGIN
  v_user_id := api.current_user_id();
  v_workspace_id := api.current_workspace_id();
  IF v_user_id IS NULL OR v_workspace_id IS NULL
     OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT * INTO v_current FROM api.saved_searches s
   WHERE s.id = p_id AND s.workspace_id = v_workspace_id
     AND (s.user_id = v_user_id OR s.visibility = 'workspace');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'saved search not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_current.user_id <> v_user_id
     AND NOT api.has_capability(v_workspace_id, 'schema.edit') THEN
    RAISE EXCEPTION 'only the person who saved a search or a workspace manager can change it'
      USING ERRCODE = '42501';
  END IF;
  v_name := coalesce(nullif(btrim(p_name), ''), v_current.name);
  IF char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'a saved search needs a name of up to 120 characters' USING ERRCODE = '22023';
  END IF;
  v_visibility := coalesce(nullif(btrim(p_visibility), ''), v_current.visibility);
  IF v_visibility NOT IN ('private', 'workspace') THEN
    RAISE EXCEPTION 'a saved search is either private or shared with the workspace'
      USING ERRCODE = '22023';
  END IF;
  IF v_visibility = 'workspace' AND v_current.visibility = 'private'
     AND NOT api.has_capability(v_workspace_id, 'record.create') THEN
    RAISE EXCEPTION 'your role cannot share searches with the workspace'
      USING ERRCODE = '42501';
  END IF;
  IF v_visibility = 'workspace' AND EXISTS (
       SELECT 1 FROM api.saved_searches s
        WHERE s.workspace_id = v_workspace_id AND s.visibility = 'workspace'
          AND s.id <> v_current.id AND lower(btrim(s.name)) = lower(v_name)) THEN
    RAISE EXCEPTION 'a shared search with that name already exists' USING ERRCODE = '23505';
  END IF;
  UPDATE api.saved_searches s
     SET name = v_name, visibility = v_visibility, updated_at = now()
   WHERE s.id = v_current.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_saved_search(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_saved_search(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_saved_search(uuid, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.delete_saved_search(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
BEGIN
  v_user_id := api.current_user_id();
  v_workspace_id := api.current_workspace_id();
  IF v_user_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = 'SB033';
  END IF;
  -- A person's own searches, and shared ones when the person manages the workspace.
  DELETE FROM api.saved_searches s
   WHERE s.id = p_id AND s.workspace_id = v_workspace_id
     AND (s.user_id = v_user_id
          OR (s.visibility = 'workspace' AND api.has_capability(v_workspace_id, 'schema.edit')));
END $$;
--> statement-breakpoint

-- Run a saved search the caller can see and get its results, as `api.search` would.
CREATE FUNCTION api.run_saved_search(
    p_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
  RETURNS TABLE (result_type text, record_id uuid, kind text, identifier text, title text,
    status text, project_id uuid, archived boolean, created_by_user_id text,
    created_at timestamptz, updated_at timestamptz, matched_context text, matched_field text,
    rank real, deep_link text, total_count bigint, parent_title text, fields jsonb)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_saved api.saved_searches;
  v_args jsonb;
BEGIN
  SELECT * INTO v_saved FROM api.saved_searches s
   WHERE s.id = p_id AND s.workspace_id = api.current_workspace_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'saved search not found' USING ERRCODE = 'P0002';
  END IF;
  v_args := coalesce(v_saved.arguments, '{}'::jsonb);
  RETURN QUERY SELECT * FROM api.search(
    p_query := coalesce(v_args ->> 'p_query', v_saved.facets ->> 'text', v_saved.query),
    p_project_id := (v_args ->> 'p_project_id')::uuid,
    p_kind := v_args ->> 'p_kind',
    p_status := v_args ->> 'p_status',
    p_owner_id := v_args ->> 'p_owner_id',
    p_date_from := (v_args ->> 'p_date_from')::timestamptz,
    p_date_to := (v_args ->> 'p_date_to')::timestamptz,
    p_limit := p_limit,
    p_offset := p_offset,
    p_result_type := v_args ->> 'p_result_type',
    p_include_archived := coalesce((v_args ->> 'p_include_archived')::boolean, true),
    p_filter := nullif(v_args -> 'p_filter', 'null'::jsonb),
    p_sort := coalesce(v_args ->> 'p_sort', 'relevance'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_saved_search(uuid, integer, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_saved_search(uuid, integer, integer) TO api_client;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.gov01_authenticated_mutation_rpc_violations() RETURNS TABLE(proname name, signature text, detail text)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT p.proname,
         p.oid::regprocedure::text,
         CASE
           WHEN pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
             OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
             THEN 'membership write gate'
           WHEN pg_get_functiondef(p.oid) ~ 'storage_member_using\('
             THEN 'storage_member_using write gate'
           ELSE '1-arg membership in mutator'
         END
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'api'
     AND p.proname NOT IN (
       'record_recent_view', 'set_record_favourite', 'follow_record',
       'set_active_workspace', 'certify_signature',
       'withdraw_signature_certification', 'mark_work_items_seen',
       -- A person's own saved searches, like favourites, are theirs to keep
       -- whatever their role; sharing one checks the role inside the function.
       'save_search', 'update_saved_search', 'delete_saved_search'
     )
     AND p.prokind = 'f'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_get_functiondef(p.oid) ~* 'INSERT[[:space:]]+INTO|UPDATE[[:space:]]+"api"|UPDATE[[:space:]]+api\.|DELETE[[:space:]]+FROM'
     AND (
       pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+"api"\."is_workspace_member"\([A-Za-z0-9_."]+\)'
       OR pg_get_functiondef(p.oid) ~ 'NOT[[:space:]]+api\.is_workspace_member\([A-Za-z0-9_.]+\)'
       OR (
         pg_get_functiondef(p.oid) ~ 'storage_member_using\('
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
       OR (
         pg_get_functiondef(p.oid) ~ 'is_workspace_member\([A-Za-z0-9_."]+\)'
         AND pg_get_functiondef(p.oid) !~ 'is_workspace_writer\('
         AND pg_get_functiondef(p.oid) !~ 'has_capability\('
       )
     )
$$;
