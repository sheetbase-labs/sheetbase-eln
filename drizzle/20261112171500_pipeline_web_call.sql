-- Web call step for pipelines: a step that asks another system for data.
--
-- A web call names a connection, a method and a path. A connection is one
-- place a pipeline may call: an https address an administrator approved, with
-- the secrets (a token, an API key) stored sealed beside it. A step names a
-- secret by name only; the value is never in the version, the run log, the
-- manifest or any API answer. Calls to anywhere else are refused.
--
-- Each response is recorded with the run (`internal.pipeline_run_web_responses`)
-- and listed in the run's signed manifest, so a Reproduce reads the recording
-- instead of asking again.

-- 1. The kind. `runs` says how the runner executes it; the validator reads the
-- registry, so a kind is a row plus the check of its own settings.
DO $$
DECLARE
  v_name text;
  v_def text;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO v_name, v_def
    FROM pg_constraint
   WHERE conrelid = 'internal.pipeline_step_kinds'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%runs%';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for the pipeline_step_kinds runs check';
  END IF;
  IF position('''web_call''' IN v_def) = 0 THEN
    EXECUTE format('ALTER TABLE internal.pipeline_step_kinds DROP CONSTRAINT %I', v_name);
    EXECUTE 'ALTER TABLE internal.pipeline_step_kinds ADD CONSTRAINT ' || quote_ident(v_name) || ' '
      || replace(v_def, '::text]', '::text, ''web_call''::text]');
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.pipeline_step_kinds (kind, runs) VALUES ('web_call', 'web_call')
ON CONFLICT (kind) DO NOTHING;
--> statement-breakpoint

-- The version check learns the new kind: it may be skipped when the step
-- before it gave no rows, and it needs a connection, a method and a path.
DO $$
DECLARE
  v_def text;
  v_check text := $check$
      ELSIF v_runs = 'web_call' THEN
        IF jsonb_typeof(v_item->'webCall') IS DISTINCT FROM 'object'
          OR coalesce(v_item->'webCall'->>'connection','') !~ '^[a-z][a-z0-9-]{0,48}$'
          OR coalesce(v_item->'webCall'->>'method','') NOT IN ('GET','POST')
          OR coalesce(v_item->'webCall'->>'path','') !~ '^/[^\s]*$'
          OR length(v_item->'webCall'->>'path') > 2000 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','A web call step needs a connection, a method (GET or POST) and a path that starts with /.'));
        ELSIF v_item->'webCall' ? 'secret'
          AND coalesce(v_item->'webCall'->>'secret','') !~ '^[A-Za-z][A-Za-z0-9_]{0,48}$' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','A web call secret is named by letters, digits and _.'));
        ELSIF v_item->'webCall' ? 'itemsPath'
          AND coalesce(v_item->'webCall'->>'itemsPath','') !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Where the rows are in the answer is a path such as data.items.'));
        ELSIF v_item->'webCall'->>'method' = 'GET' AND v_item->'webCall' ? 'body' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','A GET web call sends no body.'));
        END IF;
$check$;
BEGIN
  SELECT pg_get_functiondef('api.pipeline_config_errors(jsonb)'::regprocedure) INTO v_def;
  IF position('v_runs = ''web_call''' IN v_def) = 0 THEN
    IF position('NOT IN (''sql'',''python'',''plugin'')' IN v_def) = 0
      OR position(E'      ELSIF v_runs = ''ask'' THEN' IN v_def) = 0 THEN
      RAISE EXCEPTION 'unexpected shape for api.pipeline_config_errors';
    END IF;
    v_def := replace(v_def, 'NOT IN (''sql'',''python'',''plugin'')', 'NOT IN (''sql'',''python'',''plugin'',''web_call'')');
    v_def := replace(v_def, E'      ELSIF v_runs = ''ask'' THEN', v_check || E'      ELSIF v_runs = ''ask'' THEN');
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint

