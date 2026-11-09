-- Agent permissions on every surface, without letting an agent widen its own.
--
-- What agents may do (Auto, Ask or Never per action), whether a listed agent
-- is switched on, the operation policies that let an agent run a draft on its
-- own, and the AI switches (assistant, MCP reads, drafts, lab actions) can now
-- be changed from a token, MCP, a plugin or a pipeline as well as the page.
-- The rule for all of them:
--
-- * A person in the app (a signed-in browser session) changes them as before.
-- * Anyone else (a personal or service token, MCP, a pipeline run) may only
--   tighten them: turn an agent off, set an action to Never, switch an AI
--   feature off. Widening is refused with a pointer to request_agent_action,
--   which waits for a person to approve it in the app and runs as that person.
-- * Those requests can never be set to Auto, so the wait cannot be switched
--   off by the same route.
--
-- Deciding a request, and the two policy changes that need an electronic
-- signature (change_agent_policy, create_agent_operation_policy), stay with a
-- person in the app.
--
-- Also: change events for agents switched on or off and for workflows (signed
-- policy changes, operation policies and proposals already had them); read access for service
-- credentials; and steward reporting views.

-- ---------------------------------------------------------------------------
-- Who is asking
-- ---------------------------------------------------------------------------

-- A person in the app: a signed-in browser session. A personal token has the
-- person's `sub` but no `session_id`; a service token has neither; a pipeline
-- run carries its actor's `sub` and no session.
CREATE FUNCTION internal.is_person_in_app() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT api.current_user_id() IS NOT NULL
     AND coalesce(api.claim_probe()->>'session_id', '') <> ''
     AND coalesce(api.claim_probe()->>'credential_id', '') = ''
$$;
--> statement-breakpoint
ALTER FUNCTION internal.is_person_in_app() OWNER TO migrator;
--> statement-breakpoint

