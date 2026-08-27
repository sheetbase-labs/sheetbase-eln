-- INT-01 / INT-02: Generic Connector Framework + scientific instrument ingestion.
--
-- One execution, security, provenance and error model for all integrations:
--   * api.connectors        — connector identity/type/direction/config (non-secret only)
--   * api.connector_runs    — one governed run per execution; manual/scheduled/event
--                             trigger vocabulary, attempt/retry lineage, sha256
--                             request digest idempotency receipt, user XOR credential
--                             actor attribution (same convention as dataset_bulk_commits)
--   * api.connector_run_logs — append-only stage/error log per run (observability)
--   * internal.connector_secrets — AES-256-GCM sealed third-party secrets. Never in
--                             the api schema: PostgREST cannot see them; reads happen
--                             server-side only (src/lib/connector-secrets.server.ts).
--
-- Writes land through RPCs only. Connector registration/pausing requires the
-- `integrations.manage` capability (owner/admin/steward). Runs may be started by any
-- workspace writer and always complete through this model — ingestion never bypasses
-- canonical validate_dataset_row_batch / commit_dataset_row_batch.

CREATE TABLE "api"."connectors" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "connector_type" text NOT NULL DEFAULT 'custom',
  "direction" text NOT NULL DEFAULT 'inbound',
  "status" text NOT NULL DEFAULT 'active',
  "parser_id" text,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "updated_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  CONSTRAINT chk_connectors_key CHECK (key ~ '^[a-z][a-z0-9-]{0,48}$'),
  CONSTRAINT chk_connectors_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_connectors_type CHECK (
    connector_type IN ('instrument', 'storage', 'webhook', 'database', 'custom')
  ),
  CONSTRAINT chk_connectors_direction CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  CONSTRAINT chk_connectors_status CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT chk_connectors_parser CHECK (
    parser_id IS NULL OR (length(btrim(parser_id)) BETWEEN 1 AND 100 AND connector_type = 'instrument')
  ),
  CONSTRAINT chk_connectors_workspace_key UNIQUE (workspace_id, key)
);
--> statement-breakpoint
COMMENT ON TABLE api.connectors IS
  'INT-01 connector registry. config holds non-secret settings only; credentials live in internal.connector_secrets.';
--> statement-breakpoint
CREATE INDEX idx_connectors_workspace ON api.connectors(workspace_id);
--> statement-breakpoint