-- 2. Connections: the places a pipeline may call.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''pipeline_connection''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''pipeline_connection''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('pipeline_connection.created'), ('pipeline_connection.updated'), ('pipeline_connection.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.pipeline_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    base_url text NOT NULL,
    auth_header text DEFAULT 'Authorization' NOT NULL,
    auth_scheme text DEFAULT 'Bearer' NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    secret_names text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    updated_by_user_id text,
    CONSTRAINT pipeline_connections_pkey PRIMARY KEY (id),
    CONSTRAINT pipeline_connections_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT uq_pipeline_connections_key UNIQUE (workspace_id, key),
    CONSTRAINT uq_pipeline_connections_workspace_id UNIQUE (workspace_id, id),
    CONSTRAINT chk_pipeline_connections_key CHECK (key ~ '^[a-z][a-z0-9-]{0,48}$'),
    CONSTRAINT chk_pipeline_connections_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_pipeline_connections_description CHECK (description IS NULL OR length(description) <= 2000),
    CONSTRAINT chk_pipeline_connections_url CHECK (base_url ~ '^https://[^\s/@?#]+(/[^\s?#]*)?$' AND length(base_url) <= 2048),
    CONSTRAINT chk_pipeline_connections_auth_header CHECK (auth_header ~ '^[A-Za-z][A-Za-z0-9-]{0,48}$'),
    CONSTRAINT chk_pipeline_connections_auth_scheme CHECK (length(auth_scheme) <= 32 AND auth_scheme !~ '[\r\n]'),
    CONSTRAINT chk_pipeline_connections_status CHECK (status IN ('active', 'off'))
);
--> statement-breakpoint
ALTER TABLE api.pipeline_connections OWNER TO migrator;
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_connections IS 'A place a pipeline web call may reach: an approved https address. Secrets are sealed in internal.pipeline_connection_secrets; secret_names lists their names only.';
--> statement-breakpoint
CREATE INDEX idx_pipeline_connections_workspace ON api.pipeline_connections (workspace_id);
--> statement-breakpoint
ALTER TABLE api.pipeline_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_connections_select ON api.pipeline_connections FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_connections TO authenticated;
--> statement-breakpoint

