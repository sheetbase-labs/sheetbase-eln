-- Open tables: a lakehouse for each workspace.
--
-- Model views and datasets (every dataset version is a snapshot) are written as
-- Parquet files on the configured file store, described by a DuckLake catalogue
-- kept in Postgres, so DuckDB, Polars and Spark can query them without going
-- through the app. Nothing is written until an admin turns open tables on.
--
-- DuckLake keeps its catalogue in plain tables. lake_template holds the shape
-- (DuckLake catalogue version 1.1); each workspace gets its own copy in a
-- schema named lake_<the workspace id without dashes>, made by
-- internal.ensure_lake_catalogue. Readers get a login (an sblk_* Postgres role)
-- that can read that one schema and nothing else.

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
  IF position('''lake_table''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''lake_table''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('lake.table.updated'), ('lake.settings.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE SCHEMA lake_template AUTHORIZATION migrator;
--> statement-breakpoint
COMMENT ON SCHEMA lake_template IS 'Shape of a DuckLake 1.1 catalogue. Copied per workspace by internal.ensure_lake_catalogue.';
--> statement-breakpoint
REVOKE ALL ON SCHEMA lake_template FROM PUBLIC;
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_column (
    column_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint,
    table_id bigint,
    column_order bigint,
    column_name character varying,
    column_type character varying,
    initial_default character varying,
    default_value character varying,
    nulls_allowed boolean,
    parent_column bigint,
    default_value_type character varying,
    default_value_dialect character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_column_mapping (
    mapping_id bigint,
    table_id bigint,
    type character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_column_tag (
    table_id bigint,
    column_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint,
    key character varying,
    value character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_data_file (
    data_file_id bigint NOT NULL,
    table_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint,
    file_order bigint,
    path character varying,
    path_is_relative boolean,
    file_format character varying,
    record_count bigint,
    file_size_bytes bigint,
    footer_size bigint,
    row_id_start bigint,
    partition_id bigint,
    encryption_key character varying,
    mapping_id bigint,
    partial_max bigint,
    row_group_count bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_delete_file (
    delete_file_id bigint NOT NULL,
    table_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint,
    data_file_id bigint,
    path character varying,
    path_is_relative boolean,
    format character varying,
    delete_count bigint,
    file_size_bytes bigint,
    footer_size bigint,
    encryption_key character varying,
    partial_max bigint,
    row_group_count bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_file_column_stats (
    data_file_id bigint,
    table_id bigint,
    column_id bigint,
    column_size_bytes bigint,
    value_count bigint,
    null_count bigint,
    min_value character varying,
    max_value character varying,
    contains_nan boolean,
    extra_stats character varying,
    min_is_exact boolean,
    max_is_exact boolean
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_file_partition_value (
    data_file_id bigint,
    table_id bigint,
    partition_key_index bigint,
    partition_value character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_file_variant_stats (
    data_file_id bigint,
    table_id bigint,
    column_id bigint,
    variant_path character varying,
    shredded_type character varying,
    column_size_bytes bigint,
    value_count bigint,
    null_count bigint,
    min_value character varying,
    max_value character varying,
    contains_nan boolean,
    extra_stats character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_files_scheduled_for_deletion (
    data_file_id bigint,
    path character varying,
    path_is_relative boolean,
    schedule_start timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_inlined_data_tables (
    table_id bigint,
    table_name character varying,
    schema_version bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_macro (
    schema_id bigint,
    macro_id bigint,
    macro_name character varying,
    begin_snapshot bigint,
    end_snapshot bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_macro_impl (
    macro_id bigint,
    impl_id bigint,
    dialect character varying,
    sql character varying,
    type character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_macro_parameters (
    macro_id bigint,
    impl_id bigint,
    column_id bigint,
    parameter_name character varying,
    parameter_type character varying,
    default_value character varying,
    default_value_type character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_metadata (
    key character varying NOT NULL,
    value character varying NOT NULL,
    scope character varying,
    scope_id bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_name_mapping (
    mapping_id bigint,
    column_id bigint,
    source_name character varying,
    target_field_id bigint,
    parent_column bigint,
    is_partition boolean
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_partition_column (
    partition_id bigint,
    table_id bigint,
    partition_key_index bigint,
    column_id bigint,
    transform character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_partition_info (
    partition_id bigint,
    table_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_schema (
    schema_id bigint NOT NULL,
    schema_uuid uuid,
    begin_snapshot bigint,
    end_snapshot bigint,
    schema_name character varying,
    path character varying,
    path_is_relative boolean,
    parent_schema_id bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_schema_versions (
    begin_snapshot bigint,
    schema_version bigint,
    table_id bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_snapshot (
    snapshot_id bigint NOT NULL,
    snapshot_time timestamp with time zone,
    schema_version bigint,
    next_catalog_id bigint,
    next_file_id bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_snapshot_changes (
    snapshot_id bigint NOT NULL,
    changes_made character varying,
    author character varying,
    commit_message character varying,
    commit_extra_info character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_sort_expression (
    sort_id bigint,
    table_id bigint,
    sort_key_index bigint,
    expression character varying,
    dialect character varying,
    sort_direction character varying,
    null_order character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_sort_info (
    sort_id bigint,
    table_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_table (
    table_id bigint,
    table_uuid uuid,
    begin_snapshot bigint,
    end_snapshot bigint,
    schema_id bigint,
    table_name character varying,
    path character varying,
    path_is_relative boolean
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_table_column_stats (
    table_id bigint,
    column_id bigint,
    contains_null boolean,
    contains_nan boolean,
    min_value character varying,
    max_value character varying,
    extra_stats character varying,
    min_is_exact boolean,
    max_is_exact boolean
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_table_stats (
    table_id bigint,
    record_count bigint,
    next_row_id bigint,
    file_size_bytes bigint
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_tag (
    object_id bigint,
    begin_snapshot bigint,
    end_snapshot bigint,
    key character varying,
    value character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_view (
    view_id bigint,
    view_uuid uuid,
    begin_snapshot bigint,
    end_snapshot bigint,
    schema_id bigint,
    view_name character varying,
    dialect character varying,
    sql character varying,
    column_aliases character varying
);
--> statement-breakpoint
CREATE TABLE lake_template.ducklake_view_column_tag (
    view_id bigint,
    column_name character varying,
    begin_snapshot bigint,
    end_snapshot bigint,
    key character varying,
    value character varying
);
--> statement-breakpoint
ALTER TABLE lake_template.ducklake_data_file
    ADD CONSTRAINT ducklake_data_file_pkey PRIMARY KEY (data_file_id);
--> statement-breakpoint
ALTER TABLE lake_template.ducklake_delete_file
    ADD CONSTRAINT ducklake_delete_file_pkey PRIMARY KEY (delete_file_id);
--> statement-breakpoint
ALTER TABLE lake_template.ducklake_schema
    ADD CONSTRAINT ducklake_schema_pkey PRIMARY KEY (schema_id);
--> statement-breakpoint
ALTER TABLE lake_template.ducklake_snapshot_changes
    ADD CONSTRAINT ducklake_snapshot_changes_pkey PRIMARY KEY (snapshot_id);
--> statement-breakpoint
ALTER TABLE lake_template.ducklake_snapshot
    ADD CONSTRAINT ducklake_snapshot_pkey PRIMARY KEY (snapshot_id);
--> statement-breakpoint

CREATE TABLE api.lake_tables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_kind text NOT NULL,
    source_key text NOT NULL,
    source_label text NOT NULL,
    table_name text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    row_count bigint DEFAULT 0 NOT NULL,
    byte_size bigint DEFAULT 0 NOT NULL,
    file_count integer DEFAULT 0 NOT NULL,
    columns jsonb DEFAULT '[]'::jsonb NOT NULL,
    snapshots jsonb DEFAULT '[]'::jsonb NOT NULL,
    ducklake_table_id bigint,
    snapshot_id bigint,
    source_fingerprint text,
    last_snapshot_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lake_tables_pkey PRIMARY KEY (id),
    CONSTRAINT lake_tables_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT lake_tables_name_key UNIQUE (workspace_id, table_name),
    CONSTRAINT chk_lake_tables_source_kind CHECK (source_kind IN ('model_view', 'dataset')),
    CONSTRAINT chk_lake_tables_status CHECK (status IN ('pending', 'ready', 'failed', 'retired')),
    CONSTRAINT chk_lake_tables_name CHECK (table_name ~ '^[a-z][a-z0-9_]{0,62}$')
);
--> statement-breakpoint
ALTER TABLE api.lake_tables OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_lake_tables_workspace ON api.lake_tables (workspace_id, status);
--> statement-breakpoint
ALTER TABLE api.lake_tables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lake_tables_select ON api.lake_tables FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.has_data_access(workspace_id));
--> statement-breakpoint
CREATE POLICY lake_tables_client_select ON api.lake_tables FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.lake_tables TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.lake_tables TO api_client;
--> statement-breakpoint

CREATE TABLE internal.lake_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id text NOT NULL,
    name text NOT NULL,
    role_name text NOT NULL,
    token_sha256 text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    CONSTRAINT lake_credentials_pkey PRIMARY KEY (id),
    CONSTRAINT lake_credentials_role_key UNIQUE (role_name),
    CONSTRAINT lake_credentials_token_key UNIQUE (token_sha256),
    CONSTRAINT lake_credentials_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.lake_credentials OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.lake_credentials FROM PUBLIC;
--> statement-breakpoint

-- The workspace's catalogue: made on first use, then left alone.
CREATE FUNCTION internal.lake_schema_name(p_workspace_id uuid) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$ SELECT 'lake_' || replace(p_workspace_id::text, '-', '') $$;
--> statement-breakpoint
ALTER FUNCTION internal.lake_schema_name(uuid) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION internal.ensure_lake_catalogue(p_workspace_id uuid, p_data_path text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  s text := internal.lake_schema_name(p_workspace_id);
  t text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('lake_catalogue:' || p_workspace_id::text, 0));
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION migrator', s);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', s);
  FOREACH t IN ARRAY ARRAY['ducklake_column', 'ducklake_column_mapping', 'ducklake_column_tag', 'ducklake_data_file', 'ducklake_delete_file', 'ducklake_file_column_stats', 'ducklake_file_partition_value', 'ducklake_file_variant_stats', 'ducklake_files_scheduled_for_deletion', 'ducklake_inlined_data_tables', 'ducklake_macro', 'ducklake_macro_impl', 'ducklake_macro_parameters', 'ducklake_metadata', 'ducklake_name_mapping', 'ducklake_partition_column', 'ducklake_partition_info', 'ducklake_schema', 'ducklake_schema_versions', 'ducklake_snapshot', 'ducklake_snapshot_changes', 'ducklake_sort_expression', 'ducklake_sort_info', 'ducklake_table', 'ducklake_table_column_stats', 'ducklake_table_stats', 'ducklake_tag', 'ducklake_view', 'ducklake_view_column_tag'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.%I (LIKE lake_template.%I INCLUDING ALL)', s, t, t);
  END LOOP;
  EXECUTE format('SELECT 1 FROM %I.ducklake_metadata LIMIT 1', s) INTO t;
  IF t IS NULL THEN
    EXECUTE format($f$INSERT INTO %I.ducklake_metadata (key, value) VALUES
      ('version', '1.1'), ('created_by', 'Sheetbase'), ('data_path', %L), ('encrypted', 'false')$f$, s, p_data_path);
    EXECUTE format($f$INSERT INTO %I.ducklake_snapshot VALUES (0, now(), 0, 1, 0)$f$, s);
    EXECUTE format($f$INSERT INTO %I.ducklake_snapshot_changes VALUES (0, 'created_schema:"main"', NULL, NULL, NULL)$f$, s);
    EXECUTE format($f$INSERT INTO %I.ducklake_schema VALUES (0, gen_random_uuid(), 0, NULL, 'main', 'main/', true, NULL)$f$, s);
  END IF;
  RETURN s;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.ensure_lake_catalogue(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.ensure_lake_catalogue(uuid, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.lake_settings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT coalesce(integration_settings->'lake', '{}'::jsonb) INTO v
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v := coalesce(v, '{}'::jsonb);
  RETURN jsonb_build_object(
    'enabled', coalesce((v->>'enabled')::boolean, false),
    'exporterUserId', v->>'exporterUserId',
    'lastRunAt', v->>'lastRunAt',
    'lastStatus', v->>'lastStatus',
    'lastError', v->>'lastError',
    'refreshRequestedAt', v->>'refreshRequestedAt',
    'canIssueLogins', internal.reporting_ready(),
    'tableCount', (SELECT count(*) FROM api.lake_tables t
                    WHERE t.workspace_id = p_workspace_id AND t.status <> 'retired'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.lake_settings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.lake_settings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.lake_settings(uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Turn open tables on or off. Whoever turns them on becomes the person the
-- tables are written as: they hold what that person can see, so the person
-- needs data access.
CREATE FUNCTION api.set_lake_settings(p_workspace_id uuid, p_enabled boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_settings jsonb;
  v_prev jsonb;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integrations access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_enabled AND NOT api.has_data_access(p_workspace_id) THEN
    RAISE EXCEPTION 'open tables are written as the person who turns them on, who needs data access' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(integration_settings->'lake', '{}'::jsonb) INTO v_prev
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v_prev := coalesce(v_prev, '{}'::jsonb);
  v_settings := CASE WHEN p_enabled
    THEN v_prev || jsonb_build_object('enabled', true, 'exporterUserId', api.current_user_id(),
                                      'refreshRequestedAt', now())
    ELSE v_prev || jsonb_build_object('enabled', false) END;
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(coalesce(integration_settings, '{}'::jsonb), '{lake}', v_settings),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, integration_settings)
    VALUES (p_workspace_id, api.current_user_id(), jsonb_build_object('lake', v_settings));
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'lake_table', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('action', 'lake-settings', 'enabled', p_enabled));
  RETURN api.lake_settings(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_lake_settings(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_lake_settings(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_lake_settings(uuid, boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.request_lake_refresh(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_data_access(p_workspace_id) THEN
    RAISE EXCEPTION 'data access required' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce((api.lake_settings(p_workspace_id)->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION 'turn on open tables in Settings > Data first' USING ERRCODE = '22023';
  END IF;
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(integration_settings, '{lake,refreshRequestedAt}', to_jsonb(now()::text)),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  RETURN api.lake_settings(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_lake_refresh(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_lake_refresh(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_lake_refresh(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: workspaces whose open tables are due a pass.
CREATE FUNCTION internal.lake_due_workspaces() RETURNS TABLE(workspace_id uuid, exporter_user_id text, forced boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT ws.workspace_id, ws.integration_settings->'lake'->>'exporterUserId',
         (ws.integration_settings->'lake'->>'refreshRequestedAt') IS NOT NULL
         AND coalesce((ws.integration_settings->'lake'->>'refreshRequestedAt')::timestamptz > (ws.integration_settings->'lake'->>'lastRunAt')::timestamptz, true)
    FROM api.workspace_settings ws
   WHERE coalesce((ws.integration_settings->'lake'->>'enabled')::boolean, false)
     AND ws.integration_settings->'lake'->>'exporterUserId' IS NOT NULL
     AND ((ws.integration_settings->'lake'->>'lastRunAt') IS NULL
          OR (ws.integration_settings->'lake'->>'lastRunAt')::timestamptz < now() - interval '10 minutes'
          OR coalesce((ws.integration_settings->'lake'->>'refreshRequestedAt')::timestamptz > (ws.integration_settings->'lake'->>'lastRunAt')::timestamptz, false))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.lake_due_workspaces() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lake_due_workspaces() FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.record_lake_run(p_workspace_id uuid, p_status text, p_error text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(coalesce(integration_settings, '{}'::jsonb), '{lake}',
           coalesce(integration_settings->'lake', '{}'::jsonb)
           || jsonb_build_object('lastRunAt', now()::text, 'lastStatus', p_status, 'lastError', left(p_error, 500)))
   WHERE workspace_id = p_workspace_id
$$;
--> statement-breakpoint
ALTER FUNCTION internal.record_lake_run(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_lake_run(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint

-- Logins that read the lake. One per use, like SQL logins: a Postgres role that
-- can read the workspace's catalogue only, plus a token the app accepts when
-- the files themselves are fetched over HTTPS (the secret is the same string).
CREATE FUNCTION api.create_lake_credential(p_workspace_id uuid, p_name text, p_expires_at timestamp with time zone DEFAULT NULL)
    RETURNS TABLE(id uuid, username text, secret text, expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  uid text := api.current_user_id();
  cred_id uuid := gen_random_uuid();
  uname text;
  pw text;
  nm text := btrim(coalesce(p_name, ''));
  s text := internal.lake_schema_name(p_workspace_id);
  grp text := 'lake_reader_' || replace(p_workspace_id::text, '-', '');
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.has_data_access(p_workspace_id) THEN
    RAISE EXCEPTION 'data access required' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.reporting_ready() THEN
    RAISE EXCEPTION 'SQL access is not set up on this deployment' USING ERRCODE = 'SB125';
  END IF;
  IF NOT coalesce((api.lake_settings(p_workspace_id)->>'enabled')::boolean, false)
     OR to_regnamespace(s) IS NULL THEN
    RAISE EXCEPTION 'turn on open tables in Settings > Data first, and wait for the first pass' USING ERRCODE = '22023';
  END IF;
  IF length(nm) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'a login needs a name of 1 to 80 characters' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND (p_expires_at <= now() OR p_expires_at > now() + interval '366 days') THEN
    RAISE EXCEPTION 'expiry must be within the next year' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM internal.lake_credentials l
       WHERE l.workspace_id = p_workspace_id AND l.user_id = uid
         AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > now())) >= 5 THEN
    RAISE EXCEPTION 'at most 5 active lake logins per member' USING ERRCODE = 'SB126';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = grp) THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', grp);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', s, grp);
  EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO %I', s, grp);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA %I GRANT SELECT ON TABLES TO %I', s, grp);
  uname := 'sblk_' || substr(replace(cred_id::text, '-', ''), 1, 16);
  pw := 'sbk_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  EXECUTE format(
    'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD %L%s',
    uname, pw,
    CASE WHEN p_expires_at IS NULL THEN '' ELSE format(' VALID UNTIL %L', p_expires_at) END);
  EXECUTE format('GRANT %I TO %I WITH INHERIT TRUE, SET FALSE', grp, uname);
  EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', uname);
  EXECUTE format('ALTER ROLE %I SET statement_timeout = ''60s''', uname);
  EXECUTE format('ALTER ROLE %I SET idle_session_timeout = ''30min''', uname);
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = ''60s''', uname);
  INSERT INTO internal.lake_credentials (id, workspace_id, user_id, name, role_name, token_sha256, expires_at)
    VALUES (cred_id, p_workspace_id, uid, nm, uname, encode(sha256(convert_to(pw, 'UTF8')), 'hex'), p_expires_at);
  PERFORM internal.emit_change_event_as_actor(uid, p_workspace_id, 'api_credential', cred_id, 'create',
    NULL, NULL, jsonb_build_object('kind', 'lake_login', 'name', nm, 'username', uname, 'expiresAt', p_expires_at));
  RETURN QUERY SELECT cred_id, uname, pw, p_expires_at;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_lake_credential(uuid, text, timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_lake_credential(uuid, text, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_lake_credential(uuid, text, timestamp with time zone) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.revoke_lake_credential(p_workspace_id uuid, p_credential_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  uid text := api.current_user_id();
  l internal.lake_credentials;
  is_admin boolean;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR uid IS NULL THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  is_admin := EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = uid AND m.suspended_at IS NULL
       AND m.role IN ('owner', 'admin'));
  SELECT * INTO l FROM internal.lake_credentials x
   WHERE x.id = p_credential_id AND x.workspace_id = p_workspace_id
     AND (x.user_id = uid OR is_admin) FOR UPDATE;
  IF l.id IS NULL THEN
    RAISE EXCEPTION 'lake login not found' USING ERRCODE = 'SB127';
  END IF;
  IF l.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE internal.lake_credentials SET revoked_at = now() WHERE internal.lake_credentials.id = l.id;
  EXECUTE format('ALTER ROLE %I NOLOGIN', l.role_name);
  BEGIN
    PERFORM pg_catalog.pg_terminate_backend(a.pid) FROM pg_catalog.pg_stat_activity a WHERE a.usename = l.role_name;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM internal.emit_change_event_as_actor(uid, p_workspace_id, 'api_credential', l.id, 'revoke',
    NULL, NULL, jsonb_build_object('kind', 'lake_login', 'name', l.name, 'username', l.role_name));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.revoke_lake_credential(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.revoke_lake_credential(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.revoke_lake_credential(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.list_lake_credentials(p_workspace_id uuid)
    RETURNS TABLE(id uuid, name text, username text, user_id text, created_at timestamp with time zone,
                  expires_at timestamp with time zone, revoked_at timestamp with time zone,
                  last_used_at timestamp with time zone, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT l.id, l.name, l.role_name, l.user_id, l.created_at, l.expires_at, l.revoked_at, l.last_used_at,
         CASE
           WHEN l.revoked_at IS NOT NULL THEN 'revoked'
           WHEN l.expires_at IS NOT NULL AND l.expires_at <= now() THEN 'expired'
           WHEN NOT EXISTS (
             SELECT 1 FROM api.workspace_memberships m
              WHERE m.workspace_id = l.workspace_id AND m.user_id = l.user_id AND m.suspended_at IS NULL
                AND (m.role IN ('owner', 'admin') OR m.role = ANY (internal.data_access_roles(l.workspace_id)))) THEN 'suspended'
           ELSE 'active'
         END
    FROM internal.lake_credentials l
   WHERE l.workspace_id = p_workspace_id
     AND api.current_workspace_id() = p_workspace_id
     AND (l.user_id = api.current_user_id()
          OR EXISTS (SELECT 1 FROM api.workspace_memberships m
                      WHERE m.workspace_id = p_workspace_id AND m.user_id = api.current_user_id()
                        AND m.suspended_at IS NULL AND m.role IN ('owner', 'admin')))
   ORDER BY l.created_at DESC
$$;
--> statement-breakpoint
ALTER FUNCTION api.list_lake_credentials(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_lake_credentials(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.list_lake_credentials(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: the workspace a file token belongs to, while the login is
-- active and its member still has data access. Also notes when it was used.
CREATE FUNCTION internal.lake_token_workspace(p_token_sha256 text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  l internal.lake_credentials;
BEGIN
  SELECT * INTO l FROM internal.lake_credentials x WHERE x.token_sha256 = p_token_sha256;
  IF l.id IS NULL OR l.revoked_at IS NOT NULL OR (l.expires_at IS NOT NULL AND l.expires_at <= now()) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = l.workspace_id AND m.user_id = l.user_id AND m.suspended_at IS NULL
       AND (m.role IN ('owner', 'admin') OR m.role = ANY (internal.data_access_roles(l.workspace_id)))) THEN
    RETURN NULL;
  END IF;
  UPDATE internal.lake_credentials SET last_used_at = now()
   WHERE internal.lake_credentials.id = l.id
     AND (internal.lake_credentials.last_used_at IS NULL OR internal.lake_credentials.last_used_at < now() - interval '1 minute');
  RETURN l.workspace_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lake_token_workspace(text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lake_token_workspace(text) FROM PUBLIC;
--> statement-breakpoint

-- Open tables are a data-access feature. When a login's owner stops having
-- data access (role changed, suspended, removed), the login is revoked, and the
-- database role stops being able to connect, so nothing is left to read the
-- catalogue with.
CREATE FUNCTION internal.lake_revoke_orphaned_credentials() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  l internal.lake_credentials;
  n integer := 0;
BEGIN
  FOR l IN
    SELECT * FROM internal.lake_credentials x
     WHERE x.revoked_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM api.workspace_memberships m
          WHERE m.workspace_id = x.workspace_id AND m.user_id = x.user_id AND m.suspended_at IS NULL
            AND (m.role IN ('owner', 'admin') OR m.role = ANY (internal.data_access_roles(x.workspace_id))))
  LOOP
    UPDATE internal.lake_credentials SET revoked_at = now() WHERE internal.lake_credentials.id = l.id;
    EXECUTE format('ALTER ROLE %I NOLOGIN', l.role_name);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lake_revoke_orphaned_credentials() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lake_revoke_orphaned_credentials() FROM PUBLIC;
