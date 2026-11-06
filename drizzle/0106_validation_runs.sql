-- Validation pack: a record of each installation and operational check run
-- against a regulated-lab install.
--
-- A run is the evidence a validation team files: every check, what it found,
-- and when. Runs are only made when the workspace has the Regulated lab switch
-- on, only by someone who manages the audit settings, and can never be edited
-- or deleted afterwards. Nothing here claims compliance with any regulation.

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
  IF position('''validation_run''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''validation_run''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES ('validation.run_completed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.validation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_by_user_id text,
    app_version text NOT NULL,
    migration text,
    status text NOT NULL,
    passed integer NOT NULL,
    failed integer NOT NULL,
    skipped integer NOT NULL,
    results jsonb NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validation_runs_pkey PRIMARY KEY (id),
    CONSTRAINT validation_runs_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT validation_runs_user_fkey FOREIGN KEY (run_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_validation_runs_status CHECK (status IN ('passed', 'failed')),
    CONSTRAINT chk_validation_runs_results CHECK (jsonb_typeof(results) = 'array')
);
--> statement-breakpoint
ALTER TABLE api.validation_runs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_validation_runs_workspace ON api.validation_runs (workspace_id, finished_at DESC);
--> statement-breakpoint
ALTER TABLE api.validation_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY validation_runs_select ON api.validation_runs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'audit', 'view'));
--> statement-breakpoint
CREATE POLICY validation_runs_client_select ON api.validation_runs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.validation_runs TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.validation_runs TO api_client;
--> statement-breakpoint

CREATE FUNCTION internal.refuse_validation_run_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'validation runs cannot be changed or deleted' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refuse_validation_run_mutation() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER refuse_validation_run_mutation BEFORE UPDATE OR DELETE ON api.validation_runs
  FOR EACH ROW EXECUTE FUNCTION internal.refuse_validation_run_mutation();
--> statement-breakpoint

-- May the caller run checks here? The Regulated lab switch is on and they manage
-- the audit settings.
CREATE FUNCTION api.can_run_validation(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT api.current_user_id() IS NOT NULL
     AND api.current_workspace_id() = p_workspace_id
     AND api.has_settings_access(p_workspace_id, 'audit', 'manage')
     AND coalesce((SELECT s.regulated_lab FROM api.workspace_settings s
                    WHERE s.workspace_id = p_workspace_id), false)
$$;
--> statement-breakpoint
ALTER FUNCTION api.can_run_validation(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.can_run_validation(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.can_run_validation(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION internal.record_validation_run(
    p_workspace_id uuid, p_user_id text, p_app_version text, p_migration text,
    p_results jsonb, p_started_at timestamp with time zone)
    RETURNS api.validation_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.validation_runs;
  v_passed integer;
  v_failed integer;
  v_skipped integer;
BEGIN
  IF NOT coalesce((SELECT s.regulated_lab FROM api.workspace_settings s
                    WHERE s.workspace_id = p_workspace_id), false) THEN
    RAISE EXCEPTION 'the validation pack is for regulated labs: turn on Regulated lab in Settings > General'
      USING ERRCODE = '22023';
  END IF;
  SELECT count(*) FILTER (WHERE e->>'status' = 'passed'),
         count(*) FILTER (WHERE e->>'status' = 'failed'),
         count(*) FILTER (WHERE e->>'status' = 'skipped')
    INTO v_passed, v_failed, v_skipped
    FROM jsonb_array_elements(p_results) e;
  INSERT INTO api.validation_runs (workspace_id, run_by_user_id, app_version, migration, status,
                                   passed, failed, skipped, results, started_at)
  VALUES (p_workspace_id, p_user_id, p_app_version, p_migration,
          CASE WHEN v_failed = 0 THEN 'passed' ELSE 'failed' END,
          v_passed, v_failed, v_skipped, p_results, p_started_at)
  RETURNING * INTO r;
  PERFORM internal.emit_change_event_as_actor(
    p_user_id, p_workspace_id, 'validation_run', r.id, 'create', NULL, NULL,
    jsonb_build_object('runId', r.id, 'status', r.status, 'passed', r.passed,
                       'failed', r.failed, 'skipped', r.skipped, 'appVersion', p_app_version));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_validation_run(uuid, text, text, text, jsonb, timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_validation_run(uuid, text, text, text, jsonb, timestamp with time zone) FROM PUBLIC;