-- Sealed with the same envelope as connector secrets (AES-256-GCM); a value is
-- set once and never read back by anyone, only used by the run that calls.
CREATE TABLE internal.pipeline_connection_secrets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    secret_name text NOT NULL,
    ciphertext bytea NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text,
    CONSTRAINT pipeline_connection_secrets_pkey PRIMARY KEY (id),
    CONSTRAINT uq_pipeline_connection_secrets_name UNIQUE (connection_id, secret_name),
    CONSTRAINT chk_pipeline_connection_secrets_name CHECK (secret_name ~ '^[A-Za-z][A-Za-z0-9_]{0,48}$'),
    CONSTRAINT fk_pipeline_connection_secrets_connection FOREIGN KEY (workspace_id, connection_id)
      REFERENCES api.pipeline_connections(workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.pipeline_connection_secrets OWNER TO migrator;
--> statement-breakpoint

-- 3. What each web call got back, kept with the run it belongs to.
CREATE TABLE internal.pipeline_run_web_responses (
    run_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    step_name text NOT NULL,
    seq integer NOT NULL,
    method text NOT NULL,
    url text NOT NULL,
    request_digest text NOT NULL,
    status integer NOT NULL,
    content_type text,
    body text NOT NULL,
    body_digest text NOT NULL,
    attempts integer DEFAULT 1 NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_run_web_responses_pkey PRIMARY KEY (run_id, step_name, seq),
    CONSTRAINT pipeline_run_web_responses_run_fkey FOREIGN KEY (run_id) REFERENCES api.pipeline_runs(id) ON DELETE CASCADE,
    CONSTRAINT chk_pipeline_run_web_responses_digest CHECK (request_digest ~ '^[0-9a-f]{64}$' AND body_digest ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE internal.pipeline_run_web_responses OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_web_responses_request ON internal.pipeline_run_web_responses (workspace_id, request_digest, fetched_at DESC);
--> statement-breakpoint

-- 4. The calls people and agents make. Owners, admins and stewards manage
-- connections, like webhooks. A secret value is set only in the app.
CREATE FUNCTION api.create_pipeline_connection(
    p_workspace_id uuid, p_key text, p_name text, p_base_url text,
    p_description text DEFAULT NULL, p_auth_header text DEFAULT NULL, p_auth_scheme text DEFAULT NULL
) RETURNS api.pipeline_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'A connection key is lowercase letters, digits and hyphens.' USING ERRCODE = 'SB034';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A connection needs a name.' USING ERRCODE = 'SB034';
  END IF;
  IF p_base_url IS NULL OR p_base_url !~ '^https://[^\s/@?#]+(/[^\s?#]*)?$' OR length(p_base_url) > 2048 THEN
    RAISE EXCEPTION 'A connection address is an https address with no password, query or fragment.' USING ERRCODE = 'SB034';
  END IF;
  INSERT INTO api.pipeline_connections(
    workspace_id, key, name, description, base_url, auth_header, auth_scheme,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
    rtrim(p_base_url, '/'),
    coalesce(nullif(btrim(p_auth_header), ''), 'Authorization'),
    coalesce(p_auth_scheme, 'Bearer'),
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'create', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name, 'baseUrl', v.base_url));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_pipeline_connection(uuid, text, text, text, text, text, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.update_pipeline_connection(
    p_workspace_id uuid, p_connection_id uuid, p_name text DEFAULT NULL, p_base_url text DEFAULT NULL,
    p_description text DEFAULT NULL, p_status text DEFAULT NULL,
    p_auth_header text DEFAULT NULL, p_auth_scheme text DEFAULT NULL
) RETURNS api.pipeline_connections
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.pipeline_connections
   WHERE id = p_connection_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A connection needs a name.' USING ERRCODE = 'SB034';
  END IF;
  IF p_base_url IS NOT NULL AND (p_base_url !~ '^https://[^\s/@?#]+(/[^\s?#]*)?$' OR length(p_base_url) > 2048) THEN
    RAISE EXCEPTION 'A connection address is an https address with no password, query or fragment.' USING ERRCODE = 'SB034';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'off') THEN
    RAISE EXCEPTION 'A connection is active or off.' USING ERRCODE = 'SB034';
  END IF;
  UPDATE api.pipeline_connections SET
    name = coalesce(btrim(p_name), name),
    base_url = coalesce(rtrim(p_base_url, '/'), base_url),
    description = CASE WHEN p_description IS NULL THEN description ELSE nullif(btrim(p_description), '') END,
    status = coalesce(p_status, status),
    auth_header = coalesce(nullif(btrim(p_auth_header), ''), auth_header),
    auth_scheme = coalesce(p_auth_scheme, auth_scheme),
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
   WHERE id = v.id
   RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'update', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name, 'baseUrl', v.base_url, 'status', v.status));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_pipeline_connection(uuid, uuid, text, text, text, text, text, text) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.delete_pipeline_connection(p_workspace_id uuid, p_connection_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_connections;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.pipeline_connections
   WHERE id = p_connection_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'connection not found' USING ERRCODE = 'SB036';
  END IF;
  -- A published version that calls it would fail at its first run.
  IF EXISTS (
    SELECT 1
      FROM api.pipeline_definition_versions pv,
           jsonb_array_elements(pv.configuration->'steps') s
     WHERE pv.workspace_id = p_workspace_id
       AND pv.lifecycle = 'published'
       AND s->>'kind' = 'web_call'
       AND s->'webCall'->>'connection' = v.key
  ) THEN
    RAISE EXCEPTION 'A published pipeline calls this connection. Switch it off instead, or publish a version without it first.' USING ERRCODE = 'SB034';
  END IF;
  DELETE FROM api.pipeline_connections WHERE id = v.id;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_connection', v.id, 'delete', NULL, NULL,
    jsonb_build_object('connectionId', v.id, 'key', v.key, 'name', v.name));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_pipeline_connection(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_pipeline_connection(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_pipeline_connection(uuid, uuid) TO authenticated, api_client;
