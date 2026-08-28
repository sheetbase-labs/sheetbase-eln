-- AUTO-01 / AUTO-02 / AUTO-03: deterministic, versioned Pipelines.
--
-- One canonical automation model, reusing the same governed Sheetbase domain
-- operations as the browser, APIs and integrations:
--
--   * api.pipeline_definitions        — workspace-scoped identity (key, name,
--                                       lifecycle, revision)
--   * api.pipeline_definition_versions — immutable versioned configuration
--                                       (draft → published → retired), the
--                                       exact version a run pins for
--                                       reproducibility
--   * api.pipeline_runs               — one governed run per execution;
--                                       manual/scheduled/event trigger
--                                       vocabulary, attempt/retry lineage,
--                                       sha256 input digest idempotency
--                                       receipt, pinned definition version,
--                                       parameters and input Dataset Version
--                                       ids (provenance), user XOR credential
--                                       actor attribution
--   * api.pipeline_run_logs           — append-only stage/error log per run
--   * api.pipeline_run_outputs        — normalized provenance links from a run
--                                       to the canonical Dataset Versions it
--                                       produced
--   * api.pipeline_schedules          — interval/daily/event triggers that
--                                       start runs against the latest
--                                       published version
--
-- Execution boundary (AUTO-02): transform SQL is a single, deterministic
-- SELECT executed server-side (src/lib/pipeline-execute.server.ts) inside a
-- dedicated low-privilege `pipeline_worker` session role with zero table
-- grants, a temp-schema-only search_path and a fixed statement timeout.
-- Outputs always land through the canonical dataset RPCs
-- (commit_dataset_row_batch / snapshot_dataset), never through a second
-- writer. Writes to the pipeline tables land through RPCs only; request
-- roles get SELECT and nothing else (same governance as connector_runs).
--
-- Pipeline Definitions and Versions are authored by owner/admin/steward
-- (`pipelines.manage`); any workspace writer may start a manual run of a
-- published version.

CREATE TABLE "api"."pipeline_definitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "lifecycle" text NOT NULL DEFAULT 'active',
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "updated_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE restrict,
  CONSTRAINT chk_pipeline_definitions_key CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$'),
  CONSTRAINT chk_pipeline_definitions_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_pipeline_definitions_description CHECK (
    description IS NULL OR length(description) <= 2000
  ),
  CONSTRAINT chk_pipeline_definitions_lifecycle CHECK (
    lifecycle IN ('active', 'retired')
  ),
  CONSTRAINT chk_pipeline_definitions_revision CHECK (revision > 0),
  CONSTRAINT uq_pipeline_definitions_workspace_key UNIQUE (workspace_id, key),
  CONSTRAINT uq_pipeline_definitions_workspace_id UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_definitions_workspace ON api.pipeline_definitions(workspace_id);
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_definitions IS
  'AUTO-01 Pipeline Definition identity. Stable key immutable; display name freely editable.';
--> statement-breakpoint