CREATE TABLE "api"."connector_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "connector_id" uuid NOT NULL,
  "trigger_kind" text NOT NULL DEFAULT 'manual',
  "status" text NOT NULL DEFAULT 'running',
  "attempt" integer NOT NULL DEFAULT 1,
  "retry_of_run_id" uuid REFERENCES api.connector_runs(id) ON DELETE set null,
  "request_digest" text,
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" text,
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "actor_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "actor_credential_id" uuid REFERENCES internal.api_credentials(id) ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("connector_id") REFERENCES api.connectors(id) ON DELETE cascade,
  CONSTRAINT chk_connector_runs_trigger CHECK (trigger_kind IN ('manual', 'scheduled', 'event')),
  CONSTRAINT chk_connector_runs_status CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT chk_connector_runs_attempt CHECK (attempt >= 1),
  CONSTRAINT chk_connector_runs_error CHECK (
    (status <> 'failed') OR (error_code IS NOT NULL AND length(btrim(error_code)) BETWEEN 1 AND 100)
  ),
  CONSTRAINT chk_connector_runs_actor_xor CHECK (
    (actor_user_id IS NULL) <> (actor_credential_id IS NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_connector_runs_digest ON api.connector_runs(connector_id, request_digest)
  WHERE request_digest IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_connector_runs_workspace ON api.connector_runs(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_connector_runs_connector ON api.connector_runs(connector_id);
--> statement-breakpoint
CREATE INDEX idx_connector_runs_connector_started ON api.connector_runs(connector_id, started_at DESC);

--> statement-breakpoint

CREATE TABLE "api"."connector_run_logs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "level" text NOT NULL DEFAULT 'info',
  "stage" text NOT NULL,
  "message" text NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("run_id") REFERENCES api.connector_runs(id) ON DELETE cascade,
  CONSTRAINT chk_connector_run_logs_level CHECK (level IN ('info', 'warning', 'error')),
  CONSTRAINT chk_connector_run_logs_stage CHECK (length(btrim(stage)) BETWEEN 1 AND 100),
  CONSTRAINT chk_connector_run_logs_message CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
  CONSTRAINT chk_connector_run_logs_sequence CHECK (sequence >= 1)
);
--> statement-breakpoint
CREATE INDEX idx_connector_run_logs_run ON api.connector_run_logs(run_id, sequence);
--> statement-breakpoint
CREATE INDEX idx_connector_run_logs_workspace ON api.connector_run_logs(workspace_id);

--> statement-breakpoint

-- Third-party secrets: api schema never sees them. Ciphertext is produced by the
-- app server (AES-256-GCM); plaintext never round-trips to a client.
CREATE TABLE "internal"."connector_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "connector_id" uuid NOT NULL,
  "secret_name" text NOT NULL,
  "ciphertext" bytea NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("connector_id") REFERENCES api.connectors(id) ON DELETE cascade,
  CONSTRAINT chk_connector_secrets_name CHECK (
    secret_name ~ '^[a-z][a-z0-9_]{0,48}$'
  ),
  CONSTRAINT uq_connector_secrets UNIQUE (connector_id, secret_name)
);
--> statement-breakpoint
CREATE INDEX idx_connector_secrets_workspace ON internal.connector_secrets(workspace_id);

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Capabilities: governance surface is owner/admin/steward.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RETURN p_capability IN ('record.create', 'record.link', 'instance.upgrade');
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' THEN
    v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
    IF v_mask IS NOT NULL THEN
      RETURN p_capability = ANY (
        string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
      );
    END IF;
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- INT-01: governance surface for connector registration/pausing.
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner',
        'admin',
        'member',
        'steward',
        'scientist',
        'analyst',
        'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.list_capabilities(p_workspace_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(capability ORDER BY capability), '{}'::text[])
    FROM unnest(ARRAY[
      'workspace.admin',
      'schema.edit',
      'schema.publish',
      'schema.retire',
      'record.link',
      'record.create',
      'instance.upgrade',
      'integrations.manage'
    ]) AS capability
   WHERE api.has_capability(p_workspace_id, capability)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_capabilities(uuid) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.register_connector(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_connector_type text DEFAULT 'custom',
  p_direction text DEFAULT 'inbound',
  p_config jsonb DEFAULT '{}'::jsonb,
  p_parser_id text DEFAULT NULL
)
RETURNS api.connectors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.connectors;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid connector key' USING ERRCODE = 'SB034';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid connector name' USING ERRCODE = 'SB034';
  END IF;
  IF p_connector_type NOT IN ('instrument', 'storage', 'webhook', 'database', 'custom') THEN
    RAISE EXCEPTION 'invalid connector type' USING ERRCODE = 'SB034';
  END IF;
  IF p_direction NOT IN ('inbound', 'outbound', 'bidirectional') THEN
    RAISE EXCEPTION 'invalid connector direction' USING ERRCODE = 'SB034';
  END IF;
  IF p_parser_id IS NOT NULL THEN
    IF p_connector_type <> 'instrument' OR length(btrim(p_parser_id)) NOT BETWEEN 1 AND 100 THEN
      RAISE EXCEPTION 'invalid parser identity' USING ERRCODE = 'SB034';
    END IF;
  END IF;
  INSERT INTO api.connectors(
    workspace_id, key, name, connector_type, direction, status, parser_id,
    config, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name), p_connector_type, p_direction, 'active',
    CASE WHEN p_parser_id IS NULL THEN NULL ELSE btrim(p_parser_id) END,
    COALESCE(p_config, '{}'::jsonb), api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.register_connector(uuid, text, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.register_connector(uuid, text, text, text, text, jsonb, text) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_connector(
  p_workspace_id uuid,
  p_connector_id uuid,
  p_name text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_config jsonb DEFAULT NULL
)
RETURNS api.connectors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.connectors;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'integrations.manage');
  SELECT * INTO v FROM api.connectors
   WHERE id = p_connector_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'connector not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('active', 'paused', 'archived') THEN
    RAISE EXCEPTION 'invalid connector status' USING ERRCODE = 'SB034';
  END IF;
  UPDATE api.connectors SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    status = COALESCE(p_status, status),
    config = COALESCE(p_config, config),
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_connector_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_connector(uuid, uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_connector(uuid, uuid, text, text, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.start_connector_run(
  p_workspace_id uuid,
  p_connector_id uuid,
  p_trigger_kind text DEFAULT 'manual',
  p_request_digest text DEFAULT NULL,
  p_retry_of_run_id uuid DEFAULT NULL
)
RETURNS api.connector_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connector api.connectors;
  v_retry_of api.connector_runs;
  v_existing api.connector_runs;
  v api.connector_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_trigger_kind NOT IN ('manual', 'scheduled', 'event') THEN
    RAISE EXCEPTION 'invalid run trigger' USING ERRCODE = 'SB034';
  END IF;
  SELECT * INTO v_connector FROM api.connectors
   WHERE id = p_connector_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_connector IS NULL THEN
    RAISE EXCEPTION 'connector not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_connector.status <> 'active' THEN
    RAISE EXCEPTION 'connector is not active' USING ERRCODE = 'SB042';
  END IF;

  -- Idempotency: same request digest on the same connector resolves to the prior
  -- successful run instead of double-ingesting.
  IF p_request_digest IS NOT NULL THEN
    IF length(btrim(p_request_digest)) NOT BETWEEN 16 AND 128 THEN
      RAISE EXCEPTION 'invalid request digest' USING ERRCODE = 'SB034';
    END IF;
    SELECT * INTO v_existing FROM api.connector_runs
     WHERE connector_id = p_connector_id
       AND request_digest = btrim(p_request_digest)
       AND workspace_id = p_workspace_id;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.status = 'running' THEN
        RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
      END IF;
      RETURN v_existing;
    END IF;
  END IF;

  IF p_retry_of_run_id IS NOT NULL THEN
    SELECT * INTO v_retry_of FROM api.connector_runs
     WHERE id = p_retry_of_run_id AND workspace_id = p_workspace_id;
    IF v_retry_of IS NULL THEN
      RAISE EXCEPTION 'retry target not found' USING ERRCODE = 'SB036';
    END IF;
  END IF;

  INSERT INTO api.connector_runs(
    workspace_id, connector_id, trigger_kind, status, attempt, retry_of_run_id,
    request_digest, actor_user_id, actor_credential_id
  ) VALUES (
    p_workspace_id, p_connector_id, p_trigger_kind, 'running',
    CASE WHEN v_retry_of.id IS NOT NULL THEN v_retry_of.attempt + 1 ELSE 1 END,
    p_retry_of_run_id,
    CASE WHEN p_request_digest IS NULL THEN NULL ELSE btrim(p_request_digest) END,
    api.current_user_id(), api.current_credential_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.start_connector_run(uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.start_connector_run(uuid, uuid, text, text, uuid) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.complete_connector_run(
  p_workspace_id uuid,
  p_run_id uuid,
  p_result jsonb DEFAULT '{}'::jsonb
)
RETURNS api.connector_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.connector_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.connector_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run already finished' USING ERRCODE = 'SB042';
  END IF;
  UPDATE api.connector_runs SET
    status = 'succeeded', finished_at = now(), result = COALESCE(p_result, '{}'::jsonb)
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.complete_connector_run(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.complete_connector_run(uuid, uuid, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.fail_connector_run(
  p_workspace_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_error_message text DEFAULT NULL
)
RETURNS api.connector_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.connector_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_error_code IS NULL OR length(btrim(p_error_code)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid error code' USING ERRCODE = 'SB034';
  END IF;
  SELECT * INTO v FROM api.connector_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run already finished' USING ERRCODE = 'SB042';
  END IF;
  UPDATE api.connector_runs SET
    status = 'failed', finished_at = now(),
    error_code = btrim(p_error_code),
    error_message = p_error_message
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.fail_connector_run(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.fail_connector_run(uuid, uuid, text, text) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.append_connector_run_log(
  p_workspace_id uuid,
  p_run_id uuid,
  p_level text,
  p_stage text,
  p_message text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS api.connector_run_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.connector_run_logs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_level NOT IN ('info', 'warning', 'error') THEN
    RAISE EXCEPTION 'invalid log level' USING ERRCODE = 'SB034';
  END IF;
  IF p_stage IS NULL OR length(btrim(p_stage)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid log stage' USING ERRCODE = 'SB034';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid log message' USING ERRCODE = 'SB034';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.connector_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.connector_run_logs(workspace_id, run_id, sequence, level, stage, message, detail)
  VALUES (
    p_workspace_id, p_run_id,
    (SELECT COALESCE(max(sequence), 0) + 1 FROM api.connector_run_logs WHERE run_id = p_run_id),
    p_level, btrim(p_stage), btrim(p_message), COALESCE(p_detail, '{}'::jsonb)
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.append_connector_run_log(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.append_connector_run_log(uuid, uuid, text, text, text, jsonb) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Table grants + RLS (mirror instrument surfaces: authenticated RLS DML, read-only api_client).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON api.connectors, api.connector_runs, api.connector_run_logs TO authenticated;
GRANT SELECT ON api.connectors, api.connector_runs, api.connector_run_logs TO api_client;
--> statement-breakpoint
ALTER TABLE api.connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.connector_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.connector_run_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY connectors_select ON api.connectors FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
-- Write policies gate on the shared writer predicate (GOV-01 inventory).
CREATE POLICY connectors_write ON api.connectors FOR INSERT TO authenticated
  WITH CHECK (api.is_workspace_writer(workspace_id));
CREATE POLICY connectors_update ON api.connectors FOR UPDATE TO authenticated
  USING (api.is_workspace_writer(workspace_id))
  WITH CHECK (api.is_workspace_writer(workspace_id));
CREATE POLICY connectors_client_select ON api.connectors FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY connector_runs_select ON api.connector_runs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY connector_runs_write ON api.connector_runs FOR INSERT TO authenticated
  WITH CHECK (api.is_workspace_writer(workspace_id));
CREATE POLICY connector_runs_update ON api.connector_runs FOR UPDATE TO authenticated
  USING (api.is_workspace_writer(workspace_id))
  WITH CHECK (api.is_workspace_writer(workspace_id));
CREATE POLICY connector_runs_client_select ON api.connector_runs FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY connector_run_logs_select ON api.connector_run_logs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY connector_run_logs_insert ON api.connector_run_logs FOR INSERT TO authenticated
  WITH CHECK (api.is_workspace_writer(workspace_id));
CREATE POLICY connector_run_logs_client_select ON api.connector_run_logs FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- change_events vocabulary + triggers.
-- ---------------------------------------------------------------------------
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type
  CHECK (entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'model_field_option', 'file',
    'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship',
    'dataset', 'dataset_version',
    'sample_event', 'comment', 'review_submission', 'signature',
    'review_decision',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement',
    'plate_design', 'plate_well', 'plate_layout_template',
    'calendar_resource', 'calendar_booking', 'calendar_booking_participant',
    'calendar_booking_sample',
    'study_workstream', 'study_task', 'study_task_dependency',
    'study_task_assignment', 'study_task_resource', 'study_deliverable',
    'study_project', 'study_experiment', 'study_plan_snapshot',
    'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot',
    'instrument_qc_check', 'instrument_raw_file', 'instrument_run_link',
    'report_definition', 'report_section', 'report_generation',
    'sheet_instance', 'sheet_definition', 'sheet_definition_version',
    'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential',
    'connector', 'connector_run'
  ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.trg_change_event_connector() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entity text; v_op text; v_payload jsonb; BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  PERFORM internal.emit_change_event(COALESCE(NEW.workspace_id, OLD.workspace_id), v_entity, COALESCE(NEW.id, OLD.id), v_op, NULL, NULL, v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_connector() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_connectors AFTER INSERT OR UPDATE OR DELETE ON api.connectors
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('connector');
--> statement-breakpoint
CREATE TRIGGER change_event_connector_runs AFTER INSERT OR UPDATE OR DELETE ON api.connector_runs
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('connector_run');
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
