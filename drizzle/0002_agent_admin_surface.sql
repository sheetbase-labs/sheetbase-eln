-- Admin surface for MCP: personal-token reads and approval-gated changes.
--
-- Reads are bounded metadata RPCs/table reads whose callers are additionally
-- checked against the current workspace role by the MCP handler. They add no
-- parallel authority: every table read is still under RLS, and the two RPCs
-- check the human identity and the owner capability.
--
-- Changes use the existing proposal ledger. `workspace_ai_settings.update` is
-- always human_required: no delegation policy can target it, and execution
-- re-checks the owner capability in a human session.

-- ---------------------------------------------------------------------------
-- 1. Credential scopes.
-- ---------------------------------------------------------------------------

ALTER TABLE internal.api_credentials
  DROP CONSTRAINT chk_api_credentials_scopes;
--> statement-breakpoint

ALTER TABLE internal.api_credentials
  ADD CONSTRAINT chk_api_credentials_scopes CHECK (
    cardinality(scopes) > 0
    AND scopes <@ ARRAY[
      'projects:read','projects:write','datasets:read','datasets:write',
      'schema:read','schema:write','schema:publish','sheets:read','sheets:write',
      'models:read','models:write','templates:read','templates:write',
      'reviews:read','reviews:write','files:read','files:write',
      'webhooks:read','webhooks:write','agent_operations:read',
      'agent_operations:write','pipelines:read','pipelines:write',
      'admin:read','admin:write'
    ]::text[]
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Proposal kinds.
-- ---------------------------------------------------------------------------

ALTER TABLE api.agent_operation_proposals
  DROP CONSTRAINT chk_agent_operation_proposals_kind;
--> statement-breakpoint

ALTER TABLE api.agent_operation_proposals
  ADD CONSTRAINT chk_agent_operation_proposals_kind CHECK (
    operation_kind = ANY (ARRAY[
      'dataset_schema.create','sheet_definition.create',
      'sheet_definition.update_draft','pipeline_definition.create',
      'pipeline_definition.create_version','pipeline_definition.update_draft',
      'dataset_rows.commit','notebook_block.insert',
      'workspace_ai_settings.update'
    ]::text[])
  );
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Canonical AI-settings update RPC.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.update_workspace_ai_settings(
  p_workspace_id uuid,
  p_enabled boolean,
  p_provider_profile text,
  p_model text,
  p_cloud_egress_enabled boolean,
  p_max_tokens integer,
  p_max_cost integer
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.workspace_settings;
BEGIN
  -- A browser session carries `session_id`; a personal or service credential
  -- does not. Administration changes therefore cannot be driven by a token.
  IF api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'session_id', '') = '' THEN
    RAISE EXCEPTION 'human session required for AI settings' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF p_model IS NULL
     OR p_model NOT IN ('sheetbase-assist-1', 'sheetbase-summarise-1')
     OR p_max_tokens IS NULL
     OR p_max_tokens NOT BETWEEN 1 AND 100000
     OR p_max_cost IS NULL
     OR p_max_cost NOT BETWEEN 0 AND 10000000
     OR (p_provider_profile IS NOT NULL
         AND length(btrim(p_provider_profile)) NOT BETWEEN 1 AND 80) THEN
    RAISE EXCEPTION 'invalid AI settings' USING ERRCODE = '22023';
  END IF;

  UPDATE api.workspace_settings
     SET ai_enabled = p_enabled,
         ai_provider_profile = nullif(btrim(p_provider_profile), ''),
         ai_model = p_model,
         ai_cloud_egress_enabled = p_cloud_egress_enabled,
         ai_max_tokens_per_call = p_max_tokens,
         ai_max_cost_microusd_per_call = p_max_cost,
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

REVOKE ALL ON FUNCTION api.update_workspace_ai_settings(
  uuid, boolean, text, text, boolean, integer, integer
) FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.update_workspace_ai_settings(
  uuid, boolean, text, text, boolean, integer, integer
) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Owner-only credential metadata read (never a secret or hash).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION api.agent_admin_credentials()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
BEGIN
  IF api.current_user_id() IS NULL
     OR NOT api.has_capability(v_workspace, 'workspace.admin') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'kind', c.kind,
      'display_prefix', c.display_prefix,
      'scopes', c.scopes,
      'created_at', c.created_at,
      'last_used_at', c.last_used_at,
      'expires_at', c.expires_at,
      'revoked_at', c.revoked_at
    ) ORDER BY c.created_at DESC)
    FROM internal.api_credentials c
    WHERE c.workspace_id = v_workspace
  ), '[]'::jsonb);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.agent_admin_credentials() FROM PUBLIC;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.agent_admin_credentials() TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Admin operation contract: validation, preview and impact.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION internal.agent_admin_operation_contract(
  p_workspace_id uuid,
  p_operation jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before jsonb;
  v_target jsonb;
BEGIN
  -- Service credentials cannot propose administration changes. A personal
  -- token is still checked against the owner capability below.
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RAISE EXCEPTION 'administration proposals require a personal identity'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(api.claim_probe()->>'credential_id', '') <> ''
     AND NOT coalesce(api.claim_probe()->'scopes', '[]'::jsonb) ? 'admin:write' THEN
    RAISE EXCEPTION 'admin:write scope required' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'workspace.admin');

  IF p_operation - ARRAY[
       'kind','workspaceId','enabled','providerProfile','model',
       'cloudEgressEnabled','maxTokensPerCall','maxCostMicrousdPerCall'
     ] <> '{}'::jsonb
     OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
     OR jsonb_typeof(p_operation->'enabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(p_operation->'cloudEgressEnabled') IS DISTINCT FROM 'boolean'
     OR (p_operation->>'providerProfile' IS NOT NULL
         AND length(btrim(p_operation->>'providerProfile')) NOT BETWEEN 1 AND 80)
     OR (p_operation->>'model') IS NULL
     OR p_operation->>'model' NOT IN ('sheetbase-assist-1', 'sheetbase-summarise-1')
     OR (p_operation->>'maxTokensPerCall') IS NULL
     OR (p_operation->>'maxTokensPerCall')::int NOT BETWEEN 1 AND 100000
     OR (p_operation->>'maxCostMicrousdPerCall') IS NULL
     OR (p_operation->>'maxCostMicrousdPerCall')::int NOT BETWEEN 0 AND 10000000 THEN
    RAISE EXCEPTION 'invalid workspace AI settings operation' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'enabled', s.ai_enabled,
    'providerProfile', s.ai_provider_profile,
    'model', s.ai_model,
    'cloudEgressEnabled', s.ai_cloud_egress_enabled,
    'maxTokensPerCall', s.ai_max_tokens_per_call,
    'maxCostMicrousdPerCall', s.ai_max_cost_microusd_per_call
  )
    INTO v_before
    FROM api.workspace_settings s
   WHERE s.workspace_id = p_workspace_id;

  IF v_before IS NULL THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;

  v_target := jsonb_build_object(
    'type', 'workspace_settings',
    'id', p_workspace_id,
    'label', 'AI settings'
  );

  RETURN jsonb_build_object(
    'preview', jsonb_build_object(
      'formatVersion', 1,
      'kind', 'workspace_ai_settings.update',
      'target', v_target,
      'changes', jsonb_build_array(jsonb_build_object(
        'path', 'ai',
        'before', v_before,
        'after', jsonb_build_object(
          'enabled', p_operation->'enabled',
          'providerProfile', p_operation->'providerProfile',
          'model', p_operation->>'model',
          'cloudEgressEnabled', p_operation->'cloudEgressEnabled',
          'maxTokensPerCall', p_operation->'maxTokensPerCall',
          'maxCostMicrousdPerCall', p_operation->'maxCostMicrousdPerCall'
        )
      ))
    ),
    'impact', jsonb_build_object(
      'formatVersion', 1,
      'mutationClass', 'configuration',
      'target', v_target,
      'createsDraft', false,
      'affectedRows', 1,
      'destructive', false
    )
  );
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.agent_admin_operation_contract(uuid, jsonb)
  FROM PUBLIC;
