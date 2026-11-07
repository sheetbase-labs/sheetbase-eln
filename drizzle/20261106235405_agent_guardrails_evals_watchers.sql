-- Agent guardrails, checks (evals) and lab watchers.
--
-- 1. Action permissions: for each action an agent can take in the lab, an
--    admin sets Auto, Ask or Never, for everyone, a role, or one service
--    credential. The default is Ask. Signing, submitting for review, amending,
--    locking and deleting are always Never and cannot be changed. An agent's
--    request is kept as a row a person approves or rejects.
-- 2. Checks: a fixed set of lab tasks run against a fixture workspace, with
--    the score and each failure kept.
-- 3. Watchers: scheduled reviews a lab turns on from a list. Each finding is
--    an Inbox item with a link and, where it makes sense, a suggested action.

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
  IF position('''agent_action_policy''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]',
      '::text, ''agent_action_policy''::text, ''agent_action_request''::text, ''ai_eval_run''::text, ''lab_watcher_finding''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('agent.policy.changed'),
  ('agent.action.requested'),
  ('agent.action.decided'),
  ('agent.action.completed'),
  ('ai.eval.completed'),
  ('watcher.finding.created')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Action permissions
-- ---------------------------------------------------------------------------

-- Actions that are never open to an agent, whatever is set: signing,
-- submitting work for review, amending, locking and deleting.
CREATE FUNCTION internal.agent_action_always_never(p_action_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_action_key ~ '(^|_)(sign|amend|lock|unlock|delete|destroy|purge)(_|$)'
      OR p_action_key ~ '^submit_(experiment|record|review|notebook|for_review)'
      OR p_action_key IN ('submit_for_review', 'decide_review', 'release_sample', 'approve_signature')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_action_always_never(text) OWNER TO migrator;
--> statement-breakpoint
GRANT ALL ON FUNCTION internal.agent_action_always_never(text) TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.agent_action_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    action_key text NOT NULL,
    subject_kind text DEFAULT 'everyone' NOT NULL,
    role text,
    credential_id uuid,
    level text NOT NULL,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_action_policies_pkey PRIMARY KEY (id),
    CONSTRAINT agent_action_policies_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_agent_action_policies_level CHECK (level IN ('auto', 'ask', 'never')),
    CONSTRAINT chk_agent_action_policies_subject CHECK (
      (subject_kind = 'everyone' AND role IS NULL AND credential_id IS NULL)
      OR (subject_kind = 'role' AND role IS NOT NULL AND credential_id IS NULL)
      OR (subject_kind = 'credential' AND credential_id IS NOT NULL AND role IS NULL)),
    CONSTRAINT chk_agent_action_policies_key CHECK (action_key ~ '^[a-z][a-z0-9_.]{1,80}$'),
    CONSTRAINT chk_agent_action_policies_fixed CHECK (NOT internal.agent_action_always_never(action_key))
);
--> statement-breakpoint
ALTER TABLE api.agent_action_policies OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_action_policies_subject ON api.agent_action_policies
  (workspace_id, action_key, subject_kind, coalesce(role, ''), coalesce(credential_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
ALTER TABLE api.agent_action_policies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_action_policies_select ON api.agent_action_policies FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND api.has_settings_access(workspace_id, 'ai', 'view'));
--> statement-breakpoint
CREATE POLICY agent_action_policies_client_select ON api.agent_action_policies FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_action_policies TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.agent_action_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    action_key text NOT NULL,
    arguments jsonb DEFAULT '{}'::jsonb NOT NULL,
    summary text NOT NULL,
    level text NOT NULL,
    status text NOT NULL,
    requested_by_user_id text,
    requested_by_credential_id uuid,
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    decided_by_user_id text,
    decided_at timestamp with time zone,
    decision_reason text,
    executed_at timestamp with time zone,
    result jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_action_requests_pkey PRIMARY KEY (id),
    CONSTRAINT agent_action_requests_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_agent_action_requests_level CHECK (level IN ('auto', 'ask', 'never')),
    CONSTRAINT chk_agent_action_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'succeeded', 'failed', 'refused')),
    CONSTRAINT chk_agent_action_requests_arguments CHECK (jsonb_typeof(arguments) = 'object'),
    CONSTRAINT chk_agent_action_requests_actor CHECK ((requested_by_user_id IS NOT NULL)::int + (requested_by_credential_id IS NOT NULL)::int = 1),
    CONSTRAINT chk_agent_action_requests_key CHECK (action_key ~ '^[a-z][a-z0-9_.]{1,80}$')
);
--> statement-breakpoint
ALTER TABLE api.agent_action_requests OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_agent_action_requests_key ON api.agent_action_requests (workspace_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX idx_agent_action_requests_workspace ON api.agent_action_requests (workspace_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.agent_action_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_action_requests_select ON api.agent_action_requests FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (requested_by_user_id = api.current_user_id()
                OR api.has_settings_access(workspace_id, 'ai', 'view')));
--> statement-breakpoint
CREATE POLICY agent_action_requests_client_select ON api.agent_action_requests FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id()
           AND requested_by_credential_id = api.current_credential_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_action_requests TO authenticated, api_client;
--> statement-breakpoint

-- What level applies to the caller for an action: a credential-specific
-- setting beats a role setting, which beats the setting for everyone; with
-- nothing set the answer is Ask.
CREATE FUNCTION api.resolve_agent_action_level(p_workspace_id uuid, p_action_key text, p_credential_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role text;
  v_credential uuid := coalesce(p_credential_id, api.current_credential_id());
  v_level text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'workspace access required' USING ERRCODE = '42501';
  END IF;
  IF internal.agent_action_always_never(p_action_key) THEN
    RETURN 'never';
  END IF;
  IF v_credential IS NOT NULL THEN
    SELECT p.level INTO v_level FROM api.agent_action_policies p
     WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
       AND p.subject_kind = 'credential' AND p.credential_id = v_credential;
    IF v_level IS NOT NULL THEN RETURN v_level; END IF;
  END IF;
  IF api.current_user_id() IS NOT NULL THEN
    SELECT m.role INTO v_role FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = api.current_user_id()
       AND m.suspended_at IS NULL;
    IF v_role IS NOT NULL THEN
      SELECT p.level INTO v_level FROM api.agent_action_policies p
       WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
         AND p.subject_kind = 'role' AND p.role = v_role;
      IF v_level IS NOT NULL THEN RETURN v_level; END IF;
    END IF;
  END IF;
  SELECT p.level INTO v_level FROM api.agent_action_policies p
   WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
     AND p.subject_kind = 'everyone';
  RETURN coalesce(v_level, 'ask');
END $$;
--> statement-breakpoint
ALTER FUNCTION api.resolve_agent_action_level(uuid, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.resolve_agent_action_level(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.resolve_agent_action_level(uuid, text, uuid) TO authenticated, api_client;
--> statement-breakpoint

-- An admin sets the level for one action. 'default' removes the setting.
CREATE FUNCTION api.set_agent_action_policy(
    p_workspace_id uuid, p_action_key text, p_level text,
    p_subject_kind text DEFAULT 'everyone', p_role text DEFAULT NULL, p_credential_id uuid DEFAULT NULL)
    RETURNS api.agent_action_policies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.agent_action_policies;
  v_credential uuid := p_credential_id;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR api.current_user_id() IS NULL
     OR api.current_credential_id() IS NOT NULL
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'AI settings access required' USING ERRCODE = '42501';
  END IF;
  IF internal.agent_action_always_never(p_action_key) THEN
    RAISE EXCEPTION 'this action is always off for agents and cannot be changed' USING ERRCODE = '22023';
  END IF;
  IF p_level NOT IN ('auto', 'ask', 'never', 'default') THEN
    RAISE EXCEPTION 'level must be auto, ask, never or default' USING ERRCODE = '22023';
  END IF;
  IF p_subject_kind NOT IN ('everyone', 'role', 'credential') THEN
    RAISE EXCEPTION 'subject must be everyone, role or credential' USING ERRCODE = '22023';
  END IF;
  IF p_subject_kind = 'role' AND p_role NOT IN ('owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer', 'viewer') THEN
    RAISE EXCEPTION 'unknown role' USING ERRCODE = '22023';
  END IF;
  IF p_subject_kind = 'credential' THEN
    IF NOT EXISTS (SELECT 1 FROM internal.api_credentials c WHERE c.id = p_credential_id AND c.workspace_id = p_workspace_id AND c.kind = 'service' AND c.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'credential not found' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_subject_kind <> 'role' THEN p_role := NULL; END IF;
  IF p_subject_kind <> 'credential' THEN v_credential := NULL; END IF;

  IF p_level = 'default' OR (p_level = 'ask' AND p_subject_kind = 'everyone') THEN
    DELETE FROM api.agent_action_policies p
     WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
       AND p.subject_kind = p_subject_kind
       AND coalesce(p.role, '') = coalesce(p_role, '')
       AND coalesce(p.credential_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_credential, '00000000-0000-0000-0000-000000000000'::uuid)
    RETURNING * INTO v;
    IF v.id IS NULL THEN
      v.workspace_id := p_workspace_id; v.action_key := p_action_key;
      v.subject_kind := p_subject_kind; v.role := p_role; v.credential_id := v_credential;
    END IF;
    v.level := 'ask';
  ELSE
    INSERT INTO api.agent_action_policies (workspace_id, action_key, subject_kind, role, credential_id, level, updated_by_user_id)
    VALUES (p_workspace_id, p_action_key, p_subject_kind, p_role, v_credential, p_level, api.current_user_id())
    ON CONFLICT (workspace_id, action_key, subject_kind, coalesce(role, ''), coalesce(credential_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET level = excluded.level, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    RETURNING * INTO v;
  END IF;
  PERFORM internal.emit_change_event(p_workspace_id, 'agent_action_policy', coalesce(v.id, gen_random_uuid()), 'update', NULL, NULL,
    jsonb_build_object('actionKey', p_action_key, 'subject', p_subject_kind, 'role', p_role,
                       'credentialId', v_credential, 'level', CASE WHEN p_level = 'default' THEN 'ask' ELSE p_level END));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_agent_action_policy(uuid, text, text, text, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_agent_action_policy(uuid, text, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_agent_action_policy(uuid, text, text, text, text, uuid) TO authenticated;
--> statement-breakpoint

-- An agent asks to take an action. The level decides what happens next:
-- never is refused, ask waits for a person, auto is ready to run now.
CREATE FUNCTION api.request_agent_action(
    p_workspace_id uuid, p_action_key text, p_arguments jsonb, p_summary text,
    p_provenance jsonb, p_idempotency_key text)
    RETURNS api.agent_action_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_level text;
  v_existing api.agent_action_requests;
  v api.agent_action_requests;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace write actor required' USING ERRCODE = '42501';
  END IF;
  IF p_action_key IS NULL OR p_action_key !~ '^[a-z][a-z0-9_.]{1,80}$'
     OR jsonb_typeof(coalesce(p_arguments, '{}'::jsonb)) <> 'object'
     OR length(coalesce(p_arguments, '{}'::jsonb)::text) > 65536
     OR length(btrim(coalesce(p_summary, ''))) NOT BETWEEN 1 AND 500
     OR length(coalesce(p_idempotency_key, '')) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid agent action request' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM api.agent_action_requests r
   WHERE r.workspace_id = p_workspace_id AND r.idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.action_key IS DISTINCT FROM p_action_key OR v_existing.arguments IS DISTINCT FROM coalesce(p_arguments, '{}'::jsonb) THEN
      RAISE EXCEPTION 'idempotency key was used for a different request' USING ERRCODE = '22023';
    END IF;
    RETURN v_existing;
  END IF;
  v_level := api.resolve_agent_action_level(p_workspace_id, p_action_key, NULL);
  INSERT INTO api.agent_action_requests
    (workspace_id, action_key, arguments, summary, level, status,
     requested_by_user_id, requested_by_credential_id, provenance, idempotency_key)
  VALUES
    (p_workspace_id, p_action_key, coalesce(p_arguments, '{}'::jsonb), btrim(p_summary), v_level,
     CASE v_level WHEN 'never' THEN 'refused' WHEN 'auto' THEN 'approved' ELSE 'pending' END,
     api.current_user_id(), api.current_credential_id(), coalesce(p_provenance, '{}'::jsonb), p_idempotency_key)
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'agent_action_request', v.id, 'create', NULL, NULL,
    jsonb_build_object('requestId', v.id, 'actionKey', v.action_key, 'level', v.level, 'status', v.status,
                       'summary', v.summary));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_agent_action(uuid, text, jsonb, text, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_agent_action(uuid, text, jsonb, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_agent_action(uuid, text, jsonb, text, jsonb, text) TO authenticated, api_client;
--> statement-breakpoint

-- A person approves or rejects a waiting request. Credentials cannot.
CREATE FUNCTION api.decide_agent_action(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL)
    RETURNS api.agent_action_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.agent_action_requests;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'a signed-in person must decide' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.agent_action_requests WHERE id = p_request_id FOR UPDATE;
  IF v.id IS NULL OR v.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(v.workspace_id)
     OR NOT (v.requested_by_user_id = api.current_user_id() OR api.has_settings_access(v.workspace_id, 'ai', 'manage')) THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'this request has already been decided' USING ERRCODE = '22023';
  END IF;
  UPDATE api.agent_action_requests
     SET status = CASE p_decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by_user_id = api.current_user_id(), decided_at = now(),
         decision_reason = nullif(btrim(coalesce(p_reason, '')), ''), updated_at = now()
   WHERE id = p_request_id RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'agent_action_request', v.id, 'update', NULL, NULL,
    jsonb_build_object('event', 'decided', 'requestId', v.id, 'actionKey', v.action_key,
                       'decision', p_decision, 'status', v.status));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.decide_agent_action(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.decide_agent_action(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.decide_agent_action(uuid, text, text) TO authenticated;
--> statement-breakpoint

-- Record how an approved request ended. The person who approved it, or the
-- requester when the action was Auto, calls this after running the action.
CREATE FUNCTION api.finish_agent_action(p_request_id uuid, p_ok boolean, p_result jsonb DEFAULT NULL, p_error text DEFAULT NULL)
    RETURNS api.agent_action_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.agent_action_requests;
BEGIN
  SELECT * INTO v FROM api.agent_action_requests WHERE id = p_request_id FOR UPDATE;
  IF v.id IS NULL OR v.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT (
       (v.decided_by_user_id IS NOT NULL AND v.decided_by_user_id = api.current_user_id())
       OR (v.level = 'auto' AND v.requested_by_user_id IS NOT NULL AND v.requested_by_user_id = api.current_user_id())
       OR (v.level = 'auto' AND v.requested_by_credential_id IS NOT NULL AND v.requested_by_credential_id = api.current_credential_id())) THEN
    RAISE EXCEPTION 'request not found' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'only an approved request can be finished' USING ERRCODE = '22023';
  END IF;
  UPDATE api.agent_action_requests
     SET status = CASE WHEN p_ok THEN 'succeeded' ELSE 'failed' END,
         result = p_result, error = left(p_error, 1000), executed_at = now(), updated_at = now()
   WHERE id = p_request_id RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'agent_action_request', v.id, 'update', NULL, NULL,
    jsonb_build_object('event', 'completed', 'requestId', v.id, 'actionKey', v.action_key,
                       'status', v.status, 'error', v.error));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.finish_agent_action(uuid, boolean, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.finish_agent_action(uuid, boolean, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.finish_agent_action(uuid, boolean, jsonb, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Checks (evals)
-- ---------------------------------------------------------------------------

CREATE TABLE api.ai_eval_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    mode text NOT NULL,
    trigger text NOT NULL,
    provider_profile text,
    model text,
    status text NOT NULL,
    total integer NOT NULL,
    passed integer NOT NULL,
    failed integer NOT NULL,
    skipped integer NOT NULL,
    score numeric(5,2),
    message text,
    started_by_user_id text,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_eval_runs_pkey PRIMARY KEY (id),
    CONSTRAINT ai_eval_runs_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_ai_eval_runs_mode CHECK (mode IN ('tools', 'model')),
    CONSTRAINT chk_ai_eval_runs_trigger CHECK (trigger IN ('manual', 'profile_change')),
    CONSTRAINT chk_ai_eval_runs_status CHECK (status IN ('passed', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE api.ai_eval_runs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_ai_eval_runs_workspace ON api.ai_eval_runs (workspace_id, finished_at DESC);
--> statement-breakpoint
CREATE TABLE api.ai_eval_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    task_key text NOT NULL,
    area text NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    expected text,
    actual text,
    detail text,
    duration_ms integer NOT NULL DEFAULT 0,
    CONSTRAINT ai_eval_results_pkey PRIMARY KEY (id),
    CONSTRAINT ai_eval_results_run_fkey FOREIGN KEY (run_id) REFERENCES api.ai_eval_runs(id) ON DELETE CASCADE,
    CONSTRAINT chk_ai_eval_results_status CHECK (status IN ('passed', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE api.ai_eval_results OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_ai_eval_results_run ON api.ai_eval_results (run_id);
--> statement-breakpoint
ALTER TABLE api.ai_eval_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.ai_eval_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_eval_runs_select ON api.ai_eval_runs FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.has_settings_access(workspace_id, 'ai', 'view'));
--> statement-breakpoint
CREATE POLICY ai_eval_runs_client_select ON api.ai_eval_runs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY ai_eval_results_select ON api.ai_eval_results FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id() AND api.has_settings_access(workspace_id, 'ai', 'view'));
--> statement-breakpoint
CREATE POLICY ai_eval_results_client_select ON api.ai_eval_results FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.ai_eval_runs, api.ai_eval_results TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION internal.refuse_ai_eval_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'check results cannot be changed or deleted' USING ERRCODE = '42501';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.refuse_ai_eval_mutation() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER refuse_ai_eval_run_mutation BEFORE UPDATE ON api.ai_eval_runs
  FOR EACH ROW EXECUTE FUNCTION internal.refuse_ai_eval_mutation();
--> statement-breakpoint
CREATE TRIGGER refuse_ai_eval_result_mutation BEFORE UPDATE ON api.ai_eval_results
  FOR EACH ROW EXECUTE FUNCTION internal.refuse_ai_eval_mutation();
--> statement-breakpoint

-- Called by the server once a check run has finished. Not exposed to clients.
CREATE FUNCTION internal.record_ai_eval_run(
    p_workspace_id uuid, p_user_id text, p_mode text, p_trigger text,
    p_provider_profile text, p_model text, p_message text, p_results jsonb,
    p_started_at timestamp with time zone)
    RETURNS api.ai_eval_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.ai_eval_runs;
  v_passed integer;
  v_failed integer;
  v_skipped integer;
  v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE e->>'status' = 'passed'),
         count(*) FILTER (WHERE e->>'status' = 'failed'),
         count(*) FILTER (WHERE e->>'status' = 'skipped'),
         count(*)
    INTO v_passed, v_failed, v_skipped, v_total
    FROM jsonb_array_elements(p_results) e;
  INSERT INTO api.ai_eval_runs (workspace_id, mode, trigger, provider_profile, model, status, total,
                                passed, failed, skipped, score, message, started_by_user_id, started_at)
  VALUES (p_workspace_id, p_mode, p_trigger, p_provider_profile, p_model,
          CASE WHEN v_total = v_skipped THEN 'skipped' WHEN v_failed = 0 THEN 'passed' ELSE 'failed' END,
          v_total, v_passed, v_failed, v_skipped,
          CASE WHEN v_passed + v_failed = 0 THEN NULL ELSE round(100.0 * v_passed / (v_passed + v_failed), 2) END,
          p_message, p_user_id, p_started_at)
  RETURNING * INTO r;
  INSERT INTO api.ai_eval_results (run_id, workspace_id, task_key, area, title, status, expected, actual, detail, duration_ms)
  SELECT r.id, p_workspace_id, e->>'taskKey', e->>'area', e->>'title', e->>'status',
         e->>'expected', e->>'actual', e->>'detail', coalesce((e->>'durationMs')::integer, 0)
    FROM jsonb_array_elements(p_results) e;
  IF p_user_id IS NOT NULL THEN
    PERFORM internal.emit_change_event_as_actor(
      p_user_id, p_workspace_id, 'ai_eval_run', r.id, 'create', NULL, NULL,
      jsonb_build_object('runId', r.id, 'mode', r.mode, 'status', r.status, 'passed', r.passed,
                         'failed', r.failed, 'skipped', r.skipped, 'score', r.score,
                         'providerProfile', r.provider_profile));
  END IF;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_ai_eval_run(uuid, text, text, text, text, text, text, jsonb, timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_ai_eval_run(uuid, text, text, text, text, text, text, jsonb, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint

-- Who may run the checks: someone who manages the AI settings.
CREATE FUNCTION api.can_run_ai_evals(p_workspace_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT api.current_user_id() IS NOT NULL
     AND api.current_credential_id() IS NULL
     AND api.current_workspace_id() = p_workspace_id
     AND api.has_settings_access(p_workspace_id, 'ai', 'manage')
$$;
--> statement-breakpoint
ALTER FUNCTION api.can_run_ai_evals(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.can_run_ai_evals(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.can_run_ai_evals(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lab watchers
-- ---------------------------------------------------------------------------

CREATE TABLE api.lab_watchers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    project_id uuid,
    schedule text DEFAULT 'daily' NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    owner_user_id text NOT NULL,
    last_run_at timestamp with time zone,
    last_found integer,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_watchers_pkey PRIMARY KEY (id),
    CONSTRAINT lab_watchers_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT lab_watchers_project_fkey FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE CASCADE,
    CONSTRAINT lab_watchers_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_lab_watchers_kind CHECK (kind IN ('stock_expiring', 'stock_low', 'work_overdue', 'data_missing', 'results_off')),
    CONSTRAINT chk_lab_watchers_schedule CHECK (schedule IN ('hourly', 'daily', 'weekly')),
    CONSTRAINT chk_lab_watchers_params CHECK (jsonb_typeof(params) = 'object')
);
--> statement-breakpoint
ALTER TABLE api.lab_watchers OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_lab_watchers_scope ON api.lab_watchers
  (workspace_id, kind, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE INDEX idx_lab_watchers_due ON api.lab_watchers (next_run_at) WHERE enabled;
--> statement-breakpoint

CREATE TABLE api.lab_watcher_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    watcher_id uuid NOT NULL,
    kind text NOT NULL,
    dedupe_key text NOT NULL,
    object_kind text NOT NULL,
    object_id uuid,
    project_id uuid,
    title text NOT NULL,
    summary text NOT NULL,
    suggested_action jsonb,
    status text DEFAULT 'open' NOT NULL,
    snoozed_until timestamp with time zone,
    resolved_at timestamp with time zone,
    dismissed_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_watcher_findings_pkey PRIMARY KEY (id),
    CONSTRAINT lab_watcher_findings_workspace_fkey FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT lab_watcher_findings_watcher_fkey FOREIGN KEY (watcher_id) REFERENCES api.lab_watchers(id) ON DELETE CASCADE,
    CONSTRAINT chk_lab_watcher_findings_status CHECK (status IN ('open', 'snoozed', 'dismissed', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE api.lab_watcher_findings OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_lab_watcher_findings_key ON api.lab_watcher_findings (watcher_id, dedupe_key);
--> statement-breakpoint
CREATE INDEX idx_lab_watcher_findings_workspace ON api.lab_watcher_findings (workspace_id, status, created_at DESC);
--> statement-breakpoint

ALTER TABLE api.lab_watchers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.lab_watcher_findings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY lab_watchers_select ON api.lab_watchers FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (owner_user_id = api.current_user_id() OR api.has_settings_access(workspace_id, 'ai', 'view')));
--> statement-breakpoint
CREATE POLICY lab_watchers_client_select ON api.lab_watchers FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY lab_watcher_findings_select ON api.lab_watcher_findings FOR SELECT TO authenticated
    USING (workspace_id = api.current_workspace_id()
           AND (EXISTS (SELECT 1 FROM api.lab_watchers w WHERE w.id = watcher_id AND w.owner_user_id = api.current_user_id())
                OR api.has_settings_access(workspace_id, 'ai', 'view')));
--> statement-breakpoint
CREATE POLICY lab_watcher_findings_client_select ON api.lab_watcher_findings FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.lab_watchers, api.lab_watcher_findings TO authenticated, api_client;
--> statement-breakpoint

-- What a watcher currently finds. Rules, no model: the same check run twice on
-- the same data gives the same answer, and it works with AI switched off.
CREATE FUNCTION internal.lab_watcher_candidates(p_watcher api.lab_watchers)
    RETURNS TABLE (object_kind text, object_id uuid, project_id uuid, title text, summary text,
                   suggested jsonb, dedupe_key text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_days integer := coalesce(nullif(p_watcher.params->>'days', '')::integer, 30);
  v_sigma numeric := coalesce(nullif(p_watcher.params->>'sigma', '')::numeric, 3);
BEGIN
  IF p_watcher.kind = 'stock_expiring' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Lot ' || coalesce(r.properties->>'lot', '(no lot)') || ' expires on ' || (r.properties->>'expiry')
            || ' and nothing is planned for it.')::text,
           jsonb_build_object('kind', 'lab_action', 'label', 'Order a replacement',
                              'action', 'request_reagent_order',
                              'arguments', jsonb_build_object('p_material_record_id', r.id, 'p_quantity', 1)),
           ('expiring:' || r.id || ':' || (r.properties->>'expiry'))::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed', 'depleted')
       AND CASE WHEN (r.properties->>'expiry') ~ '^\d{4}-\d{2}-\d{2}$'
                THEN (r.properties->>'expiry')::date END <= current_date + v_days
       AND NOT EXISTS (SELECT 1 FROM api.reagent_orders o
                        WHERE o.material_record_id = r.id AND o.status NOT IN ('received', 'cancelled'))
       AND NOT EXISTS (SELECT 1 FROM api.sample_reservations s
                        WHERE s.sample_record_id = r.id AND s.state = 'active');
  ELSIF p_watcher.kind = 'stock_low' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Only ' || (r.properties->>'quantity') || ' ' || coalesce(r.properties->>'unit', '')
            || ' left, at or below the low-stock level of ' || (r.properties->>'low_stock_threshold') || '. No order is open.')::text,
           jsonb_build_object('kind', 'lab_action', 'label', 'Request more',
                              'action', 'request_reagent_order',
                              'arguments', jsonb_build_object('p_material_record_id', r.id, 'p_quantity', 1)),
           ('low:' || r.id)::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'material' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND coalesce(r.status, '') NOT IN ('quarantined', 'expired', 'consumed')
       AND (r.properties->>'quantity') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (r.properties->>'low_stock_threshold') ~ '^[0-9]+(\.[0-9]+)?$'
       AND (r.properties->>'quantity')::numeric <= (r.properties->>'low_stock_threshold')::numeric
       AND NOT EXISTS (SELECT 1 FROM api.reagent_orders o
                        WHERE o.material_record_id = r.id AND o.status NOT IN ('received', 'cancelled'));
  ELSIF p_watcher.kind = 'work_overdue' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           ('Planned to finish on ' || to_char(d.due, 'YYYY-MM-DD') || ' (' || (current_date - d.due)
            || CASE WHEN current_date - d.due = 1 THEN ' day' ELSE ' days' END || ' ago) and still open.')::text,
           NULL::jsonb,
           ('overdue:' || r.id || ':' || to_char(d.due, 'YYYY-MM-DD'))::text
      FROM api.records r
      JOIN LATERAL (
        SELECT least(r.planned_end, m.planned_on) AS due
          FROM (SELECT 1) one
          LEFT JOIN api.experiment_series_members m ON m.member_record_id = r.id
         WHERE r.planned_end IS NOT NULL OR m.planned_on IS NOT NULL) d ON d.due IS NOT NULL
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'experiment' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND r.status IN ('planned', 'draft', 'in_progress')
       AND d.due < current_date;
  ELSIF p_watcher.kind = 'data_missing' THEN
    RETURN QUERY
    SELECT 'record'::text, r.id, r.project_id, (r.identifier || ' ' || r.title)::text,
           'Every step is ticked off, but no results, tables or sheets are recorded yet. Add the data before sending it for review.'::text,
           NULL::jsonb,
           ('missing:' || r.id)::text
      FROM api.records r
     WHERE r.workspace_id = p_watcher.workspace_id
       AND r.kind = 'experiment' AND r.deleted_at IS NULL AND r.archived_at IS NULL
       AND (p_watcher.project_id IS NULL OR r.project_id = p_watcher.project_id)
       AND r.status = 'in_progress'
       AND EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type = 'procedure_step')
       AND NOT EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type = 'procedure_step'
                          AND coalesce(b.payload->>'completed', 'false') <> 'true')
       AND NOT EXISTS (SELECT 1 FROM api.blocks b WHERE b.record_id = r.id AND b.type IN ('metric', 'table', 'sheet'));
  ELSIF p_watcher.kind = 'results_off' THEN
    RETURN QUERY
    WITH history AS (
      SELECT m.sample_record_id, m.name, m.unit, m.value, m.measured_at, m.id,
             avg(m.value) OVER w AS mean, stddev_samp(m.value) OVER w AS sd, count(*) OVER w AS n
        FROM api.sample_measurements m
        JOIN api.records s ON s.id = m.sample_record_id
       WHERE m.workspace_id = p_watcher.workspace_id
         AND (p_watcher.project_id IS NULL OR s.project_id = p_watcher.project_id)
      WINDOW w AS (PARTITION BY m.name, coalesce(m.unit, '')
                   ORDER BY m.measured_at, m.id ROWS BETWEEN 50 PRECEDING AND 1 PRECEDING)
    )
    SELECT 'record'::text, h.sample_record_id, s.project_id,
           (s.identifier || ' ' || s.title)::text,
           (h.name || ' of ' || trim_scale(h.value) || coalesce(' ' || h.unit, '') || ' is '
            || round(abs(h.value - h.mean) / h.sd, 1) || ' standard deviations '
            || CASE WHEN h.value > h.mean THEN 'above' ELSE 'below' END
            || ' the usual ' || round(h.mean, 3) || ' (from ' || h.n || ' earlier readings).')::text,
           NULL::jsonb,
           ('off:' || h.id)::text
      FROM history h
      JOIN api.records s ON s.id = h.sample_record_id
     WHERE h.n >= 5 AND h.sd > 0
       AND h.measured_at >= now() - interval '14 days'
       AND abs(h.value - h.mean) / h.sd >= v_sigma;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.lab_watcher_candidates(api.lab_watchers) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.lab_watcher_candidates(api.lab_watchers) FROM PUBLIC;
--> statement-breakpoint

-- Run one watcher: add findings that are new, close the ones that are no
-- longer true, and bring back snoozed ones whose time is up. Returns how many
-- new findings were made.
CREATE FUNCTION internal.scan_lab_watcher(p_watcher_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w api.lab_watchers;
  f api.lab_watcher_findings;
  c record;
  v_new integer := 0;
  v_keys text[] := '{}';
  v_id uuid;
  v_inserted boolean;
BEGIN
  SELECT * INTO w FROM api.lab_watchers WHERE id = p_watcher_id FOR UPDATE;
  IF w.id IS NULL THEN RETURN 0; END IF;
  FOR c IN SELECT * FROM internal.lab_watcher_candidates(w) LOOP
    v_keys := v_keys || c.dedupe_key;
    INSERT INTO api.lab_watcher_findings
      (workspace_id, watcher_id, kind, dedupe_key, object_kind, object_id, project_id, title, summary, suggested_action)
    VALUES (w.workspace_id, w.id, w.kind, c.dedupe_key, c.object_kind, c.object_id, c.project_id, c.title, c.summary, c.suggested)
    ON CONFLICT (watcher_id, dedupe_key) DO UPDATE
      SET summary = excluded.summary, title = excluded.title, suggested_action = excluded.suggested_action,
          updated_at = now(),
          status = CASE WHEN api.lab_watcher_findings.status = 'resolved' THEN 'open'
                        WHEN api.lab_watcher_findings.status = 'snoozed' AND api.lab_watcher_findings.snoozed_until <= now() THEN 'open'
                        ELSE api.lab_watcher_findings.status END,
          resolved_at = CASE WHEN api.lab_watcher_findings.status = 'resolved' THEN NULL ELSE api.lab_watcher_findings.resolved_at END
    RETURNING id, (xmax = 0) INTO v_id, v_inserted;
    IF v_inserted THEN
      SELECT * INTO f FROM api.lab_watcher_findings WHERE id = v_id;
      v_new := v_new + 1;
      PERFORM internal.emit_change_event_as_actor(
        w.owner_user_id, w.workspace_id, 'lab_watcher_finding', f.id, 'create', NULL, f.project_id,
        jsonb_build_object('findingId', f.id, 'watcherId', w.id, 'watcherKind', w.kind,
                           'objectKind', f.object_kind, 'objectId', f.object_id,
                           'title', f.title, 'summary', f.summary));
    END IF;
  END LOOP;
  UPDATE api.lab_watcher_findings
     SET status = 'resolved', resolved_at = now(), updated_at = now()
   WHERE watcher_id = w.id AND status IN ('open', 'snoozed') AND NOT (dedupe_key = ANY (v_keys));
  UPDATE api.lab_watchers
     SET last_run_at = now(), last_found = v_new, updated_at = now(),
         next_run_at = now() + CASE schedule WHEN 'hourly' THEN interval '1 hour'
                                             WHEN 'weekly' THEN interval '7 days'
                                             ELSE interval '1 day' END
   WHERE id = w.id;
  RETURN v_new;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.scan_lab_watcher(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.scan_lab_watcher(uuid) FROM PUBLIC;
--> statement-breakpoint

-- The scheduler calls this on a timer.
CREATE FUNCTION internal.run_due_lab_watchers() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w record;
  v_found integer := 0;
BEGIN
  FOR w IN SELECT id FROM api.lab_watchers WHERE enabled AND next_run_at <= now() ORDER BY next_run_at LIMIT 200 LOOP
    BEGIN
      v_found := v_found + internal.scan_lab_watcher(w.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE api.lab_watchers SET next_run_at = now() + interval '1 hour' WHERE id = w.id;
    END;
  END LOOP;
  RETURN v_found;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.run_due_lab_watchers() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.run_due_lab_watchers() FROM PUBLIC;
--> statement-breakpoint

-- Turn a watcher on or off, or change when and where it looks.
CREATE FUNCTION api.set_lab_watcher(
    p_workspace_id uuid, p_kind text, p_enabled boolean,
    p_schedule text DEFAULT 'daily', p_project_id uuid DEFAULT NULL, p_params jsonb DEFAULT '{}'::jsonb)
    RETURNS api.lab_watchers
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.lab_watchers;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL
     OR NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.projects pr WHERE pr.id = p_project_id AND pr.workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('stock_expiring', 'stock_low', 'work_overdue', 'data_missing', 'results_off') THEN
    RAISE EXCEPTION 'unknown watcher' USING ERRCODE = '22023';
  END IF;
  IF p_schedule NOT IN ('hourly', 'daily', 'weekly') THEN
    RAISE EXCEPTION 'schedule must be hourly, daily or weekly' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_params, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'params must be an object' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.lab_watchers w
   WHERE w.workspace_id = p_workspace_id AND w.kind = p_kind
     AND coalesce(w.project_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_project_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF v.id IS NOT NULL AND v.owner_user_id <> api.current_user_id()
     AND NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'only the person who turned this on, or an AI settings manager, can change it' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.lab_watchers (workspace_id, kind, enabled, project_id, schedule, params, owner_user_id)
  VALUES (p_workspace_id, p_kind, p_enabled, p_project_id, p_schedule, coalesce(p_params, '{}'::jsonb), api.current_user_id())
  ON CONFLICT (workspace_id, kind, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
  DO UPDATE SET enabled = excluded.enabled, schedule = excluded.schedule, params = excluded.params,
                next_run_at = CASE WHEN excluded.enabled AND NOT api.lab_watchers.enabled THEN now() ELSE api.lab_watchers.next_run_at END,
                updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_lab_watcher(uuid, text, boolean, text, uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_lab_watcher(uuid, text, boolean, text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_lab_watcher(uuid, text, boolean, text, uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- Look now instead of waiting for the schedule.
CREATE FUNCTION api.run_lab_watcher(p_watcher_id uuid) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  w api.lab_watchers;
BEGIN
  SELECT * INTO w FROM api.lab_watchers WHERE id = p_watcher_id;
  IF w.id IS NULL OR w.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT (w.owner_user_id = api.current_user_id() OR api.has_settings_access(w.workspace_id, 'ai', 'manage'))
     OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'watcher not found' USING ERRCODE = '42501';
  END IF;
  RETURN internal.scan_lab_watcher(p_watcher_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_lab_watcher(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_lab_watcher(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_lab_watcher(uuid) TO authenticated;
--> statement-breakpoint

-- Dismiss a finding for good, or snooze it until a date.
CREATE FUNCTION api.set_watcher_finding_status(p_finding_id uuid, p_action text, p_until timestamp with time zone DEFAULT NULL)
    RETURNS api.lab_watcher_findings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  f api.lab_watcher_findings;
  w api.lab_watchers;
BEGIN
  SELECT * INTO f FROM api.lab_watcher_findings WHERE id = p_finding_id FOR UPDATE;
  IF f.id IS NULL OR f.workspace_id IS DISTINCT FROM api.current_workspace_id() OR api.current_user_id() IS NULL
     OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'finding not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO w FROM api.lab_watchers WHERE id = f.watcher_id;
  IF NOT (w.owner_user_id = api.current_user_id() OR api.has_settings_access(f.workspace_id, 'ai', 'manage')) THEN
    RAISE EXCEPTION 'finding not found' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('dismiss', 'snooze', 'reopen') THEN
    RAISE EXCEPTION 'action must be dismiss, snooze or reopen' USING ERRCODE = '22023';
  END IF;
  IF p_action = 'snooze' AND (p_until IS NULL OR p_until <= now()) THEN
    RAISE EXCEPTION 'snooze until a time in the future' USING ERRCODE = '22023';
  END IF;
  UPDATE api.lab_watcher_findings
     SET status = CASE p_action WHEN 'dismiss' THEN 'dismissed' WHEN 'snooze' THEN 'snoozed' ELSE 'open' END,
         snoozed_until = CASE WHEN p_action = 'snooze' THEN p_until END,
         dismissed_by_user_id = CASE WHEN p_action = 'dismiss' THEN api.current_user_id() END,
         updated_at = now()
   WHERE id = p_finding_id RETURNING * INTO f;
  RETURN f;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_watcher_finding_status(uuid, text, timestamp with time zone) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_watcher_finding_status(uuid, text, timestamp with time zone) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_watcher_finding_status(uuid, text, timestamp with time zone) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Inbox
-- ---------------------------------------------------------------------------

ALTER VIEW internal.my_work_items_all RENAME TO my_work_items_pre_watchers;
--> statement-breakpoint
CREATE VIEW internal.my_work_items_all AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_pre_watchers
UNION ALL
 SELECT 'watcher_finding'::text AS kind,
        CASE WHEN f.object_kind = 'record' THEN f.object_id END AS record_id,
        r.identifier AS identifier,
        f.title AS title,
        f.project_id,
        f.summary AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        f.created_at,
        'watcher_finding'::text AS source_type,
        f.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.lab_watcher_findings f
   JOIN api.lab_watchers w ON w.id = f.watcher_id
   LEFT JOIN api.records r ON r.id = f.object_id AND f.object_kind = 'record'
  WHERE f.workspace_id = api.current_workspace_id()
    AND w.owner_user_id = api.current_user_id()
    AND w.enabled
    AND (f.status = 'open' OR (f.status = 'snoozed' AND f.snoozed_until <= now()))
UNION ALL
 SELECT 'agent_action_request'::text AS kind,
        NULL::uuid AS record_id,
        NULL::text AS identifier,
        q.summary AS title,
        NULL::uuid AS project_id,
        ('Waiting for your approval: ' || replace(q.action_key, '_', ' ')) AS reason,
        NULL::timestamp with time zone AS due_at,
        'needs_action'::text AS state,
        q.created_at,
        'agent_action_request'::text AS source_type,
        q.id AS source_id,
        NULL::uuid AS parser_version_id, NULL::uuid AS connector_id, NULL::uuid AS revision_id,
        NULL::uuid AS dataset_id, NULL::uuid AS row_id, NULL::uuid AS field_id
   FROM api.agent_action_requests q
  WHERE q.workspace_id = api.current_workspace_id()
    AND q.status = 'pending'
    AND (q.requested_by_user_id = api.current_user_id()
         OR (q.requested_by_credential_id IS NOT NULL AND api.has_settings_access(q.workspace_id, 'ai', 'manage')));
--> statement-breakpoint
ALTER VIEW internal.my_work_items_all OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_all TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE internal.my_work_items_pre_watchers TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE VIEW api.my_work_items WITH (security_invoker='true') AS
 SELECT kind, record_id, identifier, title, project_id, reason, due_at, state, created_at,
        source_type, source_id, parser_version_id, connector_id, revision_id,
        dataset_id, row_id, field_id
   FROM internal.my_work_items_all
  WHERE NOT internal.inbox_kind_muted(kind);
--> statement-breakpoint
CREATE OR REPLACE VIEW api.inbox_work_items WITH (security_invoker='true') AS
 SELECT kind,
    record_id,
    identifier,
    title,
    project_id,
    reason,
    due_at,
    state,
    created_at,
    source_type,
    source_id,
    parser_version_id,
    connector_id,
    revision_id,
    dataset_id,
    row_id,
    field_id,
    ((kind || ':'::text) || COALESCE((source_id)::text, (record_id)::text, identifier, title, 'Untitled'::text)) AS item_key,
        CASE
            WHEN ((state = 'following'::text) OR (kind = 'following'::text)) THEN 'following'::text
            WHEN ((state = 'done_today'::text) OR (EXISTS ( SELECT 1
               FROM api.work_item_views v
              WHERE ((v.item_key = ((i.kind || ':'::text) || COALESCE((i.source_id)::text, (i.record_id)::text, i.identifier, i.title, 'Untitled'::text))) AND (v.workspace_id = api.current_workspace_id()) AND (v.user_id = api.current_user_id()))))) THEN 'done-today'::text
            ELSE 'needs-action'::text
        END AS inbox_tab,
        CASE
            WHEN (kind = ANY (ARRAY['review_requested'::text, 'witness_requested'::text, 'review_returned'::text, 'approval_unsigned'::text, 'witness_signed'::text])) THEN 'reviews'::text
            WHEN (kind = ANY (ARRAY['data_issue'::text, 'cell_conflict'::text])) THEN 'data'::text
            WHEN (kind = ANY (ARRAY['run_failed'::text, 'run_waiting'::text])) THEN 'runs'::text
            WHEN (kind = ANY (ARRAY['material_expiring'::text, 'reorder_requested'::text, 'reorder_incoming'::text])) THEN 'materials'::text
            WHEN (kind = ANY (ARRAY['sample_awaiting_release'::text, 'sample_hold_exceeded'::text, 'calibration_overdue'::text, 'qualification_granted'::text, 'request_submitted'::text, 'request_update'::text, 'shipment_incoming'::text, 'watcher_finding'::text])) THEN 'lab'::text
            WHEN (kind = ANY (ARRAY['access_requested'::text, 'access_decided'::text, 'invitation_accepted'::text, 'verification_requested'::text, 'verification_granted'::text, 'qualification_requested'::text])) THEN 'admin'::text
            WHEN (kind = ANY (ARRAY['agent_proposal'::text, 'agent_action_request'::text])) THEN 'agents'::text
            ELSE 'following'::text
        END AS inbox_type
   FROM api.my_work_items i
  WHERE ((kind <> 'agent_proposal'::text) OR (EXISTS ( SELECT 1
           FROM api.agent_operation_proposals ap
          WHERE ((ap.id = i.source_id) AND ((ap.approver_user_id IS NULL) OR ((ap.approver_user_id)::text = (api.current_user_id())::text))))));
--> statement-breakpoint

INSERT INTO api.notification_events (event_type, source, inbox_kinds, default_email)
VALUES ('watcher_finding', 'inbox', ARRAY['watcher_finding'], false),
       ('agent_action_request', 'inbox', ARRAY['agent_action_request'], false);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Pipelines: a trigger and two actions
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''storage.alarm.raised'', ''storage.alarm.cleared''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''storage.alarm.raised'', ''storage.alarm.cleared''',
    '''storage.alarm.raised'', ''storage.alarm.cleared'', ''watcher.finding.created''');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"run_lab_watcher","rpc":"run_lab_watcher","label":"Run a lab watcher now","description":"Look for new findings straight away instead of waiting for the watcher's schedule.","arguments":[{"name":"p_watcher_id","type":"uuid","required":true,"nullable":false}]},{"operation":"set_watcher_finding_status","rpc":"set_watcher_finding_status","label":"Dismiss or snooze a watcher finding","description":"Dismiss a finding for good, snooze it until a later time, or bring it back.","arguments":[{"name":"p_finding_id","type":"uuid","required":true,"nullable":false},{"name":"p_action","type":"text","required":true,"nullable":false},{"name":"p_until","type":"timestamptz","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