CREATE TABLE "api"."pipeline_definition_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "definition_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "lifecycle" text NOT NULL DEFAULT 'draft',
  "configuration_format_version" integer NOT NULL DEFAULT 1,
  "configuration" jsonb NOT NULL,
  "revision" bigint NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "updated_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "published_at" timestamptz,
  "published_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "retired_at" timestamptz,
  "retired_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("definition_id") REFERENCES api.pipeline_definitions(id) ON DELETE restrict,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE restrict,
  CONSTRAINT chk_pipeline_definition_versions_version CHECK (version > 0),
  CONSTRAINT chk_pipeline_definition_versions_lifecycle CHECK (
    lifecycle IN ('draft', 'published', 'retired')
  ),
  CONSTRAINT chk_pipeline_definition_versions_format CHECK (
    configuration_format_version = 1
  ),
  CONSTRAINT chk_pipeline_definition_versions_revision CHECK (revision > 0),
  CONSTRAINT chk_pipeline_definition_versions_config CHECK (
    jsonb_typeof(configuration) = 'object'
  ),
  CONSTRAINT uq_pipeline_definition_versions_definition_version
    UNIQUE (definition_id, version),
  CONSTRAINT uq_pipeline_definition_versions_workspace_id
    UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_definition_versions_definition
  ON api.pipeline_definition_versions(definition_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_definition_versions_workspace
  ON api.pipeline_definition_versions(workspace_id);
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_definition_versions IS
  'AUTO-01 immutable versioned Pipeline configuration. Runs pin the exact version that produced them.';
--> statement-breakpoint

CREATE TABLE "api"."pipeline_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "definition_version_id" uuid NOT NULL,
  "trigger_kind" text NOT NULL DEFAULT 'manual',
  "status" text NOT NULL DEFAULT 'running',
  "attempt" integer NOT NULL DEFAULT 1,
  "retry_of_run_id" uuid REFERENCES api.pipeline_runs(id) ON DELETE set null,
  "input_digest" text,
  "parameters" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "input_versions" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error_code" text,
  "error_message" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "actor_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  "actor_credential_id" uuid REFERENCES internal.api_credentials(id) ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE restrict,
  FOREIGN KEY ("workspace_id", "definition_version_id")
    REFERENCES api.pipeline_definition_versions (workspace_id, id) ON DELETE restrict,
  CONSTRAINT chk_pipeline_runs_trigger CHECK (
    trigger_kind IN ('manual', 'scheduled', 'event')
  ),
  CONSTRAINT chk_pipeline_runs_status CHECK (
    status IN ('running', 'succeeded', 'failed', 'cancelled')
  ),
  CONSTRAINT chk_pipeline_runs_attempt CHECK (attempt >= 1),
  CONSTRAINT chk_pipeline_runs_digest CHECK (
    input_digest IS NULL OR input_digest ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT chk_pipeline_runs_parameters CHECK (
    jsonb_typeof(parameters) = 'object'
  ),
  CONSTRAINT chk_pipeline_runs_input_versions CHECK (
    jsonb_typeof(input_versions) = 'object'
  ),
  CONSTRAINT chk_pipeline_runs_error CHECK (
    (status <> 'failed') OR (
      error_code IS NOT NULL AND length(btrim(error_code)) BETWEEN 1 AND 100
    )
  ),
  CONSTRAINT chk_pipeline_runs_actor_xor CHECK (
    (actor_user_id IS NULL) <> (actor_credential_id IS NULL)
  ),
  CONSTRAINT uq_pipeline_runs_workspace_id UNIQUE (workspace_id, id)
);
--> statement-breakpoint
-- Idempotency receipt: identical inputs against the same published version
-- replay the prior success instead of manufacturing duplicate outputs.
CREATE UNIQUE INDEX uq_pipeline_runs_digest
  ON api.pipeline_runs(definition_version_id, input_digest)
  WHERE input_digest IS NOT NULL AND status = 'succeeded';
--> statement-breakpoint
-- One running attempt per input identity: concurrent duplicate starts
-- conflict instead of double-executing.
CREATE UNIQUE INDEX uq_pipeline_runs_digest_running
  ON api.pipeline_runs(definition_version_id, input_digest)
  WHERE input_digest IS NOT NULL AND status = 'running';
--> statement-breakpoint
CREATE INDEX idx_pipeline_runs_workspace ON api.pipeline_runs(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_runs_definition_version ON
  api.pipeline_runs(definition_version_id, started_at DESC);
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_runs IS
  'AUTO-01/02 one governed Pipeline run. Pins the exact definition version, parameters and input Dataset Version ids; carries digest idempotency, attempt/retry lineage and actor attribution.';
--> statement-breakpoint

CREATE TABLE "api"."pipeline_run_logs" (
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
  FOREIGN KEY ("workspace_id", "run_id")
    REFERENCES api.pipeline_runs (workspace_id, id) ON DELETE cascade,
  CONSTRAINT chk_pipeline_run_logs_level CHECK (level IN ('info', 'warning', 'error')),
  CONSTRAINT chk_pipeline_run_logs_stage CHECK (length(btrim(stage)) BETWEEN 1 AND 100),
  CONSTRAINT chk_pipeline_run_logs_message CHECK (length(btrim(message)) BETWEEN 1 AND 2000),
  CONSTRAINT chk_pipeline_run_logs_sequence CHECK (sequence >= 1)
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_logs_run ON api.pipeline_run_logs(run_id, sequence);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_logs_workspace ON api.pipeline_run_logs(workspace_id);
--> statement-breakpoint

-- Normalized provenance: which canonical Dataset Versions a run produced.
CREATE TABLE "api"."pipeline_run_outputs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "dataset_id" uuid NOT NULL,
  "dataset_version_id" uuid NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY ("workspace_id", "run_id")
    REFERENCES api.pipeline_runs (workspace_id, id) ON DELETE cascade,
  FOREIGN KEY ("dataset_id") REFERENCES api.datasets(id) ON DELETE restrict,
  FOREIGN KEY ("dataset_version_id") REFERENCES api.dataset_versions(id) ON DELETE restrict,
  CONSTRAINT chk_pipeline_run_outputs_label CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  CONSTRAINT uq_pipeline_run_outputs_run_dataset_version
    UNIQUE (run_id, dataset_id, dataset_version_id),
  CONSTRAINT uq_pipeline_run_outputs_workspace_id UNIQUE (workspace_id, id)
);
--> statement-breakpoint
-- Reverse lookup for Dataset pages: which Pipelines produced this Dataset.
CREATE INDEX idx_pipeline_run_outputs_dataset ON api.pipeline_run_outputs(dataset_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_outputs_version ON api.pipeline_run_outputs(dataset_version_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_outputs_run ON api.pipeline_run_outputs(run_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_run_outputs_workspace ON api.pipeline_run_outputs(workspace_id);
--> statement-breakpoint

-- Triggers: schedule runs resolve the latest published version at trigger
-- time; a retired definition stops its schedules from firing.
CREATE TABLE "api"."pipeline_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL,
  "definition_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "spec" jsonb NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "next_run_at" timestamptz,
  "last_evaluated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_by_user_id" text REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY ("workspace_id") REFERENCES api.workspaces(id) ON DELETE restrict,
  FOREIGN KEY ("definition_id") REFERENCES api.pipeline_definitions(id) ON DELETE restrict,
  CONSTRAINT chk_pipeline_schedules_kind CHECK (kind IN ('interval', 'daily', 'event')),
  CONSTRAINT chk_pipeline_schedules_spec CHECK (jsonb_typeof(spec) = 'object'),
  CONSTRAINT uq_pipeline_schedules_workspace_id UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_schedules_workspace ON api.pipeline_schedules(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_pipeline_schedules_enabled_next ON
  api.pipeline_schedules(enabled, next_run_at) WHERE enabled;
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_schedules IS
  'AUTO-02 schedule/event triggers. interval/daily schedules are evaluated by the server sweep; event schedules fire when the sweep observes matching change_events since last_evaluated_at.';

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Capability: governance surface is owner/admin/steward.
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
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
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
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- AUTO-01/03: Pipeline Definition/Version/Schedule authoring surface.
    WHEN p_capability = 'pipelines.manage' THEN
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
      'integrations.manage',
      'pipelines.manage'
    ]) AS capability
   WHERE api.has_capability(p_workspace_id, capability)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_capabilities(uuid) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Configuration validation.
--
-- api.pipeline_config_errors returns an array of {code, field, message}
-- violations for a Pipeline configuration object (format version 1). The
-- server-side TypeScript validator (src/lib/pipelines/config.ts) mirrors
-- these rules for the authoring UI; the database is authoritative at the
-- version boundary (create/publish) and at run start.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.pipeline_config_errors(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_param jsonb;
  v_input jsonb;
  v_names text[] := '{}'::text[];
  v_value jsonb;
  v_key text;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'configuration', 'message', 'configuration must be an object')
    );
  END IF;
  IF p_config->>'configVersion' <> '1' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'unsupported_config_version', 'field', 'configVersion', 'message', 'configVersion must be 1')
    );
  END IF;
  IF p_config ? 'description' AND jsonb_typeof(p_config->'description') NOT IN ('string', 'null') THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'description', 'message', 'description must be a string')
    );
  ELSIF jsonb_typeof(p_config->'description') = 'string'
    AND length(p_config->>'description') > 2000 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'description', 'message', 'description must be at most 2000 characters')
    );
  END IF;

  -- parameters (optional; absent means none)
  IF p_config ? 'parameters' AND jsonb_typeof(p_config->'parameters') IS DISTINCT FROM 'array' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'parameters', 'message', 'parameters must be an array')
    );
  ELSIF p_config ? 'parameters' AND jsonb_array_length(p_config->'parameters') > 50 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'too_many', 'field', 'parameters', 'message', 'at most 50 parameters are allowed')
    );
  ELSE
    FOR v_param IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
      IF jsonb_typeof(v_param) <> 'object'
         OR v_param - ARRAY['name','type','required','default','description'] <> '{}'::jsonb
         OR jsonb_typeof(v_param->'name') <> 'string'
         OR v_param->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_shape', 'field', 'parameters', 'message', 'each parameter needs a valid lowercase name')
        );
      ELSIF v_param->>'name' = ANY(v_names) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', 'parameters', 'message', 'parameter name is duplicated: ' || v_param->>'name')
        );
      ELSE
        v_names := array_append(v_names, v_param->>'name');
        IF v_param->>'type' NOT IN ('text','integer','decimal','boolean','date','timestamp') THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' has an unsupported type')
          );
        END IF;
        IF jsonb_typeof(v_param->'required') NOT IN ('boolean', 'null', 'undefined') THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' required must be a boolean')
          );
        END IF;
        IF v_param ? 'default' AND coalesce((v_param->>'required')::boolean, false) THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'required parameter ' || v_param->>'name' || ' cannot declare a default')
          );
        END IF;
        IF v_param ? 'default' AND v_param->'default' IS NOT NULL AND NOT (
          (v_param->>'type' = 'text' AND jsonb_typeof(v_param->'default') = 'string')
          OR (v_param->>'type' = 'integer' AND jsonb_typeof(v_param->'default') = 'number'
              AND v_param->'default' #>> '{}' ~ '^-?[0-9]+$')
          OR (v_param->>'type' = 'decimal' AND jsonb_typeof(v_param->'default') = 'number')
          OR (v_param->>'type' = 'boolean' AND jsonb_typeof(v_param->'default') = 'boolean')
          OR (v_param->>'type' = 'date' AND jsonb_typeof(v_param->'default') = 'string'
              AND v_param->'default' #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
          OR (v_param->>'type' = 'timestamp' AND jsonb_typeof(v_param->'default') = 'string')
        ) THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' default does not match its type')
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- inputs (required: between 1 and 10)
  v_names := '{}'::text[];
  IF NOT p_config ? 'inputs' OR jsonb_typeof(p_config->'inputs') IS DISTINCT FROM 'array' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'inputs must be an array')
    );
  ELSIF jsonb_array_length(p_config->'inputs') = 0 OR jsonb_array_length(p_config->'inputs') > 10 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'inputs must contain between 1 and 10 entries')
    );
  ELSE
    FOR v_input IN SELECT value FROM jsonb_array_elements(p_config->'inputs') LOOP
      IF jsonb_typeof(v_input) <> 'object'
         OR v_input - ARRAY['name','required','description'] <> '{}'::jsonb
         OR jsonb_typeof(v_input->'name') <> 'string'
         OR v_input->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'each input needs a valid lowercase name')
        );
      ELSIF v_input->>'name' = ANY(v_names) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', 'inputs', 'message', 'input name is duplicated: ' || v_input->>'name')
        );
      ELSE
        v_names := array_append(v_names, v_input->>'name');
      END IF;
    END LOOP;
  END IF;

  -- transform
  IF jsonb_typeof(p_config->'transform') IS DISTINCT FROM 'object' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'transform', 'message', 'transform must be an object')
    );
  ELSE
    IF p_config->'transform'->>'language' IS DISTINCT FROM 'sql' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unsupported_language', 'field', 'transform.language', 'message', 'transform language must be sql')
      );
    END IF;
    IF jsonb_typeof(p_config->'transform'->'statement') IS DISTINCT FROM 'string'
       OR length(btrim(p_config->'transform'->>'statement')) NOT BETWEEN 1 AND 20000 THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', 'transform.statement', 'message', 'transform statement must be between 1 and 20000 characters')
      );
    END IF;
  END IF;

  -- output
  IF jsonb_typeof(p_config->'output') IS DISTINCT FROM 'object' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'output', 'message', 'output must be an object')
    );
  ELSE
    IF p_config->'output'->>'mode' NOT IN ('create', 'append') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', 'output.mode', 'message', 'output mode must be create or append')
      );
    END IF;
    IF p_config->'output'->>'mode' = 'create' THEN
      BEGIN
        PERFORM (p_config->'output'->>'schemaVersionId')::uuid;
        IF p_config->'output'->>'schemaVersionId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.schemaVersionId', 'message', 'create output requires a valid Dataset Schema Version id')
        );
      END;
      IF jsonb_typeof(p_config->'output'->'datasetName') IS DISTINCT FROM 'string'
         OR length(btrim(p_config->'output'->>'datasetName')) NOT BETWEEN 1 AND 200 THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetName', 'message', 'create output requires a dataset name')
        );
      END IF;
    END IF;
    IF p_config->'output'->>'mode' = 'append' THEN
      BEGIN
        PERFORM (p_config->'output'->>'datasetId')::uuid;
        IF p_config->'output'->>'datasetId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetId', 'message', 'append output requires a valid Dataset id')
        );
      END;
    END IF;
    IF jsonb_typeof(p_config->'output'->'datasetLabel') IS DISTINCT FROM 'string'
       OR length(btrim(p_config->'output'->>'datasetLabel')) NOT BETWEEN 1 AND 200 THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetLabel', 'message', 'output requires a Dataset Version label')
      );
    END IF;
    IF jsonb_typeof(p_config->'output'->'fieldMapping') NOT IN ('object', 'null') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', 'output.fieldMapping', 'message', 'fieldMapping must be an object or null')
      );
    END IF;
  END IF;

  RETURN v_errors;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) TO authenticated;