--> statement-breakpoint

-- The existing contract stays the authority for scientific operations. The
-- wrapper only routes the new administration kind.
ALTER FUNCTION internal.agent_operation_contract(uuid, jsonb)
  RENAME TO agent_operation_contract_core;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_contract(
  p_workspace_id uuid,
  p_operation jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_operation->>'kind' = 'workspace_ai_settings.update' THEN
    RETURN internal.agent_admin_operation_contract(p_workspace_id, p_operation);
  END IF;
  RETURN internal.agent_operation_contract_core(p_workspace_id, p_operation);
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.agent_operation_contract(uuid, jsonb)
  FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 6. Admin operations are always human_required; no policy can delegate them.
-- ---------------------------------------------------------------------------

ALTER FUNCTION internal.agent_operation_policy_evaluate(uuid, jsonb, jsonb)
  RENAME TO agent_operation_policy_evaluate_core;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_policy_evaluate(
  p_workspace_id uuid,
  p_operation jsonb,
  p_contract jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_operation->>'kind' = 'workspace_ai_settings.update' THEN
    RETURN jsonb_build_object(
      'riskClass', 'consequential_write',
      'approvalPolicy', 'human_required',
      'policyId', NULL,
      'policyReason', 'Workspace administration changes always require human approval.',
      'policyLimits', '{}'::jsonb,
      'policyTarget', coalesce(p_contract->'preview'->'target', '{}'::jsonb),
      'policyEvidence', jsonb_build_object(
        'actorKind', CASE
          WHEN coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN 'credential'
          WHEN api.current_user_id() IS NOT NULL THEN 'user'
          ELSE 'unknown'
        END,
        'credentialId', nullif(api.claim_probe()->>'credential_id', '')::uuid,
        'requiredScope', 'admin:write',
        'scopeSatisfied', CASE
          WHEN coalesce(api.claim_probe()->>'credential_id', '') <> ''
            THEN coalesce(api.claim_probe()->'scopes', '[]'::jsonb) ? 'admin:write'
          ELSE true
        END,
        'riskClass', 'consequential_write',
        'evaluatedAt', to_char(
          clock_timestamp() AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      )
    );
  END IF;
  RETURN internal.agent_operation_policy_evaluate_core(
    p_workspace_id, p_operation, p_contract
  );
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.agent_operation_policy_evaluate(uuid, jsonb, jsonb)
  FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 7. Only an owner may approve or execute the admin proposal.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION internal.require_agent_operation_capability(
  p_proposal api.agent_operation_proposals
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_proposal.operation_kind = 'workspace_ai_settings.update' THEN
    -- Approval and execution of an administration change are human-only: a
    -- real session has `session_id`; a personal or service token does not.
    IF coalesce(api.claim_probe()->>'session_id', '') = '' THEN
      RAISE EXCEPTION 'human session required for administration change'
        USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(p_proposal.workspace_id, 'workspace.admin');
  ELSIF p_proposal.operation_kind LIKE 'pipeline_definition.%' THEN
    PERFORM api.require_capability(p_proposal.workspace_id, 'pipelines.manage');
  ELSIF p_proposal.operation_kind = 'dataset_rows.commit' THEN
    IF NOT api.is_workspace_writer(p_proposal.workspace_id) THEN
      RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM api.require_capability(p_proposal.workspace_id, 'schema.edit');
  END IF;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.require_agent_operation_capability(
  api.agent_operation_proposals
) FROM PUBLIC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 8. Execution: the existing scientific path plus the admin update.
-- ---------------------------------------------------------------------------

ALTER FUNCTION internal.agent_operation_execute(uuid)
  RENAME TO agent_operation_execute_core;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_execute(
  p_proposal_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_result api.agent_operation_proposals;
  v_operation jsonb;
  v_execution jsonb;
  v_code text;
  v_message text;
BEGIN
  SELECT operation_kind INTO v_kind
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id
     AND workspace_id = api.current_workspace_id();

  IF v_kind IS DISTINCT FROM 'workspace_ai_settings.update' THEN
    PERFORM internal.agent_operation_execute_core(p_proposal_id);
    RETURN;
  END IF;
  IF coalesce(api.claim_probe()->>'session_id', '') = '' THEN
    RAISE EXCEPTION 'human session required for administration change'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_result
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_result.id IS NULL
     OR v_result.status NOT IN ('pending', 'approved')
     OR (v_result.status = 'pending' AND v_result.approval_policy = 'human_required') THEN
    RAISE EXCEPTION 'proposal is not executable' USING ERRCODE = 'SB001';
  END IF;

  UPDATE api.agent_operation_proposals
     SET status = 'executing',
         revision = revision + 1,
         executed_by_user_id = api.current_user_id(),
         executed_by_credential_id = api.current_credential_id(),
         executed_at = now(),
         updated_at = now()
   WHERE id = v_result.id
  RETURNING * INTO v_result;
  PERFORM internal.agent_operation_append_event(
    v_result, 'execution_started', '{}'::jsonb
  );

  v_operation := v_result.operation;
  BEGIN
    v_execution := to_jsonb(api.update_workspace_ai_settings(
      v_result.workspace_id,
      (v_operation->>'enabled')::boolean,
      nullif(v_operation->>'providerProfile', ''),
      v_operation->>'model',
      (v_operation->>'cloudEgressEnabled')::boolean,
      (v_operation->>'maxTokensPerCall')::int,
      (v_operation->>'maxCostMicrousdPerCall')::int
    ));
    UPDATE api.agent_operation_proposals
       SET status = 'succeeded',
           revision = revision + 1,
           result = v_execution,
           error_code = NULL,
           error_message = NULL,
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(
      v_result, 'execution_succeeded', jsonb_build_object('result', v_execution)
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    UPDATE api.agent_operation_proposals
       SET status = 'failed',
           revision = revision + 1,
           error_code = v_code,
           error_message = left(v_message, 2000),
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(
      v_result, 'execution_failed',
      jsonb_build_object('errorCode', v_code, 'message', left(v_message, 2000))
    );
  END;

  PERFORM internal.emit_change_event(
    v_result.workspace_id,
    'agent_operation_proposal',
    v_result.id,
    'update',
    NULL,
    NULL,
    jsonb_build_object(
      'status', v_result.status,
      'operationKind', v_result.operation_kind,
      'policyId', v_result.policy_id,
      'canonicalResult', v_result.result,
      'approvalPolicy', v_result.approval_policy
    )
  );
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION internal.agent_operation_execute(uuid) FROM PUBLIC;