-- Actions that change what agents may do. An agent may ask for them, but the
-- request always waits for a person: Auto is never stored or applied for them.
-- The same list is in src/features/agent-policies/feature.ts.
CREATE FUNCTION internal.agent_action_always_ask(p_action_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_action_key IN (
    'set_agent_action_policy',
    'set_agent_definition_enabled',
    'disable_agent_operation_policy',
    'update_workspace_ai_feature_flags',
    'update_workspace_ai_settings'
  )
$$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_action_always_ask(text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.agent_level_rank(p_level text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE p_level WHEN 'never' THEN 0 WHEN 'ask' THEN 1 WHEN 'auto' THEN 2 END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_level_rank(text) OWNER TO migrator;
--> statement-breakpoint

-- The level one subject gets for an action from the rows on file, ignoring
-- (when asked) its own row: a credential or role row, else the row for
-- everyone, else Ask.
CREATE FUNCTION internal.agent_subject_level(
    p_workspace_id uuid, p_action_key text, p_subject_kind text,
    p_role text, p_credential_id uuid, p_skip_own boolean)
    RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(
    (SELECT p.level FROM api.agent_action_policies p
      WHERE NOT p_skip_own AND p.workspace_id = p_workspace_id AND p.action_key = p_action_key
        AND p.subject_kind = p_subject_kind
        AND coalesce(p.role, '') = coalesce(p_role, '')
        AND coalesce(p.credential_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(p_credential_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    (SELECT p.level FROM api.agent_action_policies p
      WHERE p_subject_kind <> 'everyone' AND p.workspace_id = p_workspace_id
        AND p.action_key = p_action_key AND p.subject_kind = 'everyone'),
    'ask')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_subject_level(uuid, text, text, text, uuid, boolean) OWNER TO migrator;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Auto, Ask or Never
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.resolve_agent_action_level(p_workspace_id uuid, p_action_key text, p_credential_id uuid DEFAULT NULL)
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
  END IF;
  IF v_level IS NULL AND api.current_user_id() IS NOT NULL THEN
    SELECT m.role INTO v_role FROM api.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id AND m.user_id = api.current_user_id()
       AND m.suspended_at IS NULL;
    IF v_role IS NOT NULL THEN
      SELECT p.level INTO v_level FROM api.agent_action_policies p
       WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
         AND p.subject_kind = 'role' AND p.role = v_role;
    END IF;
  END IF;
  IF v_level IS NULL THEN
    SELECT p.level INTO v_level FROM api.agent_action_policies p
     WHERE p.workspace_id = p_workspace_id AND p.action_key = p_action_key
       AND p.subject_kind = 'everyone';
  END IF;
  v_level := coalesce(v_level, 'ask');
  IF v_level = 'auto' AND internal.agent_action_always_ask(p_action_key) THEN
    RETURN 'ask';
  END IF;
  RETURN v_level;
END $$;
--> statement-breakpoint

-- An admin sets the level for one action. 'default' removes the setting. Away
-- from the app (a token, MCP, a pipeline) only a change that tightens is
-- allowed; anything wider is asked for with request_agent_action.
CREATE OR REPLACE FUNCTION api.set_agent_action_policy(
    p_workspace_id uuid, p_action_key text, p_level text,
    p_subject_kind text DEFAULT 'everyone', p_role text DEFAULT NULL, p_credential_id uuid DEFAULT NULL)
    RETURNS api.agent_action_policies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.agent_action_policies;
  v_credential uuid := p_credential_id;
  v_before text;
  v_after text;
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
  IF p_level = 'auto' AND internal.agent_action_always_ask(p_action_key) THEN
    RAISE EXCEPTION 'changes to what agents may do always wait for a person; this cannot be set to Auto' USING ERRCODE = '22023';
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

  IF NOT internal.is_person_in_app() THEN
    v_before := internal.agent_subject_level(p_workspace_id, p_action_key, p_subject_kind, p_role, v_credential, false);
    v_after := CASE WHEN p_level = 'default'
                    THEN internal.agent_subject_level(p_workspace_id, p_action_key, p_subject_kind, p_role, v_credential, true)
                    ELSE p_level END;
    IF internal.agent_level_rank(v_after) > internal.agent_level_rank(v_before) THEN
      RAISE EXCEPTION 'only a person in the app can give agents more room: ask for it with request_agent_action'
        USING ERRCODE = '42501';
    END IF;
  END IF;

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
REVOKE ALL ON FUNCTION api.set_agent_action_policy(uuid, text, text, text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_agent_action_policy(uuid, text, text, text, text, uuid) TO authenticated;
--> statement-breakpoint

-- A person approves or rejects a waiting request, in the app. Tokens and
-- pipelines cannot: an agent never approves its own request.
CREATE OR REPLACE FUNCTION api.decide_agent_action(p_request_id uuid, p_decision text, p_reason text DEFAULT NULL)
    RETURNS api.agent_action_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.agent_action_requests;
BEGIN
  IF NOT internal.is_person_in_app() THEN
    RAISE EXCEPTION 'a signed-in person must decide' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'decision must be approve or reject' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM api.agent_action_requests WHERE id = p_request_id FOR UPDATE;
  IF v.id IS NULL OR v.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(v.workspace_id)
     OR NOT (
       -- Who may approve a change to what agents may do: someone who manages
       -- the AI settings. Anything else: the requester too.
       api.has_settings_access(v.workspace_id, 'ai', 'manage')
       OR (v.requested_by_user_id = api.current_user_id()
           AND NOT internal.agent_action_always_ask(v.action_key))) THEN
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

-- ---------------------------------------------------------------------------
-- Agents on the Agents page: on or off
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.set_agent_definition_enabled(p_definition_id uuid, p_enabled boolean) RETURNS api.agent_definitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.agent_definitions;
  v_actor text := api.current_user_id();
BEGIN
  SELECT * INTO v_result FROM api.agent_definitions
   WHERE id = p_definition_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL OR v_actor IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'agent not found' USING ERRCODE = '42501';
  END IF;
  IF v_result.owner_user_id IS DISTINCT FROM v_actor
     AND NOT (api.has_capability(v_result.workspace_id, 'workspace.admin')
              OR api.is_workspace_member(v_result.workspace_id, 'steward')) THEN
    RAISE EXCEPTION 'only the owner or a workspace admin can switch an agent on or off' USING ERRCODE = '42501';
  END IF;
  IF p_enabled AND NOT v_result.enabled AND NOT internal.is_person_in_app() THEN
    RAISE EXCEPTION 'only a person in the app can switch an agent on: ask for it with request_agent_action'
      USING ERRCODE = '42501';
  END IF;
  IF v_result.enabled = p_enabled THEN
    RETURN v_result;
  END IF;
  UPDATE api.agent_definitions SET enabled = p_enabled, updated_at = now()
   WHERE id = v_result.id RETURNING * INTO v_result;
  PERFORM internal.emit_change_event(
    v_result.workspace_id, 'agent_definition', v_result.id, 'update',
    NULL, NULL, jsonb_build_object('event', CASE WHEN p_enabled THEN 'enabled' ELSE 'disabled' END,
                                   'agentId', v_result.id, 'displayId', v_result.display_id,
                                   'name', v_result.name, 'enabled', p_enabled)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Operation policies: turning one off tightens, so a token may do it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.disable_agent_operation_policy(p_workspace_id uuid, p_policy_id uuid) RETURNS api.agent_operation_policies
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.agent_operation_policies;
BEGIN
  -- Like internal.require_agent_policy_manager, but a personal token or a
  -- pipeline of a policy manager may turn a policy off.
  IF api.current_user_id() IS NULL
     OR api.current_credential_id() IS NOT NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT (api.has_capability(p_workspace_id, 'workspace.admin')
             OR api.is_workspace_member(p_workspace_id, 'steward')) THEN
    RAISE EXCEPTION 'workspace owner or steward required' USING ERRCODE = '42501';
  END IF;
  UPDATE api.agent_operation_policies
     SET enabled = false, updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = p_policy_id AND workspace_id = p_workspace_id AND enabled
  RETURNING * INTO v_result;
  IF v_result.id IS NULL THEN
    SELECT * INTO v_result FROM api.agent_operation_policies
     WHERE id = p_policy_id AND workspace_id = p_workspace_id;
    IF v_result.id IS NULL THEN
      RAISE EXCEPTION 'agent operation policy not found' USING ERRCODE = '42501';
    END IF;
    RETURN v_result;
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'agent_operation_policy', v_result.id, 'update',
    NULL, NULL, jsonb_build_object('event', 'disabled', 'enabled', false,
                                   'name', v_result.name, 'operationKind', v_result.operation_kind)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- AI switches: switching a feature off tightens, so a token may do it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_workspace_ai_feature_flags(
  p_workspace_id uuid,
  p_feature_flags jsonb
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.workspace_settings;
  v_before jsonb;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'a person is required for AI access flags' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.valid_ai_feature_flags(p_feature_flags) THEN
    RAISE EXCEPTION 'invalid AI feature flags' USING ERRCODE = '22023';
  END IF;
  SELECT s.ai_feature_flags INTO v_before FROM api.workspace_settings s
   WHERE s.workspace_id = p_workspace_id FOR UPDATE;
  -- Away from the app, a switch may only go off.
  IF NOT internal.is_person_in_app() AND EXISTS (
       SELECT 1 FROM jsonb_each(p_feature_flags) f
        WHERE f.value = 'true'::jsonb
          AND coalesce(v_before -> f.key, 'false'::jsonb) <> 'true'::jsonb) THEN
    RAISE EXCEPTION 'only a person in the app can switch an AI feature on: ask for it with request_agent_action'
      USING ERRCODE = '42501';
  END IF;

  UPDATE api.workspace_settings
     SET ai_feature_flags = p_feature_flags,
         ai_updated_by_user_id = api.current_user_id(),
         updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Change events
-- ---------------------------------------------------------------------------

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
  IF position('''agent_definition''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''agent_definition''::text, ''agent_workflow''::text]');
    EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
    EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('agent.enabled'), ('agent.disabled'),
  ('agent.signed_policy.changed'),
  ('agent.operation_policy.created'), ('agent.operation_policy.disabled'),
  ('agent.proposal.created'), ('agent.proposal.updated'),
  ('agent.workflow.created'), ('agent.workflow.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A workflow is made, or its status moves on.
CREATE FUNCTION internal.trg_change_event_agent_workflow() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  PERFORM internal.emit_change_event(NEW.workspace_id, 'agent_workflow', NEW.id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END, NULL, NULL,
    jsonb_build_object('workflowId', NEW.id, 'goal', left(NEW.goal, 500), 'status', NEW.status,
                       'previousStatus', CASE TG_OP WHEN 'UPDATE' THEN OLD.status END,
                       'currentStep', NEW.current_step, 'revision', NEW.revision));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_agent_workflow() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_agent_workflow
  AFTER INSERT OR UPDATE OF status ON api.agent_workflows
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_agent_workflow();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Service credentials read the agent lists of their own workspace
-- ---------------------------------------------------------------------------

CREATE POLICY agent_definitions_client_select ON api.agent_definitions FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_definitions TO api_client;
--> statement-breakpoint
CREATE POLICY agent_runs_client_select ON api.agent_runs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_runs TO api_client;
--> statement-breakpoint
CREATE POLICY agent_policy_revisions_client_select ON api.agent_policy_revisions FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_policy_revisions TO api_client;
--> statement-breakpoint
CREATE POLICY agent_operation_policies_client_select ON api.agent_operation_policies FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.agent_operation_policies TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Steward reporting views
-- ---------------------------------------------------------------------------

SELECT internal.register_reporting_view('agent_action_policies', 'agent_action_policies', 'Agent permissions',
  'What agents may do on their own: one row per action set to Auto, Ask or Never for everyone, a role or one service credential. An action with no row is Ask.',
  'agent_action_policies',
  ARRAY['id','action_key','subject_kind','role','credential_id','level','updated_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_action_requests', 'agent_action_requests', 'Agent requests',
  'Each action an agent asked to take, what the setting did with it, who decided and how it ended.',
  'agent_action_requests',
  ARRAY['id','action_key','arguments','summary','level','status','requested_by_user_id','requested_by_credential_id','provenance','decided_by_user_id','decided_at','decision_reason','executed_at','error','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agents', 'agents', 'Agents',
  'The agents on the Agents page: what starts them, who owns them, which projects they cover, their policy and whether they are on.',
  'agent_definitions',
  ARRAY['id','display_id','name','kind','description','trigger_label','project_ids','owner_user_id','model_label','reads','proposes','enabled','policy','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_runs', 'agent_runs', 'Agent runs',
  'Each time an agent ran: its outcome and the proposal it made, if any.',
  'agent_runs',
  ARRAY['id','definition_id','run_number','outcome','summary','detail','proposal_id','started_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_policy_revisions', 'agent_policy_revisions', 'Agent policy history',
  'The numbered, signed revisions of the agents'' policy: what changed, why and who signed.',
  'agent_policy_revisions',
  ARRAY['id','revision','summary','change_ref','reason','changed_by_user_id','signed_meaning','changed_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_operation_policies', 'agent_operation_policies', 'Agent operation policies',
  'The signed policies that let one service credential run one kind of draft on its own, within limits.',
  'agent_operation_policies',
  ARRAY['id','name','operation_kind','target_type','target_id','limits','enabled','credential_id','reason','signed_by_user_id','signed_at','created_by_user_id','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_proposals', 'agent_proposals', 'Agent proposals',
  'Drafts agents proposed, their status and who decided them.',
  'agent_operation_proposals',
  ARRAY['id','display_id','title','summary','operation_kind','status','risk_class','policy_id','agent_definition_id','agent_run_id','proposed_by_user_id','proposed_by_credential_id','approver_user_id','signature_required','approved_by_user_id','approved_at','rejected_by_user_id','rejected_at','rejection_reason','executed_by_user_id','executed_at','error_code','error_message','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('agent_workflows', 'agent_workflows', 'Agent workflows',
  'Multi-step agent workflows: goal, status, budget and what was used.',
  'agent_workflows',
  ARRAY['id','goal','status','current_step','max_operations','max_tokens','max_cost_microusd','used_operations','used_tokens','used_cost_microusd','created_by_user_id','created_by_credential_id','cancelled_at','cancellation_reason','completed_at','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('ai_checks', 'ai_checks', 'Assistant checks',
  'Each run of the assistant checks: when, which model, how many passed and the score.',
  'ai_eval_runs',
  ARRAY['id','mode','trigger','provider_profile','model','status','total','passed','failed','skipped','score','message','started_by_user_id','started_at','finished_at']);
