-- Two more pipeline step kinds that reach outside the run's own database.
--
-- A remote job sends a script to an HPC queue and the run waits, like it waits
-- for a person, until the job gives its table back, fails or runs out of time.
-- A lakehouse step runs SQL against the open tables (the workspace's Parquet
-- files), read as they stand; it stays off until a data steward switches it on.
--
-- Remote job connections are ordinary connectors (api.connectors, type
-- 'custom', config.adapter = 'hpc') so their credentials use the same sealed
-- secrets; nothing here stores a secret.

-- The kinds. `runs` says how the runner executes a kind: a lakehouse step is
-- SQL, a remote job its own thing. The check names the shape of the word rather
-- than a fixed list, so a kind added later needs a row and no rewrite.
ALTER TABLE internal.pipeline_step_kinds DROP CONSTRAINT IF EXISTS pipeline_step_kinds_runs_check;
--> statement-breakpoint
ALTER TABLE internal.pipeline_step_kinds
  ADD CONSTRAINT pipeline_step_kinds_runs_check CHECK (runs ~ '^[a-z][a-z_]{0,31}$');
--> statement-breakpoint
INSERT INTO internal.pipeline_step_kinds (kind, runs) VALUES
  ('lakehouse', 'sql'),
  ('remote_job', 'remote_job')
ON CONFLICT (kind) DO NOTHING;
--> statement-breakpoint

-- The settings of these two kinds are checked when a version is saved, by a
-- trigger of their own, so api.pipeline_config_errors (rewritten by several
-- features) is left as it is. The rules are the ones in
-- src/lib/pipelines/remote/settings.ts.
CREATE FUNCTION internal.pipeline_remote_step_error(p_config jsonb) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_step jsonb;
  v_job jsonb;
  v_lake jsonb;
  v_table text;
  v_seen text[];
