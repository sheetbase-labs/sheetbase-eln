-- Provenance: open lineage events, reproducible pipeline runs and a replayable
-- event stream.
--
-- 1. Lineage targets: a workspace can name an OpenLineage endpoint (Marquez,
--    DataHub, OpenMetadata ...). Nothing is sent until an admin adds one and
--    switches it on. Each run, import, instrument run, plate run and worklist
--    becomes a RunEvent in the outbox (lineage_deliveries) and is delivered
--    with retries.
-- 2. Reproductions: re-running a finished pipeline run with the exact version,
--    parameters and inputs it used, into a scratch result, and keeping the
--    verdict (matches / differs) with a summary of what changed.
-- 3. Event stream: a cursor-paged, permission-filtered read of the workspace's
--    append-only change log (api.change_events already carries a monotonic
--    per-workspace sequence), plus a retention window the workspace chooses.

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
  IF position('''pipeline_reproduction''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''pipeline_reproduction''::text]');
  END IF;
  IF position('''lineage_target''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''lineage_target''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('pipeline.run.reproduced'), ('lineage.endpoint.created'), ('lineage.endpoint.updated'), ('lineage.delivery_failed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- How long the event stream serves history. Events are never deleted (the
-- change log is the audit trail); this only bounds how far back a consumer can
-- start from.
ALTER TABLE api.workspace_settings
  ADD COLUMN event_stream_retention_days integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE api.workspace_settings
  ADD CONSTRAINT chk_workspace_settings_event_stream_retention
  CHECK (event_stream_retention_days BETWEEN 1 AND 3650);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reproductions
-- ---------------------------------------------------------------------------

CREATE TABLE api.pipeline_reproductions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    source_run_id uuid NOT NULL,
    definition_version_id uuid NOT NULL,
    status text NOT NULL,
    tolerance numeric DEFAULT 0.000000001 NOT NULL,
    compared text,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    changes jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_code text,
    error_message text,
    duration_ms integer,
    requested_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pipeline_reproductions_pkey PRIMARY KEY (id),
    CONSTRAINT pipeline_reproductions_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT pipeline_reproductions_run_fkey FOREIGN KEY (workspace_id, source_run_id) REFERENCES api.pipeline_runs(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT pipeline_reproductions_user_fkey FOREIGN KEY (requested_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_pipeline_reproductions_status CHECK (status IN ('matches', 'differs', 'failed')),
    CONSTRAINT chk_pipeline_reproductions_compared CHECK (compared IS NULL OR compared IN ('dataset_version', 'preview', 'digest')),
    CONSTRAINT chk_pipeline_reproductions_tolerance CHECK (tolerance >= 0),
    CONSTRAINT chk_pipeline_reproductions_summary CHECK (jsonb_typeof(summary) = 'object'),
    CONSTRAINT chk_pipeline_reproductions_changes CHECK (jsonb_typeof(changes) = 'array')
);
--> statement-breakpoint
ALTER TABLE api.pipeline_reproductions OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_pipeline_reproductions_run ON api.pipeline_reproductions (source_run_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_pipeline_reproductions_workspace ON api.pipeline_reproductions (workspace_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.pipeline_reproductions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_reproductions_select ON api.pipeline_reproductions FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY pipeline_reproductions_client_select ON api.pipeline_reproductions FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_reproductions TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_reproductions TO api_client;
--> statement-breakpoint

CREATE FUNCTION internal.refuse_pipeline_reproduction_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'reproductions cannot be changed or deleted' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refuse_pipeline_reproduction_mutation() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER refuse_pipeline_reproduction_mutation BEFORE UPDATE ON api.pipeline_reproductions
    FOR EACH ROW EXECUTE FUNCTION internal.refuse_pipeline_reproduction_mutation();
--> statement-breakpoint

-- Keep the verdict of one reproduction. Called by the server after the scratch
-- re-run, as the person who asked for it.
CREATE FUNCTION api.record_pipeline_reproduction(
    p_run_id uuid, p_status text, p_tolerance numeric DEFAULT 0.000000001,
    p_compared text DEFAULT NULL, p_summary jsonb DEFAULT '{}'::jsonb,
    p_changes jsonb DEFAULT '[]'::jsonb, p_error_code text DEFAULT NULL,
    p_error_message text DEFAULT NULL, p_duration_ms integer DEFAULT NULL)
    RETURNS api.pipeline_reproductions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.pipeline_runs;
  v_definition_id uuid;
  v_row api.pipeline_reproductions;
BEGIN
  SELECT * INTO v_run FROM api.pipeline_runs WHERE id = p_run_id;
  IF v_run.id IS NULL OR api.current_user_id() IS NULL
     OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_status NOT IN ('matches', 'differs', 'failed') THEN
    RAISE EXCEPTION 'unknown reproduction status' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.pipeline_reproductions (
    workspace_id, source_run_id, definition_version_id, status, tolerance, compared,
    summary, changes, error_code, error_message, duration_ms, requested_by_user_id)
  VALUES (
    v_run.workspace_id, v_run.id, v_run.definition_version_id, p_status,
    coalesce(p_tolerance, 0.000000001), p_compared,
    coalesce(p_summary, '{}'::jsonb), coalesce(p_changes, '[]'::jsonb),
    left(p_error_code, 100), left(p_error_message, 1000), p_duration_ms, api.current_user_id())
  RETURNING * INTO v_row;
  SELECT definition_id INTO v_definition_id
    FROM api.pipeline_definition_versions WHERE id = v_run.definition_version_id;
  PERFORM internal.emit_change_event(
    v_run.workspace_id, 'pipeline_reproduction', v_row.id, 'create', NULL, NULL,
    jsonb_build_object('action', 'reproduced', 'runId', v_run.id,
                       'definitionId', v_definition_id, 'status', p_status));
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_pipeline_reproduction(uuid, text, numeric, text, jsonb, jsonb, text, text, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_pipeline_reproduction(uuid, text, numeric, text, jsonb, jsonb, text, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_pipeline_reproduction(uuid, text, numeric, text, jsonb, jsonb, text, text, integer) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lineage targets and the outbox
-- ---------------------------------------------------------------------------

CREATE TABLE api.lineage_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    endpoint_url text NOT NULL,
    namespace text DEFAULT 'sheetbase' NOT NULL,
    auth_header_name text DEFAULT 'Authorization' NOT NULL,
    has_secret boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_sequence bigint DEFAULT 0 NOT NULL,
    last_test_at timestamp with time zone,
    last_test_ok boolean,
    last_test_message text,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lineage_targets_pkey PRIMARY KEY (id),
    CONSTRAINT lineage_targets_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT lineage_targets_user_fkey FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT uq_lineage_targets_workspace_name UNIQUE (workspace_id, name),
    CONSTRAINT chk_lineage_targets_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT chk_lineage_targets_url CHECK (endpoint_url ~ '^https?://[^\s]+$' AND length(endpoint_url) <= 500),
    CONSTRAINT chk_lineage_targets_namespace CHECK (namespace ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$'),
    CONSTRAINT chk_lineage_targets_header CHECK (auth_header_name ~ '^[A-Za-z][A-Za-z0-9-]{0,63}$')
);
--> statement-breakpoint
ALTER TABLE api.lineage_targets OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_lineage_targets_workspace ON api.lineage_targets (workspace_id);
--> statement-breakpoint
ALTER TABLE api.lineage_targets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lineage_targets_select ON api.lineage_targets FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'integrations', 'view'));
--> statement-breakpoint
CREATE POLICY lineage_targets_client_select ON api.lineage_targets FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.lineage_targets TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.lineage_targets TO api_client;
--> statement-breakpoint

-- The header value (a token or key) is sealed by the server and never read
-- back through the API.
CREATE TABLE internal.lineage_target_secrets (
    target_id uuid NOT NULL,
    sealed text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lineage_target_secrets_pkey PRIMARY KEY (target_id),
    CONSTRAINT lineage_target_secrets_target_fkey FOREIGN KEY (target_id) REFERENCES api.lineage_targets(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE internal.lineage_target_secrets OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON TABLE internal.lineage_target_secrets FROM PUBLIC;
--> statement-breakpoint

CREATE TABLE api.lineage_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    target_id uuid NOT NULL,
    change_event_id uuid NOT NULL,
    event_type text NOT NULL,
    job_name text NOT NULL,
    run_id uuid NOT NULL,
    body jsonb NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    last_error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lineage_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT lineage_deliveries_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT lineage_deliveries_target_fkey FOREIGN KEY (target_id) REFERENCES api.lineage_targets(id) ON DELETE CASCADE,
    CONSTRAINT uq_lineage_deliveries_event UNIQUE (target_id, change_event_id),
    CONSTRAINT chk_lineage_deliveries_type CHECK (event_type IN ('START', 'COMPLETE', 'FAIL', 'ABORT')),
    CONSTRAINT chk_lineage_deliveries_status CHECK (status IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
ALTER TABLE api.lineage_deliveries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_lineage_deliveries_due ON api.lineage_deliveries (next_attempt_at) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX idx_lineage_deliveries_target ON api.lineage_deliveries (target_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.lineage_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lineage_deliveries_select ON api.lineage_deliveries FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'integrations', 'view'));
--> statement-breakpoint
CREATE POLICY lineage_deliveries_client_select ON api.lineage_deliveries FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.lineage_deliveries TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.lineage_deliveries TO api_client;
--> statement-breakpoint

-- Add or change a target. New targets start at the newest event, so switching
-- one on never replays history; it starts off.
CREATE FUNCTION api.save_lineage_target(
    p_workspace_id uuid, p_id uuid, p_name text, p_endpoint_url text,
    p_namespace text DEFAULT 'sheetbase', p_auth_header_name text DEFAULT 'Authorization',
    p_enabled boolean DEFAULT false)
    RETURNS api.lineage_targets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.lineage_targets;
  v_seq bigint;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_endpoint_url !~ '^https?://[^\s]+$' THEN
    RAISE EXCEPTION 'enter the address of your lineage service, starting with http:// or https://'
      USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    SELECT coalesce(max(sequence), 0) INTO v_seq FROM api.change_events WHERE workspace_id = p_workspace_id;
    INSERT INTO api.lineage_targets (
      workspace_id, name, endpoint_url, namespace, auth_header_name, enabled,
      last_sequence, created_by_user_id)
    VALUES (p_workspace_id, btrim(p_name), btrim(p_endpoint_url),
            coalesce(nullif(btrim(p_namespace), ''), 'sheetbase'),
            coalesce(nullif(btrim(p_auth_header_name), ''), 'Authorization'),
            coalesce(p_enabled, false), v_seq, api.current_user_id())
    RETURNING * INTO v_row;
  ELSE
    -- Turning a target back on skips what happened while it was off.
    UPDATE api.lineage_targets t
       SET name = btrim(p_name), endpoint_url = btrim(p_endpoint_url),
           namespace = coalesce(nullif(btrim(p_namespace), ''), 'sheetbase'),
           auth_header_name = coalesce(nullif(btrim(p_auth_header_name), ''), 'Authorization'),
           enabled = coalesce(p_enabled, false),
           last_sequence = CASE WHEN coalesce(p_enabled, false) AND NOT t.enabled
             THEN (SELECT coalesce(max(e.sequence), 0) FROM api.change_events e WHERE e.workspace_id = p_workspace_id)
             ELSE t.last_sequence END,
           updated_at = now()
     WHERE t.id = p_id AND t.workspace_id = p_workspace_id
     RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'lineage target not found' USING ERRCODE = 'SB036';
    END IF;
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'lineage_target', v_row.id, CASE WHEN p_id IS NULL THEN 'create' ELSE 'update' END,
    NULL, NULL, jsonb_build_object('action', 'lineage-target-saved', 'name', v_row.name,
                                   'enabled', v_row.enabled));
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_lineage_target(uuid, uuid, text, text, text, text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_lineage_target(uuid, uuid, text, text, text, text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_lineage_target(uuid, uuid, text, text, text, text, boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_lineage_target(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.lineage_targets;
BEGIN
  SELECT * INTO v_row FROM api.lineage_targets WHERE id = p_id;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  DELETE FROM api.lineage_targets WHERE id = p_id;
  PERFORM internal.emit_change_event(
    v_row.workspace_id, 'lineage_target', v_row.id, 'update', NULL, NULL,
    jsonb_build_object('action', 'lineage-target-removed', 'name', v_row.name, 'enabled', false));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_lineage_target(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_lineage_target(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_lineage_target(uuid) TO authenticated;
--> statement-breakpoint

-- The sealed header value. The server seals it first; this only stores it, for
-- someone who manages integrations.
CREATE FUNCTION api.set_lineage_target_secret(p_id uuid, p_sealed text) RETURNS api.lineage_targets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.lineage_targets;
BEGIN
  SELECT * INTO v_row FROM api.lineage_targets WHERE id = p_id;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_sealed IS NULL OR btrim(p_sealed) = '' THEN
    DELETE FROM internal.lineage_target_secrets WHERE target_id = p_id;
  ELSE
    INSERT INTO internal.lineage_target_secrets (target_id, sealed) VALUES (p_id, p_sealed)
    ON CONFLICT (target_id) DO UPDATE SET sealed = EXCLUDED.sealed, updated_at = now();
  END IF;
  UPDATE api.lineage_targets
     SET has_secret = (p_sealed IS NOT NULL AND btrim(p_sealed) <> ''), updated_at = now()
   WHERE id = p_id
   RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_lineage_target_secret(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_lineage_target_secret(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_lineage_target_secret(uuid, text) TO authenticated;
--> statement-breakpoint

-- Server side: keep the result of a test send beside the target.
CREATE FUNCTION api.record_lineage_test(p_id uuid, p_ok boolean, p_message text) RETURNS api.lineage_targets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.lineage_targets;
BEGIN
  SELECT * INTO v_row FROM api.lineage_targets WHERE id = p_id;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  UPDATE api.lineage_targets
     SET last_test_at = now(), last_test_ok = p_ok, last_test_message = left(p_message, 300)
   WHERE id = p_id
   RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_lineage_test(uuid, boolean, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_lineage_test(uuid, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_lineage_test(uuid, boolean, text) TO authenticated;
--> statement-breakpoint

-- A delivery gave up or got through. A failure waits longer each time and
-- gives up on the eighth try, saying so once in the change log.
CREATE FUNCTION internal.lineage_delivery_succeeded(p_id uuid, p_http_status integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  UPDATE api.lineage_deliveries
     SET status = 'delivered', attempts = attempts + 1, http_status = p_http_status,
         last_error = NULL, delivered_at = now()
   WHERE id = p_id AND status = 'pending'
$$;
--> statement-breakpoint
ALTER FUNCTION internal.lineage_delivery_succeeded(uuid, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lineage_delivery_succeeded(uuid, integer) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.lineage_delivery_failed(p_id uuid, p_error text, p_http_status integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  d api.lineage_deliveries;
  v_sequence bigint;
BEGIN
  UPDATE api.lineage_deliveries
     SET attempts = attempts + 1, last_error = left(p_error, 300), http_status = p_http_status,
         next_attempt_at = now() + (interval '30 seconds' * power(4, least(attempts, 6))),
         status = CASE WHEN attempts + 1 >= 8 THEN 'failed' ELSE 'pending' END
   WHERE id = p_id AND status = 'pending'
   RETURNING * INTO d;
  IF d.id IS NOT NULL AND d.status = 'failed' THEN
    INSERT INTO api.workspace_change_seq(workspace_id, last_seq) VALUES (d.workspace_id, 1)
      ON CONFLICT (workspace_id) DO UPDATE
        SET last_seq = api.workspace_change_seq.last_seq + 1, updated_at = now()
      RETURNING last_seq INTO v_sequence;
    INSERT INTO api.change_events (id, workspace_id, sequence, entity_type, entity_uuid, operation, payload)
      VALUES (gen_random_uuid(), d.workspace_id, v_sequence, 'lineage_target', d.target_id, 'update',
              jsonb_build_object('action', 'lineage-delivery-failed', 'deliveryId', d.id,
                                 'jobName', d.job_name, 'eventType', d.event_type,
                                 'error', left(p_error, 200)));
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lineage_delivery_failed(uuid, text, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lineage_delivery_failed(uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint

-- A failed delivery can be put back in the queue from Settings.
CREATE FUNCTION api.retry_lineage_deliveries(p_target_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.lineage_targets;
  v_count integer;
BEGIN
  SELECT * INTO v_row FROM api.lineage_targets WHERE id = p_target_id;
  IF v_row.id IS NULL OR api.current_user_id() IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(v_row.workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  UPDATE api.lineage_deliveries
     SET status = 'pending', attempts = 0, next_attempt_at = now(), last_error = NULL
   WHERE target_id = p_target_id AND status = 'failed';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.retry_lineage_deliveries(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.retry_lineage_deliveries(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.retry_lineage_deliveries(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Event stream
-- ---------------------------------------------------------------------------

-- A page of the workspace's change log after a cursor (the event's sequence),
-- limited to what the caller may see: the same per-object check the live feed
-- and the audit export use. `nextCursor` moves past events the caller cannot
-- see, so a consumer never stalls on them.
CREATE FUNCTION api.event_stream_page(
    p_after bigint DEFAULT 0, p_limit integer DEFAULT 200, p_entity_types text[] DEFAULT NULL)
    RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_days integer;
  v_cutoff timestamp with time zone;
  v_earliest bigint;
  v_latest bigint;
  v_scan_to bigint;
  v_events jsonb;
  v_count integer;
  v_last bigint;
BEGIN
  IF v_ws IS NULL OR NOT api.is_workspace_member(v_ws) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN
    RAISE EXCEPTION 'limit must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  p_after := greatest(coalesce(p_after, 0), 0);
  SELECT coalesce((SELECT s.event_stream_retention_days FROM api.workspace_settings s
                    WHERE s.workspace_id = v_ws), 30) INTO v_days;
  v_cutoff := now() - make_interval(days => v_days);
  SELECT min(e.sequence), max(e.sequence) INTO v_earliest, v_latest
    FROM api.change_events e WHERE e.workspace_id = v_ws AND e.created_at >= v_cutoff;
  IF v_latest IS NULL THEN
    RETURN jsonb_build_object('events', '[]'::jsonb, 'nextCursor', p_after, 'hasMore', false,
                              'earliest', NULL, 'latest', NULL, 'expired', false,
                              'retentionDays', v_days);
  END IF;
  -- A cursor that points before the retained window cannot be served whole.
  IF p_after > 0 AND p_after < v_earliest - 1 THEN
    RETURN jsonb_build_object('events', '[]'::jsonb, 'nextCursor', p_after, 'hasMore', false,
                              'earliest', v_earliest, 'latest', v_latest, 'expired', true,
                              'retentionDays', v_days);
  END IF;
  -- Look through a bounded range, so a run of events the caller cannot see
  -- does not make one call scan the whole log.
  SELECT max(s.sequence) INTO v_scan_to FROM (
    SELECT e.sequence FROM api.change_events e
     WHERE e.workspace_id = v_ws AND e.sequence > p_after
       AND (p_entity_types IS NULL OR e.entity_type = ANY (p_entity_types))
     ORDER BY e.sequence LIMIT p_limit * 10) s;
  IF v_scan_to IS NULL THEN
    RETURN jsonb_build_object('events', '[]'::jsonb, 'nextCursor', greatest(p_after, v_latest),
                              'hasMore', false, 'earliest', v_earliest, 'latest', v_latest,
                              'expired', false, 'retentionDays', v_days);
  END IF;
  SELECT coalesce(jsonb_agg(row_json ORDER BY seq), '[]'::jsonb), count(*), max(seq)
    INTO v_events, v_count, v_last
  FROM (
    SELECT e.sequence AS seq,
           to_jsonb(e) - 'payload' - 'workspace_id'
             || jsonb_build_object('payload',
                  e.payload - 'token' - 'token_hash' - 'session_secret' - 'sessionSecret'
                            - 'ip_address' - 'ipAddress' - 'sessionId') AS row_json
      FROM api.change_events e
     WHERE e.workspace_id = v_ws AND e.sequence > p_after AND e.sequence <= v_scan_to
       AND (p_entity_types IS NULL OR e.entity_type = ANY (p_entity_types))
       AND internal.can_read_change_event(e)
     ORDER BY e.sequence
     LIMIT p_limit) r;
  RETURN jsonb_build_object(
    'events', v_events,
    'nextCursor', CASE WHEN v_count >= p_limit THEN v_last ELSE v_scan_to END,
    'hasMore', (v_count >= p_limit) OR v_scan_to < v_latest,
    'earliest', v_earliest, 'latest', v_latest, 'expired', false, 'retentionDays', v_days);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.event_stream_page(bigint, integer, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.event_stream_page(bigint, integer, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.event_stream_page(bigint, integer, text[]) TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_event_stream_retention(p_workspace_id uuid, p_days integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage') THEN
    RAISE EXCEPTION 'integration access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 3650 THEN
    RAISE EXCEPTION 'keep the event stream for between 1 and 3650 days' USING ERRCODE = '22023';
  END IF;
  UPDATE api.workspace_settings SET event_stream_retention_days = p_days, updated_at = now()
   WHERE workspace_id = p_workspace_id;
  IF NOT FOUND THEN
    INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, event_stream_retention_days)
    VALUES (p_workspace_id, api.current_user_id(), p_days);
  END IF;
  RETURN p_days;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_event_stream_retention(uuid, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_event_stream_retention(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_event_stream_retention(uuid, integer) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Ask for a reproduction from a pipeline step. The server picks the request up,
-- runs it as the person who asked and records the verdict beside the run.
-- ---------------------------------------------------------------------------

CREATE TABLE api.pipeline_reproduction_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    requested_by_user_id text NOT NULL,
    status text DEFAULT 'pending' NOT NULL,
    reproduction_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handled_at timestamp with time zone,
    CONSTRAINT pipeline_reproduction_requests_pkey PRIMARY KEY (id),
    CONSTRAINT pipeline_reproduction_requests_run_fkey FOREIGN KEY (workspace_id, run_id) REFERENCES api.pipeline_runs(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT pipeline_reproduction_requests_user_fkey FOREIGN KEY (requested_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_pipeline_reproduction_requests_status CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
--> statement-breakpoint
ALTER TABLE api.pipeline_reproduction_requests OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_pipeline_reproduction_requests_pending ON api.pipeline_reproduction_requests (created_at) WHERE status = 'pending';
--> statement-breakpoint
ALTER TABLE api.pipeline_reproduction_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_reproduction_requests_select ON api.pipeline_reproduction_requests FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_reproduction_requests TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.request_pipeline_reproduction(p_run_id uuid) RETURNS api.pipeline_reproduction_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_run api.pipeline_runs;
  v_row api.pipeline_reproduction_requests;
BEGIN
  SELECT * INTO v_run FROM api.pipeline_runs WHERE id = p_run_id;
  IF v_run.id IS NULL OR api.current_user_id() IS NULL
     OR v_run.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(v_run.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer access required' USING ERRCODE = 'SB060';
  END IF;
  IF v_run.status <> 'succeeded' THEN
    RAISE EXCEPTION 'only a run that finished successfully can be reproduced' USING ERRCODE = '22023';
  END IF;
  -- One waiting request per run and person is enough.
  SELECT * INTO v_row FROM api.pipeline_reproduction_requests
   WHERE run_id = p_run_id AND status = 'pending' AND requested_by_user_id = api.current_user_id();
  IF v_row.id IS NOT NULL THEN RETURN v_row; END IF;
  INSERT INTO api.pipeline_reproduction_requests (workspace_id, run_id, requested_by_user_id)
  VALUES (v_run.workspace_id, v_run.id, api.current_user_id())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_pipeline_reproduction(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_pipeline_reproduction(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_pipeline_reproduction(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: close a request once its reproduction is kept or has failed.
CREATE FUNCTION internal.pipeline_reproduction_request_handled(p_id uuid, p_reproduction_id uuid, p_error text) RETURNS void
    LANGUAGE sql SET search_path TO ''
    AS $$
  UPDATE api.pipeline_reproduction_requests
     SET status = CASE WHEN p_error IS NULL THEN 'done' ELSE 'failed' END,
         reproduction_id = p_reproduction_id, error_message = left(p_error, 500), handled_at = now()
   WHERE id = p_id;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_reproduction_request_handled(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- A pipeline can ask for a run to be reproduced. The database's copy of the
-- action catalogue (checked when a pipeline is saved) gains the action.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"request_pipeline_reproduction","rpc":"request_pipeline_reproduction","label":"Reproduce a run","description":"Run a finished pipeline run again from its pinned version, settings and inputs in scratch space and record whether the result matches.","arguments":[{"name":"p_run_id","type":"uuid","required":true,"nullable":false}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
