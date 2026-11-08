-- Plugin hooks on save and upload.
--
-- A plugin can run when a record or file is created, edited, uploaded or changes
-- status ("record-hooks"). Before the save it can refuse with a message or fill
-- in fields. After it, it can write a summary, add to a search index, raise a
-- flag a gate waits on, ask for a sign-off and change records. Event reactions
-- ("event-hooks") can now do the same after-the-save things.
--
-- Python cannot run in the database, so the app runs the plugin and the database
-- keeps what it said. Only the app writes these tables (internal functions that
-- are granted to no one); a person can read them where they can read the record.
-- A plugin never signs or approves anything: a sign-off it asks for is pressed
-- by a person with one of the roles it names.
--
--   * api.plugin_flags           a flag (a hold a gate waits on) or a sign-off step
--   * api.plugin_flag_sign_offs  who pressed a sign-off, and when
--   * api.plugin_record_outputs  the summary a plugin wrote for a record
--   * api.plugin_search_entries  text and vectors a plugin put in a search index
--   * a gate condition "plugin_flag": met while the plugin has nothing open on the record

-- The new point is known everywhere the others are ------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.extensions'::regclass AND conname = 'chk_extensions_disabled_points';
  IF v_def IS NULL OR position('''event-hooks''::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_extensions_disabled_points';
  END IF;
  IF position('''record-hooks''' IN v_def) = 0 THEN
    v_def := replace(v_def, '''event-hooks''::text]', '''event-hooks''::text, ''record-hooks''::text]');
    EXECUTE 'ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points';
    EXECUTE 'ALTER TABLE api.extensions ADD CONSTRAINT chk_extensions_disabled_points ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_def text := pg_get_functiondef('api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure);
BEGIN
  IF position('''record-hooks''' IN v_def) = 0 THEN
    IF position('''event-hooks'')' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
    END IF;
    EXECUTE replace(v_def, '''event-hooks'')', '''event-hooks'', ''record-hooks'')');
  END IF;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_def text := pg_get_functiondef('internal.validate_extension_manifest(jsonb)'::regprocedure);
BEGIN
  IF position('''record-hooks''' IN v_def) = 0 THEN
    IF position('''event-hooks'')' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
    END IF;
    EXECUTE replace(v_def, '''event-hooks'')', '''event-hooks'', ''record-hooks'')');
  END IF;
END $$;
--> statement-breakpoint

-- A list of distinct strings that each match a pattern, at least one of them.
CREATE FUNCTION internal.extension_unique_strings_ok(p_list jsonb, p_pattern text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT jsonb_typeof(p_list) = 'array'
     AND jsonb_array_length(p_list) >= 1
     AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_list) e
            WHERE jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ p_pattern)
     AND (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(p_list) e) = jsonb_array_length(p_list);
$$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_unique_strings_ok(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

DO $$
DECLARE
  v_def text := pg_get_functiondef('internal.validate_extension_runner_points(jsonb)'::regprocedure);
  v_branch constant text := $b$
      ELSIF v_point = 'record-hooks' THEN
        IF NOT internal.extension_unique_strings_ok(v_entry->'when', '^(created|edited|uploaded|status-changed)$')
           OR jsonb_typeof(v_entry->'timing') IS DISTINCT FROM 'string'
           OR (v_entry->>'timing') NOT IN ('before', 'after')
           OR ((v_entry ? 'kinds') AND NOT internal.extension_unique_strings_ok(v_entry->'kinds', c_type))
           OR ((v_entry ? 'statuses')
               AND (NOT internal.extension_unique_strings_ok(v_entry->'statuses', '^[a-z][a-z0-9_]{0,40}$')
                    OR NOT (v_entry->'when') ? 'status-changed'))
           OR ((v_entry ? 'file')
               AND (jsonb_typeof(v_entry->'file') IS DISTINCT FROM 'string'
                    OR (v_entry->>'file') NOT IN ('text', 'base64')
                    OR NOT (v_entry->'when') ? 'uploaded')) THEN
          RAISE EXCEPTION 'invalid extension record hook' USING ERRCODE = 'SB034';
        END IF;
$b$;
  v_anchor constant text := $a$          RAISE EXCEPTION 'invalid extension event reaction' USING ERRCODE = 'SB034';
        END IF;
$a$;
BEGIN
  IF position('''record-hooks''' IN v_def) = 0 THEN
    IF position('''event-hooks''] LOOP' IN v_def) = 0 OR position(v_anchor IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.validate_extension_runner_points';
    END IF;
    v_def := replace(v_def, '''event-hooks''] LOOP', '''event-hooks'', ''record-hooks''] LOOP');
    v_def := replace(v_def, v_anchor, v_anchor || v_branch);
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint

-- Flags and sign-offs --------------------------------------------------------------
CREATE TABLE api.plugin_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    extension_key text NOT NULL,
    extension_name text NOT NULL,
    flag_key text NOT NULL,
    -- flag: a hold the plugin raises and clears. sign_off: a step a person with one of `roles` presses.
    kind text DEFAULT 'flag' NOT NULL,
    title text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    roles text[] DEFAULT '{}'::text[] NOT NULL,
    approvals_needed integer DEFAULT 1 NOT NULL,
    -- true: the person whose change asked for the sign-off cannot press it.
    independent boolean DEFAULT true NOT NULL,
    state text DEFAULT 'open' NOT NULL,
    raised_at timestamp with time zone DEFAULT now() NOT NULL,
    raised_by_user_id text,
    cleared_at timestamp with time zone,
    CONSTRAINT plugin_flags_pkey PRIMARY KEY (id),
    CONSTRAINT plugin_flags_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT plugin_flags_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT plugin_flags_raised_by_fk FOREIGN KEY (raised_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT plugin_flags_unique UNIQUE (record_id, extension_key, flag_key),
    CONSTRAINT chk_plugin_flags_key CHECK (flag_key ~ '^[a-z][a-z0-9_-]{0,48}$' AND extension_key ~ '^[a-z][a-z0-9-]{0,48}$'),
    CONSTRAINT chk_plugin_flags_kind CHECK (kind IN ('flag', 'sign_off')),
    CONSTRAINT chk_plugin_flags_state CHECK (state IN ('open', 'cleared')),
    CONSTRAINT chk_plugin_flags_title CHECK (char_length(btrim(title)) >= 1),
    CONSTRAINT chk_plugin_flags_roles CHECK (roles <@ ARRAY['owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer']::text[]),
    CONSTRAINT chk_plugin_flags_sign_off CHECK (kind = 'flag' OR (cardinality(roles) >= 1 AND approvals_needed >= 1)),
    CONSTRAINT chk_plugin_flags_cleared CHECK ((state = 'cleared') = (cleared_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE api.plugin_flags OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plugin_flags_record ON api.plugin_flags (record_id, state);
--> statement-breakpoint
CREATE INDEX idx_plugin_flags_workspace_open ON api.plugin_flags (workspace_id, raised_at DESC) WHERE state = 'open';
--> statement-breakpoint
ALTER TABLE api.plugin_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plugin_flags_select ON api.plugin_flags FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY plugin_flags_select_api_client ON api.plugin_flags FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.plugin_flags TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.plugin_flag_sign_offs (
    flag_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    signer_user_id text NOT NULL,
    signer_role text NOT NULL,
    comment text,
    signed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_flag_sign_offs_pkey PRIMARY KEY (flag_id, signer_user_id),
    CONSTRAINT plugin_flag_sign_offs_flag_fk FOREIGN KEY (flag_id) REFERENCES api.plugin_flags(id) ON DELETE CASCADE,
    CONSTRAINT plugin_flag_sign_offs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT plugin_flag_sign_offs_signer_fk FOREIGN KEY (signer_user_id) REFERENCES internal."user"(id) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE api.plugin_flag_sign_offs OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.plugin_flag_sign_offs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plugin_flag_sign_offs_select ON api.plugin_flag_sign_offs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND EXISTS (SELECT 1 FROM api.plugin_flags f WHERE f.id = flag_id));
--> statement-breakpoint
CREATE POLICY plugin_flag_sign_offs_select_api_client ON api.plugin_flag_sign_offs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.plugin_flag_sign_offs TO authenticated, api_client;
--> statement-breakpoint

-- Raise a flag, or ask for a sign-off. Raising one that is open changes its words;
-- raising one that was cleared opens it again (and starts its sign-offs over).
CREATE FUNCTION internal.plugin_raise_flag(
    p_record_id uuid, p_extension_key text, p_extension_name text, p_flag_key text,
    p_kind text, p_title text, p_message text, p_roles text[], p_approvals integer,
    p_independent boolean, p_actor text) RETURNS api.plugin_flags
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid;
  v_row api.plugin_flags;
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = p_record_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.plugin_flags
         (workspace_id, record_id, extension_key, extension_name, flag_key, kind, title, message,
          roles, approvals_needed, independent, state, raised_by_user_id)
  VALUES (v_workspace, p_record_id, p_extension_key, left(p_extension_name, 200), p_flag_key, p_kind,
          left(p_title, 200), left(coalesce(p_message, ''), 2000), coalesce(p_roles, '{}'),
          greatest(coalesce(p_approvals, 1), 1), coalesce(p_independent, true), 'open', p_actor)
  ON CONFLICT (record_id, extension_key, flag_key) DO UPDATE
     SET kind = EXCLUDED.kind, title = EXCLUDED.title, message = EXCLUDED.message,
         roles = EXCLUDED.roles, approvals_needed = EXCLUDED.approvals_needed,
         independent = EXCLUDED.independent,
         raised_at = CASE WHEN api.plugin_flags.state = 'cleared' THEN now() ELSE api.plugin_flags.raised_at END,
         raised_by_user_id = CASE WHEN api.plugin_flags.state = 'cleared' THEN EXCLUDED.raised_by_user_id
                                  ELSE api.plugin_flags.raised_by_user_id END,
         state = 'open', cleared_at = NULL
  RETURNING * INTO v_row;
  -- A reopened sign-off starts again.
  IF v_row.kind = 'sign_off' THEN
    DELETE FROM api.plugin_flag_sign_offs s
     WHERE s.flag_id = v_row.id AND s.signed_at < v_row.raised_at;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.plugin_raise_flag(uuid, text, text, text, text, text, text, text[], integer, boolean, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plugin_raise_flag(uuid, text, text, text, text, text, text, text[], integer, boolean, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.plugin_clear_flag(p_record_id uuid, p_extension_key text, p_flag_key text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE api.plugin_flags SET state = 'cleared', cleared_at = now()
   WHERE record_id = p_record_id AND extension_key = p_extension_key AND flag_key = p_flag_key
     AND state = 'open';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.plugin_clear_flag(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plugin_clear_flag(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint

-- A person presses a sign-off. Needs one of the roles the plugin named, and, unless
-- the plugin said otherwise, not the person whose change asked for it. The flag
-- clears when enough people have.
CREATE FUNCTION api.sign_off_plugin_step(p_flag_id uuid, p_comment text DEFAULT NULL) RETURNS api.plugin_flags
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_flag api.plugin_flags;
  v_role text;
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'sign-off denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_flag FROM api.plugin_flags WHERE id = p_flag_id FOR UPDATE;
  IF v_flag.id IS NULL
     OR v_flag.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT internal.can_access_object('record', v_flag.record_id, 'view') THEN
    RAISE EXCEPTION 'sign-off not found' USING ERRCODE = '42501';
  END IF;
  IF v_flag.kind <> 'sign_off' OR v_flag.state <> 'open' THEN
    RAISE EXCEPTION 'That sign-off is not waiting for anyone' USING ERRCODE = 'SB072';
  END IF;
  SELECT m.role INTO v_role FROM api.workspace_memberships m
   WHERE m.workspace_id = v_flag.workspace_id AND m.user_id = v_actor AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY (v_flag.roles)) THEN
    RAISE EXCEPTION 'Your role cannot sign this off' USING ERRCODE = '42501';
  END IF;
  IF v_flag.independent AND v_flag.raised_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Someone other than the person who made the change has to sign this off' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.plugin_flag_sign_offs (flag_id, workspace_id, signer_user_id, signer_role, comment)
  VALUES (v_flag.id, v_flag.workspace_id, v_actor, v_role, nullif(btrim(coalesce(p_comment, '')), ''))
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_count FROM api.plugin_flag_sign_offs WHERE flag_id = v_flag.id;
  IF v_count >= v_flag.approvals_needed THEN
    UPDATE api.plugin_flags SET state = 'cleared', cleared_at = now() WHERE id = v_flag.id
    RETURNING * INTO v_flag;
  END IF;
  RETURN v_flag;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.sign_off_plugin_step(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.sign_off_plugin_step(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.sign_off_plugin_step(uuid, text) TO authenticated;
--> statement-breakpoint

-- Summaries ------------------------------------------------------------------------
CREATE TABLE api.plugin_record_outputs (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    extension_key text NOT NULL,
    extension_name text NOT NULL,
    hook_id text NOT NULL,
    summary text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_record_outputs_pkey PRIMARY KEY (record_id, extension_key, hook_id),
    CONSTRAINT plugin_record_outputs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT plugin_record_outputs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.plugin_record_outputs OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.plugin_record_outputs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plugin_record_outputs_select ON api.plugin_record_outputs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY plugin_record_outputs_select_api_client ON api.plugin_record_outputs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.plugin_record_outputs TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION internal.plugin_store_summary(
    p_record_id uuid, p_extension_key text, p_extension_name text, p_hook_id text, p_summary text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = p_record_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_summary, '')) = '' THEN
    DELETE FROM api.plugin_record_outputs
     WHERE record_id = p_record_id AND extension_key = p_extension_key AND hook_id = p_hook_id;
    RETURN;
  END IF;
  INSERT INTO api.plugin_record_outputs (record_id, workspace_id, extension_key, extension_name, hook_id, summary)
  VALUES (p_record_id, v_workspace, p_extension_key, left(p_extension_name, 200), p_hook_id, p_summary)
  ON CONFLICT (record_id, extension_key, hook_id) DO UPDATE
     SET summary = EXCLUDED.summary, extension_name = EXCLUDED.extension_name, updated_at = now();
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.plugin_store_summary(uuid, text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plugin_store_summary(uuid, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint

-- Plugin search indexes -------------------------------------------------------------
-- A plugin gives each record entries under index names it picks: words to search
-- by, a vector to rank by, or both. Vectors have no fixed width: a chemistry
-- fingerprint and a sequence embedding can live in different indexes.
CREATE TABLE api.plugin_search_entries (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    extension_key text NOT NULL,
    index_name text NOT NULL,
    entry_key text DEFAULT 'main' NOT NULL,
    body text DEFAULT ''::text NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, body)) STORED,
    embedding extensions.vector,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT plugin_search_entries_pkey PRIMARY KEY (record_id, extension_key, index_name, entry_key),
    CONSTRAINT plugin_search_entries_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT plugin_search_entries_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_plugin_search_entries_names CHECK (
      extension_key ~ '^[a-z][a-z0-9-]{0,48}$' AND index_name ~ '^[a-z][a-z0-9_-]{0,48}$'
      AND entry_key ~ '^[A-Za-z0-9_.:-]{1,100}$')
);
--> statement-breakpoint
ALTER TABLE api.plugin_search_entries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_plugin_search_entries_index ON api.plugin_search_entries (workspace_id, extension_key, index_name);
--> statement-breakpoint
CREATE INDEX idx_plugin_search_entries_tsv ON api.plugin_search_entries USING gin (tsv);
--> statement-breakpoint
ALTER TABLE api.plugin_search_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plugin_search_entries_select ON api.plugin_search_entries FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
           AND internal.can_access_object('record', record_id, 'view'));
--> statement-breakpoint
CREATE POLICY plugin_search_entries_select_api_client ON api.plugin_search_entries FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.plugin_search_entries TO authenticated, api_client;
--> statement-breakpoint

-- Replace what a plugin put in one index for a record. `p_entries` is a list of
-- { entry, body, vector } objects; entries of that index not in the list go.
CREATE FUNCTION internal.plugin_store_index(
    p_record_id uuid, p_extension_key text, p_index_name text, p_entries jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid;
  v_entry jsonb;
  v_keys text[] := '{}';
  v_vec extensions.vector;
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.records WHERE id = p_record_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '22023';
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) LOOP
    v_vec := NULL;
    IF jsonb_typeof(v_entry->'vector') = 'array' AND jsonb_array_length(v_entry->'vector') > 0 THEN
      v_vec := (v_entry->'vector')::text::extensions.vector;
    END IF;
    INSERT INTO api.plugin_search_entries (record_id, workspace_id, extension_key, index_name, entry_key, body, embedding)
    VALUES (p_record_id, v_workspace, p_extension_key, p_index_name,
            coalesce(v_entry->>'entry', 'main'), coalesce(v_entry->>'body', ''), v_vec)
    ON CONFLICT (record_id, extension_key, index_name, entry_key) DO UPDATE
       SET body = EXCLUDED.body, embedding = EXCLUDED.embedding, updated_at = now();
    v_keys := v_keys || coalesce(v_entry->>'entry', 'main');
  END LOOP;
  DELETE FROM api.plugin_search_entries
   WHERE record_id = p_record_id AND extension_key = p_extension_key AND index_name = p_index_name
     AND NOT (entry_key = ANY (v_keys));
  RETURN coalesce(array_length(v_keys, 1), 0);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.plugin_store_index(uuid, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.plugin_store_index(uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Rank a plugin's index for a search: by vector distance, by words, or both. Runs as
-- the caller, so only records the person may see can come back.
CREATE FUNCTION api.search_plugin_index(
    p_extension_key text, p_index_name text, p_query text DEFAULT NULL,
    p_vector double precision[] DEFAULT NULL, p_limit integer DEFAULT 50)
    RETURNS TABLE(record_id uuid, entry_key text, score double precision, snippet text)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_vec extensions.vector;
  v_dims integer;
  v_query tsquery;
BEGIN
  IF p_vector IS NOT NULL AND cardinality(p_vector) > 0 THEN
    v_vec := p_vector::real[]::extensions.vector;
    v_dims := cardinality(p_vector);
  END IF;
  IF btrim(coalesce(p_query, '')) <> '' THEN
    v_query := plainto_tsquery('simple'::regconfig, p_query);
  END IF;
  RETURN QUERY
  WITH mine AS MATERIALIZED (
    SELECT e.record_id, e.entry_key, e.body, e.tsv, e.embedding
      FROM api.plugin_search_entries e
     WHERE e.workspace_id = api.current_workspace_id()
       AND e.extension_key = p_extension_key AND e.index_name = p_index_name
       AND (v_vec IS NULL OR (e.embedding IS NOT NULL AND extensions.vector_dims(e.embedding) = v_dims))
  )
  SELECT m.record_id, m.entry_key,
         CASE WHEN v_vec IS NOT NULL
              THEN 1 - (m.embedding OPERATOR(extensions.<=>) v_vec)::double precision
              ELSE ts_rank(m.tsv, v_query)::double precision END AS score,
         left(m.body, 200) AS snippet
    FROM mine m
   WHERE (v_vec IS NOT NULL OR (v_query IS NOT NULL AND m.tsv @@ v_query))
   ORDER BY 3 DESC
   LIMIT greatest(coalesce(p_limit, 50), 1);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.search_plugin_index(text, text, text, double precision[], integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.search_plugin_index(text, text, text, double precision[], integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.search_plugin_index(text, text, text, double precision[], integer) TO authenticated, api_client;
--> statement-breakpoint

-- Gates ------------------------------------------------------------------------------
-- "The plugin has nothing open on this record": met while no flag (or sign-off)
-- from that plugin is open, or none with the named key.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.gate_conditions_valid(jsonb)'::regprocedure) INTO v_def;
  IF position('''plugin_flag''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.gate_conditions_valid';
    END IF;
    v_def := replace(v_def,
      '    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;',
      '    ELSIF v_kind = ''plugin_flag'' THEN' || chr(10) ||
      '      IF coalesce(v_c->>''extensionKey'', '''') !~ ''^[a-z][a-z0-9-]{0,48}$''' || chr(10) ||
      '         OR (v_c ? ''flagKey'' AND coalesce(v_c->>''flagKey'', '''') !~ ''^[a-z][a-z0-9_-]{0,48}$'') THEN' || chr(10) ||
      '        RETURN false;' || chr(10) ||
      '      END IF;' || chr(10) ||
      '    ELSE' || chr(10) || '      RETURN false;' || chr(10) || '    END IF;' || chr(10) || '  END LOOP;');
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
  v_branch text := $pf$
    ELSIF v_kind = 'plugin_flag' THEN
      v_label := coalesce(nullif(btrim(coalesce(v_c->>'label', '')), ''), 'The plugin');
      SELECT array_agg(f.title || CASE WHEN f.message <> '' THEN ' (' || f.message || ')' ELSE '' END ORDER BY f.raised_at)
        INTO v_names
        FROM api.plugin_flags f
       WHERE f.record_id = p_record_id AND f.state = 'open'
         AND f.extension_key = v_c->>'extensionKey'
         AND (NOT (v_c ? 'flagKey') OR f.flag_key = v_c->>'flagKey');
      v_met := coalesce(array_length(v_names, 1), 0) = 0;
      IF NOT v_met THEN
        v_text := v_label || ' has this open: ' || array_to_string(v_names, '; ');
      END IF;
$pf$;
BEGIN
  SELECT pg_get_functiondef('internal.eval_gate_conditions(uuid,jsonb)'::regprocedure) INTO v_def;
  IF position('''plugin_flag''' IN v_def) = 0 THEN
    IF position('    ELSE' || chr(10) || '      v_text := ''Unknown condition'';' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for internal.eval_gate_conditions';
    END IF;
    v_def := replace(v_def, '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';',
                     v_branch || chr(10) || '    ELSE' || chr(10) || '      v_text := ''Unknown condition'';');
    EXECUTE v_def;
  END IF;
END $$;