BEGIN
  IF jsonb_typeof(p_config->'steps') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  FOR v_step IN SELECT value FROM jsonb_array_elements(p_config->'steps') LOOP
    IF jsonb_typeof(v_step) IS DISTINCT FROM 'object' THEN
      CONTINUE;
    END IF;
    IF v_step->>'kind' = 'remote_job' THEN
      v_job := v_step->'remoteJob';
      IF jsonb_typeof(v_job) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_job->'connection') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'queue') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'script') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_job->'limitMinutes') IS DISTINCT FROM 'number' THEN
        RETURN 'A remote job step needs a connection, a queue, a script and a time limit.';
      END IF;
      IF v_job->>'connection' !~ '^[a-z][a-z0-9-]{0,48}$' THEN
        RETURN 'A remote job step needs the connection it runs on.';
      END IF;
      IF v_job->>'queue' !~ '^[a-z0-9][a-z0-9_.-]{0,62}$' THEN
        RETURN 'A remote job step needs the queue it runs on.';
      END IF;
      IF length(btrim(v_job->>'script')) NOT BETWEEN 1 AND 20000 THEN
        RETURN 'A remote job script is 1 to 20000 characters.';
      END IF;
      IF (v_job->>'limitMinutes')::numeric <> trunc((v_job->>'limitMinutes')::numeric)
        OR (v_job->>'limitMinutes')::numeric NOT BETWEEN 1 AND 10080 THEN
        RETURN 'A remote job time limit is a whole number of minutes, from 1 to 10080.';
      END IF;
    ELSIF v_step->>'kind' = 'lakehouse' THEN
      v_lake := v_step->'lake';
      IF jsonb_typeof(v_lake) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_lake->'tables') IS DISTINCT FROM 'array' THEN
        RETURN 'A lakehouse step needs the open tables it reads.';
      END IF;
      IF jsonb_array_length(v_lake->'tables') NOT BETWEEN 1 AND 10 THEN
        RETURN 'A lakehouse step reads 1 to 10 open tables.';
      END IF;
      v_seen := '{}'::text[];
      FOR v_table IN SELECT value::text FROM jsonb_array_elements(v_lake->'tables') LOOP
        IF v_table !~ '^"[a-z][a-z0-9_]{0,62}"$' THEN
          RETURN 'Open table names are lowercase letters, digits and underscores.';
        END IF;
        IF v_table = ANY(v_seen) THEN
          RETURN 'A lakehouse step names each open table once.';
        END IF;
        v_seen := array_append(v_seen, v_table);
      END LOOP;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_remote_step_error(jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.pipeline_remote_step_error(jsonb) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.trg_pipeline_remote_step_settings() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_error text;
BEGIN
  v_error := internal.pipeline_remote_step_error(NEW.configuration);
  IF v_error IS NOT NULL THEN
    RAISE EXCEPTION '%', v_error USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_pipeline_remote_step_settings() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.trg_pipeline_remote_step_settings() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER pipeline_remote_step_settings
  BEFORE INSERT OR UPDATE OF configuration ON api.pipeline_definition_versions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_pipeline_remote_step_settings();
--> statement-breakpoint

-- Change events for a remote job.
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
  IF position('''pipeline_remote_job''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''pipeline_remote_job''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

-- One row for each remote job a run sent: where it went, how it is doing, and
-- when it runs out of time. A run that resumes finds its job here by step name
-- and never sends it twice. What the job reads and gives back (the rows, and
-- the key it proves itself with) is in internal.pipeline_remote_job_data and
-- is dropped as soon as the run has what it needs.
CREATE TABLE api.pipeline_remote_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    step_name text NOT NULL,
    connection_key text NOT NULL,
    queue text NOT NULL,
    external_job_id text,
    state text DEFAULT 'submitted' NOT NULL,
    reason text,
    message text,
    limit_minutes integer NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    result_rows integer,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    scheduler_done_at timestamp with time zone,
    finished_at timestamp with time zone,
    CONSTRAINT pipeline_remote_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT pipeline_remote_jobs_run_step_key UNIQUE (run_id, step_name),
    CONSTRAINT pipeline_remote_jobs_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT pipeline_remote_jobs_run_fkey FOREIGN KEY (run_id) REFERENCES api.pipeline_runs(id) ON DELETE CASCADE,
    CONSTRAINT chk_pipeline_remote_jobs_state CHECK (state IN ('submitted', 'running', 'succeeded', 'failed', 'cancelled')),
    CONSTRAINT chk_pipeline_remote_jobs_reason CHECK (reason IS NULL OR reason IN ('job_failed', 'timed_out', 'no_result', 'cancelled', 'submit_failed')),
    CONSTRAINT chk_pipeline_remote_jobs_limit CHECK (limit_minutes BETWEEN 1 AND 10080)
);
--> statement-breakpoint
ALTER TABLE api.pipeline_remote_jobs OWNER TO migrator;
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_remote_jobs IS 'A job a pipeline run sent to an HPC queue. state: submitted, running, succeeded, failed or cancelled; reason says why a job failed.';
--> statement-breakpoint
CREATE INDEX idx_pipeline_remote_jobs_workspace ON api.pipeline_remote_jobs (workspace_id, submitted_at DESC);
--> statement-breakpoint
CREATE INDEX idx_pipeline_remote_jobs_open ON api.pipeline_remote_jobs (deadline_at) WHERE state IN ('submitted', 'running');
--> statement-breakpoint
ALTER TABLE api.pipeline_remote_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_remote_jobs_select ON api.pipeline_remote_jobs FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY pipeline_remote_jobs_client_select ON api.pipeline_remote_jobs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_remote_jobs TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_remote_jobs TO api_client;
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_remote_jobs
  AFTER INSERT OR UPDATE ON api.pipeline_remote_jobs
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('pipeline_remote_job');
--> statement-breakpoint

CREATE TABLE internal.pipeline_remote_job_data (
    job_id uuid NOT NULL,
    token_sha256 text NOT NULL,
    input_rows jsonb,
    result_rows jsonb,
    CONSTRAINT pipeline_remote_job_data_pkey PRIMARY KEY (job_id),
    CONSTRAINT pipeline_remote_job_data_job_fkey FOREIGN KEY (job_id) REFERENCES api.pipeline_remote_jobs(id) ON DELETE CASCADE,
    CONSTRAINT chk_pipeline_remote_job_data_token CHECK (token_sha256 ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE internal.pipeline_remote_job_data OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.pipeline_remote_job_data FROM PUBLIC;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('pipeline.remote_job.submitted'),
  ('pipeline.remote_job.succeeded'),
  ('pipeline.remote_job.failed'),
  ('pipeline.lakehouse_sql.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('pipeline.remote_job.submitted'),
  ('pipeline.remote_job.succeeded'),
  ('pipeline.remote_job.failed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Lakehouse SQL: the steward switch. Whether pipelines may read the open
-- tables is a data steward's call, like turning the open tables on.
CREATE FUNCTION api.pipeline_lakehouse_settings(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_settings jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT coalesce(integration_settings, '{}'::jsonb) INTO v_settings
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  RETURN jsonb_build_object(
    'enabled', coalesce((v_settings->'pipelines'->>'lakehouseSql')::boolean, false),
    'lakeEnabled', coalesce((v_settings->'lake'->>'enabled')::boolean, false),
    'tableCount', (SELECT count(*) FROM api.lake_tables t
                    WHERE t.workspace_id = p_workspace_id AND t.status = 'ready'));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.pipeline_lakehouse_settings(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.pipeline_lakehouse_settings(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.pipeline_lakehouse_settings(uuid) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_pipeline_lakehouse_sql(p_workspace_id uuid, p_enabled boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_data_access(p_workspace_id) THEN
    RAISE EXCEPTION 'data access required' USING ERRCODE = '42501';
  END IF;
  UPDATE api.workspace_settings
     SET integration_settings = jsonb_set(
           coalesce(integration_settings, '{}'::jsonb), '{pipelines}',
           coalesce(integration_settings->'pipelines', '{}'::jsonb)
             || jsonb_build_object('lakehouseSql', p_enabled)),
         updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, integration_settings)
    VALUES (p_workspace_id, api.current_user_id(),
            jsonb_build_object('pipelines', jsonb_build_object('lakehouseSql', p_enabled)));
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'lake_table', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('action', 'pipeline-lakehouse-sql', 'enabled', p_enabled));
  RETURN api.pipeline_lakehouse_settings(p_workspace_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_pipeline_lakehouse_sql(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_pipeline_lakehouse_sql(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_pipeline_lakehouse_sql(uuid, boolean) TO authenticated;
--> statement-breakpoint

-- What a lakehouse step may read: the files of an open table's current
-- snapshot. Runs as the run's actor, who needs data access (the files hold what
-- the person who turned the open tables on could see), and only while both the
-- open tables and this switch are on.
CREATE FUNCTION internal.pipeline_lake_table(p_workspace_id uuid, p_table_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_settings jsonb;
  v_table api.lake_tables;
  v_files jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR api.current_user_id() IS NULL
     OR NOT api.has_data_access(p_workspace_id) THEN
    RAISE EXCEPTION 'lakehouse SQL needs a person with data access' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(integration_settings, '{}'::jsonb) INTO v_settings
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);
  IF NOT coalesce((v_settings->'lake'->>'enabled')::boolean, false) THEN
    RAISE EXCEPTION 'open tables are off' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce((v_settings->'pipelines'->>'lakehouseSql')::boolean, false) THEN
    RAISE EXCEPTION 'lakehouse SQL is off' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_table FROM api.lake_tables t
   WHERE t.workspace_id = p_workspace_id AND t.table_name = p_table_name AND t.status = 'ready';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no open table called %', p_table_name USING ERRCODE = 'P0002';
  END IF;
  EXECUTE format(
    'SELECT coalesce(jsonb_agg(jsonb_build_object(''path'', f.path, ''rows'', f.record_count) ORDER BY f.file_order), ''[]''::jsonb)
       FROM %I.ducklake_data_file f
      WHERE f.table_id = $1 AND f.end_snapshot IS NULL',
    internal.lake_schema_name(p_workspace_id))
    INTO v_files USING v_table.ducklake_table_id;
  RETURN jsonb_build_object(
    'tableName', v_table.table_name,
    'snapshotId', v_table.snapshot_id,
    'rowCount', v_table.row_count,
    'columns', v_table.columns,
    'files', v_files);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_lake_table(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.pipeline_lake_table(uuid, text) FROM PUBLIC;