--> statement-breakpoint

-- Validate a run request against a version's configuration: parameters must
-- match the declared parameter set and types, and input_versions must name
-- exactly the declared inputs (required or not) with valid Dataset Version
-- ids. Returns an errors array (empty = valid).
CREATE OR REPLACE FUNCTION api.pipeline_run_request_errors(
  p_configuration jsonb,
  p_parameters jsonb,
  p_input_versions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_param jsonb;
  v_input jsonb;
  v_key text;
  v_value jsonb;
  v_declared text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
BEGIN
  IF p_parameters IS NULL OR jsonb_typeof(p_parameters) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'invalid_parameters', 'field', 'parameters', 'message', 'parameters must be an object'));
  END IF;
  IF p_input_versions IS NULL OR jsonb_typeof(p_input_versions) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'invalid_inputs', 'field', 'input_versions', 'message', 'input_versions must be an object'));
  END IF;

  -- every supplied parameter must be declared and type-match
  FOR v_key, v_value IN SELECT entry.key, entry.value FROM jsonb_each(p_parameters) entry LOOP
    v_present := array_append(v_present, v_key);
    SELECT value INTO v_param FROM jsonb_array_elements(p_configuration->'parameters') value
      WHERE value->>'name' = v_key LIMIT 1;
    IF v_param IS NULL THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unknown_parameter', 'field', 'parameters', 'message', 'unknown parameter: ' || v_key)
      );
    ELSIF NOT (
      (v_param->>'type' = 'text' AND jsonb_typeof(v_value) = 'string')
      OR (v_param->>'type' = 'integer' AND jsonb_typeof(v_value) = 'number'
          AND v_value #>> '{}' ~ '^-?[0-9]+$')
      OR (v_param->>'type' = 'decimal' AND jsonb_typeof(v_value) = 'number')
      OR (v_param->>'type' = 'boolean' AND jsonb_typeof(v_value) = 'boolean')
      OR (v_param->>'type' = 'date' AND jsonb_typeof(v_value) = 'string'
          AND v_value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      OR (v_param->>'type' = 'timestamp' AND jsonb_typeof(v_value) = 'string')
    ) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_parameter_type', 'field', 'parameters', 'message', 'parameter ' || v_key || ' does not match its declared type')
      );
    END IF;
  END LOOP;

  -- every required parameter must be supplied
  FOR v_param IN SELECT value FROM jsonb_array_elements(p_configuration->'parameters') LOOP
    IF coalesce((v_param->>'required')::boolean, false)
       AND NOT (v_param->>'name' = ANY(v_present)) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'missing_parameter', 'field', 'parameters', 'message', 'missing required parameter: ' || v_param->>'name')
      );
    END IF;
  END LOOP;

  -- input_versions must name exactly the declared inputs with valid ids
  v_declared := '{}'::text[];
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_configuration->'inputs') LOOP
    v_declared := array_append(v_declared, v_input->>'name');
  END LOOP;
  FOR v_key, v_value IN SELECT entry.key, entry.value FROM jsonb_each(p_input_versions) entry LOOP
    IF NOT (v_key = ANY(v_declared)) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unknown_input', 'field', 'input_versions', 'message', 'unknown input: ' || v_key)
      );
    ELSIF jsonb_typeof(v_value) <> 'string' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_input_version', 'field', 'input_versions', 'message', 'input ' || v_key || ' must be a Dataset Version id')
      );
    ELSE
      BEGIN
        PERFORM (v_value #>> '{}')::uuid;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_input_version', 'field', 'input_versions', 'message', 'input ' || v_key || ' must be a Dataset Version id')
        );
      END;
    END IF;
  END LOOP;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_configuration->'inputs') LOOP
    IF NOT (SELECT EXISTS (SELECT 1 FROM jsonb_each(p_input_versions) entry WHERE entry.key = v_input->>'name')) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'missing_input', 'field', 'input_versions', 'message', 'missing input: ' || v_input->>'name')
      );
    END IF;
  END LOOP;

  RETURN v_errors;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_run_request_errors(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_run_request_errors(jsonb, jsonb, jsonb) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Definition and Version lifecycle RPCs (pipelines.manage).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.create_pipeline_definition(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_description text DEFAULT NULL
)
RETURNS api.pipeline_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' THEN
    RAISE EXCEPTION 'invalid pipeline key' USING ERRCODE = 'SB034';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid pipeline name' USING ERRCODE = 'SB034';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'invalid pipeline description' USING ERRCODE = 'SB034';
  END IF;
  INSERT INTO api.pipeline_definitions(
    workspace_id, key, name, description, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name),
    nullif(btrim(COALESCE(p_description, '')), ''),
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_pipeline_definition(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_pipeline_definition(uuid, text, text, text) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_pipeline_definition(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_lifecycle text DEFAULT NULL
)
RETURNS api.pipeline_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid pipeline name' USING ERRCODE = 'SB034';
  END IF;
  IF p_lifecycle IS NOT NULL AND p_lifecycle NOT IN ('active', 'retired') THEN
    RAISE EXCEPTION 'invalid pipeline lifecycle' USING ERRCODE = 'SB034';
  END IF;
  IF p_description IS NOT NULL AND length(p_description) > 2000 THEN
    RAISE EXCEPTION 'invalid pipeline description' USING ERRCODE = 'SB034';
  END IF;
  UPDATE api.pipeline_definitions SET
    name = COALESCE(NULLIF(btrim(p_name), ''), name),
    description = CASE WHEN p_description IS NULL THEN description ELSE nullif(btrim(p_description), '') END,
    lifecycle = COALESCE(p_lifecycle, lifecycle),
    revision = revision + 1,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_definition_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_pipeline_definition(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_pipeline_definition(uuid, uuid, text, text, text) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_pipeline_definition_version(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_configuration jsonb
)
RETURNS api.pipeline_definition_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_definition api.pipeline_definitions;
  v_result api.pipeline_definition_versions;
  v_next integer;
  v_errors jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_definition.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'retired Pipeline Definition cannot be configured' USING ERRCODE = 'SB072';
  END IF;
  v_errors := api.pipeline_config_errors(p_configuration);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}')
      USING ERRCODE = 'SB070';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO v_next
    FROM api.pipeline_definition_versions WHERE definition_id = v_definition.id;
  INSERT INTO api.pipeline_definition_versions(
    definition_id, workspace_id, version, configuration,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    v_definition.id, v_definition.workspace_id, v_next, p_configuration,
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v_result;
  UPDATE api.pipeline_definitions SET
    revision = revision + 1, updated_at = now(), updated_by_user_id = api.current_user_id()
  WHERE id = v_definition.id;
  RETURN v_result;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_pipeline_definition_version(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_pipeline_definition_version(uuid, uuid, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.publish_pipeline_definition_version(
  p_workspace_id uuid,
  p_version_id uuid
)
RETURNS api.pipeline_definition_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version api.pipeline_definition_versions;
  v_definition api.pipeline_definitions;
  v_errors jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = v_version.definition_id FOR UPDATE;
  IF v_definition.lifecycle <> 'active' OR v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only active Definition drafts may be published' USING ERRCODE = 'SB072';
  END IF;
  v_errors := api.pipeline_config_errors(v_version.configuration);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}')
      USING ERRCODE = 'SB070';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    lifecycle = 'published',
    revision = revision + 1,
    published_at = now(),
    published_by_user_id = api.current_user_id(),
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.publish_pipeline_definition_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.publish_pipeline_definition_version(uuid, uuid) TO authenticated;

--> statement-breakpoint

-- Edit a draft version in place (append-only versioning for published
-- evidence; the draft is the working copy, exactly like Sheet Definition
-- drafts). The configuration is re-validated before the revision bump.
CREATE OR REPLACE FUNCTION api.update_pipeline_definition_version_draft(
  p_workspace_id uuid,
  p_version_id uuid,
  p_expected_revision bigint,
  p_configuration jsonb
)
RETURNS api.pipeline_definition_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version api.pipeline_definition_versions;
  v_errors jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Pipeline versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF v_version.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Pipeline version revision' USING ERRCODE = 'SB001';
  END IF;
  v_errors := api.pipeline_config_errors(p_configuration);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}')
      USING ERRCODE = 'SB070';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    configuration = p_configuration,
    revision = revision + 1,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_pipeline_definition_version_draft(uuid, uuid, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_pipeline_definition_version_draft(uuid, uuid, bigint, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.retire_pipeline_definition_version(
  p_workspace_id uuid,
  p_version_id uuid
)
RETURNS api.pipeline_definition_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_version api.pipeline_definition_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'pipeline definition version is already retired' USING ERRCODE = 'SB072';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    lifecycle = 'retired',
    revision = revision + 1,
    retired_at = now(),
    retired_by_user_id = api.current_user_id(),
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.retire_pipeline_definition_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.retire_pipeline_definition_version(uuid, uuid) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Run lifecycle RPCs.
--
-- start_pipeline_run mirrors start_connector_run: digest idempotency receipt
-- (succeeded replays, running conflicts, failed requires an explicit retry),
-- attempt lineage via retry_of_run_id, and PLAT-02-style stale reconciliation
-- of abandoned running attempts after a fixed database threshold.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.start_pipeline_run(
  p_workspace_id uuid,
  p_definition_version_id uuid,
  p_trigger_kind text DEFAULT 'manual',
  p_parameters jsonb DEFAULT '{}'::jsonb,
  p_input_versions jsonb DEFAULT '{}'::jsonb,
  p_input_digest text DEFAULT NULL,
  p_retry_of_run_id uuid DEFAULT NULL
)
RETURNS api.pipeline_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stale_threshold_seconds CONSTANT integer := 900;
  v_version api.pipeline_definition_versions;
  v_definition api.pipeline_definitions;
  v_retry_of api.pipeline_runs;
  v_existing api.pipeline_runs;
  v_errors jsonb;
  v api.pipeline_runs;
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
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_definition_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'only published Pipeline versions can be run' USING ERRCODE = 'SB072';
  END IF;
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = v_version.definition_id;
  IF v_definition.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'retired Pipeline cannot be run' USING ERRCODE = 'SB072';
  END IF;
  v_errors := api.pipeline_run_request_errors(
    v_version.configuration, p_parameters, p_input_versions
  );
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline run request: %', (v_errors #>> '{}')
      USING ERRCODE = 'SB070';
  END IF;

  IF p_input_digest IS NOT NULL THEN
    IF length(btrim(p_input_digest)) NOT BETWEEN 16 AND 128 THEN
      RAISE EXCEPTION 'invalid input digest' USING ERRCODE = 'SB034';
    END IF;
    SELECT * INTO v_existing FROM api.pipeline_runs
     WHERE definition_version_id = p_definition_version_id
       AND input_digest = btrim(p_input_digest)
       AND workspace_id = p_workspace_id
     ORDER BY started_at DESC
     LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.status = 'running' THEN
        IF v_existing.started_at < clock_timestamp() - make_interval(secs => v_stale_threshold_seconds) THEN
          -- Log the reconciliation while the run is still 'running', then
          -- fail it (append_pipeline_run_log only accepts running runs).
          PERFORM api.append_pipeline_run_log(
            p_workspace_id, v_existing.id, 'warning', 'reconcile',
            'Stale running attempt reconciled by a newer start.',
            '{"reason": "stale_run_reconciled"}'::jsonb
          );
          UPDATE api.pipeline_runs SET
            status = 'failed',
            error_code = 'stale_run_reconciled',
            error_message = 'run exceeded the staleness threshold and was reconciled',
            finished_at = clock_timestamp()
          WHERE id = v_existing.id;
          v_retry_of := v_existing;
        ELSE
          RAISE EXCEPTION 'run already in progress' USING ERRCODE = 'SB044';
        END IF;
      END IF;
      IF v_existing.status = 'succeeded' THEN
        RETURN v_existing;
      END IF;
      IF v_retry_of.id IS NULL
        AND (p_retry_of_run_id IS NULL OR p_retry_of_run_id <> v_existing.id) THEN
        RAISE EXCEPTION 'inputs previously failed; retry with retry_of_run_id'
          USING ERRCODE = 'SB045';
      END IF;
    END IF;
  END IF;

  IF p_retry_of_run_id IS NOT NULL THEN
    IF v_retry_of.id IS DISTINCT FROM p_retry_of_run_id THEN
      SELECT * INTO v_retry_of FROM api.pipeline_runs
       WHERE id = p_retry_of_run_id AND workspace_id = p_workspace_id;
      IF v_retry_of IS NULL THEN
        RAISE EXCEPTION 'retry target not found' USING ERRCODE = 'SB036';
      END IF;
    END IF;
  END IF;

  INSERT INTO api.pipeline_runs(
    workspace_id, definition_version_id, trigger_kind, status, attempt,
    retry_of_run_id, input_digest, parameters, input_versions,
    actor_user_id, actor_credential_id
  ) VALUES (
    p_workspace_id, p_definition_version_id, p_trigger_kind, 'running',
    CASE WHEN v_retry_of.id IS NOT NULL THEN v_retry_of.attempt + 1 ELSE 1 END,
    COALESCE(v_retry_of.id, p_retry_of_run_id),
    CASE WHEN p_input_digest IS NULL THEN NULL ELSE btrim(p_input_digest) END,
    COALESCE(p_parameters, '{}'::jsonb),
    COALESCE(p_input_versions, '{}'::jsonb),
    api.current_user_id(), api.current_credential_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.start_pipeline_run(uuid, uuid, text, jsonb, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.start_pipeline_run(uuid, uuid, text, jsonb, jsonb, text, uuid) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.complete_pipeline_run(
  p_workspace_id uuid,
  p_run_id uuid,
  p_result jsonb DEFAULT '{}'::jsonb
)
RETURNS api.pipeline_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run already finished' USING ERRCODE = 'SB042';
  END IF;
  -- Evidence integrity: only the actor who started the run may mark it
  -- succeeded. Other writers can never forge a success result.
  IF api.current_user_id() IS DISTINCT FROM v.actor_user_id THEN
    RAISE EXCEPTION 'only the run actor may complete a Pipeline run' USING ERRCODE = '42501';
  END IF;
  UPDATE api.pipeline_runs SET
    status = 'succeeded', finished_at = now(), result = COALESCE(p_result, '{}'::jsonb)
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.complete_pipeline_run(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.complete_pipeline_run(uuid, uuid, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.fail_pipeline_run(
  p_workspace_id uuid,
  p_run_id uuid,
  p_error_code text,
  p_error_message text DEFAULT NULL
)
RETURNS api.pipeline_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_runs;
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
  SELECT * INTO v FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run already finished' USING ERRCODE = 'SB042';
  END IF;
  -- Evidence integrity: only the run actor may fail their own run.
  IF api.current_user_id() IS DISTINCT FROM v.actor_user_id THEN
    RAISE EXCEPTION 'only the run actor may fail a Pipeline run' USING ERRCODE = '42501';
  END IF;
  UPDATE api.pipeline_runs SET
    status = 'failed', finished_at = now(),
    error_code = btrim(p_error_code), error_message = p_error_message
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.fail_pipeline_run(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.fail_pipeline_run(uuid, uuid, text, text) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.cancel_pipeline_run(
  p_workspace_id uuid,
  p_run_id uuid
)
RETURNS api.pipeline_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run is not running' USING ERRCODE = 'SB042';
  END IF;
  -- The run actor (or a steward) may cancel; other writers cannot.
  IF api.current_user_id() IS DISTINCT FROM v.actor_user_id
     AND NOT api.has_capability(p_workspace_id, 'pipelines.manage') THEN
    RAISE EXCEPTION 'only the run actor or a Pipeline manager may cancel a run' USING ERRCODE = '42501';
  END IF;
  -- Record the cancellation reason while the run is still 'running'
  -- (append_pipeline_run_log only accepts running runs).
  PERFORM api.append_pipeline_run_log(
    p_workspace_id, v.id, 'warning', 'cancel',
    'Run cancelled by a workspace writer.', '{}'::jsonb
  );
  UPDATE api.pipeline_runs SET
    status = 'cancelled', finished_at = now(),
    error_code = 'cancelled', error_message = 'run cancelled by user'
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.cancel_pipeline_run(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.cancel_pipeline_run(uuid, uuid) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.append_pipeline_run_log(
  p_workspace_id uuid,
  p_run_id uuid,
  p_level text,
  p_stage text,
  p_message text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS api.pipeline_run_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_run_logs;
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
  IF NOT EXISTS(SELECT 1 FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF (SELECT status FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) <> 'running' THEN
    RAISE EXCEPTION 'logs can only be appended to a running run' USING ERRCODE = 'SB042';
  END IF;
  -- Evidence integrity: only the run actor (or a Pipeline manager) may write
  -- to a run's log; other writers cannot inject misleading stage entries.
  IF api.current_user_id() IS DISTINCT FROM (
    SELECT actor_user_id FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id
  ) AND NOT api.has_capability(p_workspace_id, 'pipelines.manage') THEN
    RAISE EXCEPTION 'only the run actor or a Pipeline manager may write run logs' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.pipeline_run_logs(workspace_id, run_id, sequence, level, stage, message, detail)
  VALUES (
    p_workspace_id, p_run_id,
    (SELECT COALESCE(max(sequence), 0) + 1 FROM api.pipeline_run_logs WHERE run_id = p_run_id),
    p_level, btrim(p_stage), btrim(p_message), COALESCE(p_detail, '{}'::jsonb)
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.append_pipeline_run_log(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.append_pipeline_run_log(uuid, uuid, text, text, text, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.record_pipeline_run_output(
  p_workspace_id uuid,
  p_run_id uuid,
  p_dataset_id uuid,
  p_dataset_version_id uuid,
  p_label text
)
RETURNS api.pipeline_run_outputs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_run_outputs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid output label' USING ERRCODE = 'SB034';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF api.current_user_id() IS DISTINCT FROM (
    SELECT actor_user_id FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'only the run actor may record Pipeline outputs' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.datasets WHERE id = p_dataset_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'output dataset not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.dataset_versions WHERE id = p_dataset_version_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'output dataset version not found' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.pipeline_run_outputs(
    workspace_id, run_id, dataset_id, dataset_version_id, label
  ) VALUES (
    p_workspace_id, p_run_id, p_dataset_id, p_dataset_version_id, btrim(p_label)
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.record_pipeline_run_output(uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.record_pipeline_run_output(uuid, uuid, uuid, uuid, text) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Schedule RPCs (pipelines.manage).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.pipeline_schedule_next_run(p_kind text, p_spec jsonb, p_from timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at timestamptz;
BEGIN
  IF p_kind = 'interval' THEN
    IF jsonb_typeof(p_spec->'intervalMinutes') <> 'number'
       OR (p_spec->>'intervalMinutes') !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'invalid interval schedule' USING ERRCODE = 'SB034';
    END IF;
    RETURN p_from + make_interval(mins => (p_spec->>'intervalMinutes')::int);
  ELSIF p_kind = 'daily' THEN
    IF jsonb_typeof(p_spec->'dailyAt') <> 'string'
       OR p_spec->>'dailyAt' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'invalid daily schedule' USING ERRCODE = 'SB034';
    END IF;
    v_at := date_trunc('day', p_from) + (p_spec->>'dailyAt')::time;
    IF v_at <= p_from THEN
      v_at := v_at + interval '1 day';
    END IF;
    RETURN v_at;
  ELSIF p_kind = 'event' THEN
    -- Event schedules are evaluated by the server sweep, not wall-clock.
    RETURN NULL;
  ELSE
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_schedule_next_run(text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_schedule_next_run(text, jsonb, timestamptz) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_pipeline_schedule(
  p_workspace_id uuid,
  p_definition_id uuid,
  p_kind text,
  p_spec jsonb,
  p_enabled boolean DEFAULT true
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_definition api.pipeline_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE id = p_definition_id AND workspace_id = p_workspace_id;
  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'pipeline definition not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_kind NOT IN ('interval', 'daily', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  IF p_kind = 'event' THEN
    IF p_spec->>'eventType' IS DISTINCT FROM 'dataset_version_created' THEN
      RAISE EXCEPTION 'unsupported event trigger' USING ERRCODE = 'SB034';
    END IF;
    IF p_spec ? 'datasetId' AND jsonb_typeof(p_spec->'datasetId') <> 'string' THEN
      RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
    ELSIF jsonb_typeof(p_spec->'datasetId') = 'string' THEN
      BEGIN
        PERFORM (p_spec->>'datasetId')::uuid;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'invalid event dataset filter' USING ERRCODE = 'SB034';
      END;
    END IF;
  ELSE
    PERFORM api.pipeline_schedule_next_run(p_kind, p_spec, now());
  END IF;
  INSERT INTO api.pipeline_schedules(
    workspace_id, definition_id, kind, spec, enabled, next_run_at, created_by_user_id
  ) VALUES (
    p_workspace_id, p_definition_id, p_kind, p_spec, p_enabled,
    CASE WHEN p_kind = 'event' THEN NULL ELSE api.pipeline_schedule_next_run(p_kind, p_spec, now()) END,
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.create_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_pipeline_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid,
  p_kind text DEFAULT NULL,
  p_spec jsonb DEFAULT NULL,
  p_enabled boolean DEFAULT NULL
)
RETURNS api.pipeline_schedules
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
  v_kind text;
  v_spec jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_schedules
   WHERE id = p_schedule_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline schedule not found' USING ERRCODE = 'SB036';
  END IF;
  v_kind := COALESCE(p_kind, v.kind);
  v_spec := COALESCE(p_spec, v.spec);
  IF v_kind NOT IN ('interval', 'daily', 'event') THEN
    RAISE EXCEPTION 'invalid schedule kind' USING ERRCODE = 'SB034';
  END IF;
  IF v_kind = 'event' THEN
    IF v_spec->>'eventType' IS DISTINCT FROM 'dataset_version_created' THEN
      RAISE EXCEPTION 'unsupported event trigger' USING ERRCODE = 'SB034';
    END IF;
  ELSE
    PERFORM api.pipeline_schedule_next_run(v_kind, v_spec, now());
  END IF;
  UPDATE api.pipeline_schedules SET
    kind = v_kind,
    spec = v_spec,
    enabled = COALESCE(p_enabled, enabled),
    next_run_at = CASE WHEN v_kind = 'event' THEN NULL ELSE api.pipeline_schedule_next_run(v_kind, v_spec, now()) END,
    updated_at = now()
  WHERE id = p_schedule_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.update_pipeline_schedule(uuid, uuid, text, jsonb, boolean) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.delete_pipeline_schedule(
  p_workspace_id uuid,
  p_schedule_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_schedules;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v FROM api.pipeline_schedules
   WHERE id = p_schedule_id AND workspace_id = p_workspace_id;
  IF v IS NULL THEN
    RAISE EXCEPTION 'pipeline schedule not found' USING ERRCODE = 'SB036';
  END IF;
  DELETE FROM api.pipeline_schedules WHERE id = p_schedule_id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.delete_pipeline_schedule(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.delete_pipeline_schedule(uuid, uuid) TO authenticated;

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants + RLS. Pipeline tables are READ-ONLY for request roles; every
-- mutation goes through the SECURITY DEFINER RPCs above. Fail closed for the
-- external api_client credential surface — Pipelines are not part of the
-- external API contract.
-- ---------------------------------------------------------------------------
GRANT SELECT ON api.pipeline_definitions,
  api.pipeline_definition_versions,
  api.pipeline_runs,
  api.pipeline_run_logs,
  api.pipeline_run_outputs,
  api.pipeline_schedules TO authenticated;
--> statement-breakpoint
ALTER TABLE api.pipeline_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.pipeline_definition_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.pipeline_run_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.pipeline_run_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.pipeline_schedules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_definitions_select ON api.pipeline_definitions FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY pipeline_definition_versions_select ON api.pipeline_definition_versions FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY pipeline_runs_select ON api.pipeline_runs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY pipeline_run_logs_select ON api.pipeline_run_logs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY pipeline_run_outputs_select ON api.pipeline_run_outputs FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
CREATE POLICY pipeline_schedules_select ON api.pipeline_schedules FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));

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
    'connector', 'connector_run',
    'pipeline_definition', 'pipeline_definition_version', 'pipeline_run',
    'pipeline_schedule'
  ));
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_definitions AFTER INSERT OR UPDATE OR DELETE ON api.pipeline_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('pipeline_definition');
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_definition_versions AFTER INSERT OR UPDATE OR DELETE ON api.pipeline_definition_versions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('pipeline_definition_version');
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_runs AFTER INSERT OR UPDATE OR DELETE ON api.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('pipeline_run');
--> statement-breakpoint
CREATE TRIGGER change_event_pipeline_schedules AFTER INSERT OR UPDATE OR DELETE ON api.pipeline_schedules
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_connector('pipeline_schedule');

--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Immutable history: completed runs and their logs/outputs are evidence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.prevent_pipeline_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IN ('succeeded', 'failed', 'cancelled')
     AND OLD.status = NEW.status THEN
    RAISE EXCEPTION 'Pipeline run evidence is immutable' USING ERRCODE = 'SB073';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_pipeline_run_evidence_mutation
  BEFORE UPDATE ON api.pipeline_runs
  FOR EACH ROW EXECUTE FUNCTION internal.prevent_pipeline_evidence_mutation();
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
