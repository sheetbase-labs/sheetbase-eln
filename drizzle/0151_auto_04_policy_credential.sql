-- AUTO-04 policy tightening.
--
-- Delegation binds to one live service credential. Automatic Dataset writes
-- are create/append only; updates and overwrites stay human-required.

ALTER TABLE api.agent_operation_policies
  ADD COLUMN credential_id uuid NOT NULL
  REFERENCES internal.api_credentials(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX idx_agent_operation_policies_credential
  ON api.agent_operation_policies (workspace_id, credential_id, enabled);
--> statement-breakpoint

DROP FUNCTION IF EXISTS api.create_agent_operation_policy(uuid,text,text,text,uuid,jsonb);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.validate_agent_policy_credential(
  p_workspace_id uuid,
  p_credential_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_credential_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM internal.api_credentials credential
    WHERE credential.id = p_credential_id
      AND credential.workspace_id = p_workspace_id
      AND credential.kind = 'service'
      AND credential.revoked_at IS NULL
      AND (credential.expires_at IS NULL OR credential.expires_at > now())
  ) THEN
    RAISE EXCEPTION 'delegation requires a live workspace service credential'
      USING ERRCODE = '22023';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.validate_agent_policy_credential(uuid,uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_agent_operation_policy(
  p_workspace_id uuid,
  p_name text,
  p_operation_kind text,
  p_target_type text,
  p_target_id uuid,
  p_credential_id uuid,
  p_limits jsonb DEFAULT '{}'::jsonb
) RETURNS api.agent_operation_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_policies;
  v_limits jsonb := coalesce(p_limits, '{}'::jsonb);
  v_max integer;
BEGIN
  PERFORM internal.require_agent_policy_manager(p_workspace_id);
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 200
     OR p_operation_kind NOT IN (
       'dataset_schema.create', 'sheet_definition.create',
       'sheet_definition.update_draft', 'pipeline_definition.create',
       'pipeline_definition.create_version', 'pipeline_definition.update_draft',
       'dataset_rows.commit'
     )
     OR jsonb_typeof(v_limits) IS DISTINCT FROM 'object'
     OR v_limits - 'maxAffectedRows' <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid agent operation policy' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.validate_agent_policy_target(
    p_workspace_id, p_target_type, p_target_id
  );
  PERFORM internal.validate_agent_policy_credential(
    p_workspace_id, p_credential_id
  );
  IF v_limits ? 'maxAffectedRows' THEN
    BEGIN
      v_max := (v_limits->>'maxAffectedRows')::integer;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'maxAffectedRows must be an integer' USING ERRCODE = '22023';
    END;
    IF v_max NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'maxAffectedRows must be between 1 and 1000' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_operation_kind = 'dataset_rows.commit'
     AND (NOT (v_limits ? 'maxAffectedRows') OR v_max IS NULL) THEN
    RAISE EXCEPTION 'Dataset row policies require maxAffectedRows' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.agent_operation_policies(
    workspace_id, name, credential_id, operation_kind, target_type, target_id,
    limits, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, btrim(p_name), p_credential_id, p_operation_kind,
    p_target_type, p_target_id, v_limits, api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v_result;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'agent_operation_policy', v_result.id, 'create',
    NULL, NULL, jsonb_build_object(
      'name', v_result.name,
      'credentialId', v_result.credential_id,
      'operationKind', v_result.operation_kind,
      'targetType', v_result.target_type,
      'targetId', v_result.target_id,
      'limits', v_result.limits
    )
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,uuid,jsonb)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,uuid,jsonb)
  TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_policy_matches(
  p_policy api.agent_operation_policies,
  p_workspace_id uuid,
  p_operation jsonb,
  p_target jsonb
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_target_id uuid;
  v_project_id uuid;
BEGIN
  IF p_policy.workspace_id IS DISTINCT FROM p_workspace_id
     OR p_policy.operation_kind IS DISTINCT FROM p_operation->>'kind'
     OR NOT p_policy.enabled
     OR p_policy.credential_id IS DISTINCT FROM api.current_credential_id()
     OR NOT EXISTS (
       SELECT 1
       FROM internal.api_credentials credential
       WHERE credential.id = p_policy.credential_id
         AND credential.workspace_id = p_workspace_id
         AND credential.kind = 'service'
         AND credential.revoked_at IS NULL
         AND (credential.expires_at IS NULL OR credential.expires_at > now())
     ) THEN
    RETURN false;
  END IF;
  IF p_policy.target_type = 'workspace' THEN
    RETURN true;
  END IF;
  BEGIN
    v_target_id := nullif(p_target->>'id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  IF p_policy.target_type = p_target->>'type'
     AND p_policy.target_id = v_target_id THEN
    RETURN true;
  END IF;
  IF p_policy.target_type = 'project'
     AND p_operation->>'kind' = 'dataset_rows.commit'
     AND p_target->>'type' = 'dataset' THEN
    SELECT primary_project_id INTO v_project_id
      FROM api.datasets
     WHERE id = v_target_id AND workspace_id = p_workspace_id;
    RETURN p_policy.target_id = v_project_id;
  END IF;
  RETURN false;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_policy_evaluate(
  p_workspace_id uuid,
  p_operation jsonb,
  p_contract jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text := p_operation->>'kind';
  v_target jsonb := p_contract->'preview'->'target';
  v_risk text;
  v_required_scope text;
  v_actor_kind text;
  v_scope_ok boolean := true;
  v_policy api.agent_operation_policies;
  v_affected_rows integer := coalesce((p_contract->'impact'->>'affectedRows')::integer, 0);
  v_max_rows integer;
  v_approval_policy text;
  v_reason text;
  v_policy_limits jsonb := '{}'::jsonb;
  v_policy_id uuid;
  v_target_matched boolean := false;
  v_limit_satisfied boolean := true;
  v_create_only boolean := true;
BEGIN
  v_risk := CASE
    WHEN v_kind IN (
      'dataset_schema.create', 'sheet_definition.create',
      'sheet_definition.update_draft', 'pipeline_definition.create',
      'pipeline_definition.create_version', 'pipeline_definition.update_draft'
    ) THEN 'safe_draft'
    ELSE 'consequential_write'
  END;
  v_required_scope := CASE
    WHEN v_kind = 'dataset_rows.commit' THEN 'datasets:write'
    ELSE 'schema:write'
  END;
  v_actor_kind := CASE
    WHEN api.current_credential_id() IS NOT NULL THEN 'credential'
    WHEN api.current_user_id() IS NOT NULL THEN 'user'
    ELSE 'unknown'
  END;
  IF v_actor_kind = 'credential' THEN
    v_scope_ok := coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? v_required_scope;
  END IF;
  IF v_kind = 'dataset_rows.commit' THEN
    v_create_only := NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p_operation->'rows', '[]'::jsonb)) row_item
      WHERE coalesce(row_item->>'operation', '') IS DISTINCT FROM 'create'
    );
  END IF;

  IF v_risk = 'consequential_write' THEN
    SELECT policy.*
      INTO v_policy
      FROM api.agent_operation_policies policy
     WHERE policy.workspace_id = p_workspace_id
       AND policy.operation_kind = v_kind
       AND internal.agent_operation_policy_matches(
         policy, p_workspace_id, p_operation, v_target
       )
     ORDER BY CASE policy.target_type
       WHEN 'dataset' THEN 0
       WHEN 'project' THEN 1
       WHEN 'workspace' THEN 2
       ELSE 3
     END, policy.created_at DESC
     LIMIT 1;
    v_target_matched := v_policy.id IS NOT NULL;
    IF v_target_matched THEN
      v_policy_id := v_policy.id;
      v_policy_limits := v_policy.limits;
      IF v_policy.limits ? 'maxAffectedRows' THEN
        v_max_rows := (v_policy.limits->>'maxAffectedRows')::integer;
        v_limit_satisfied := v_affected_rows <= v_max_rows;
      END IF;
    END IF;
  END IF;

  IF NOT v_scope_ok THEN
    v_approval_policy := 'human_required';
    v_reason := format('External credential lacks required scope %s.', v_required_scope);
  ELSIF v_risk = 'safe_draft' THEN
    v_approval_policy := 'automatic';
    v_reason := 'Safe draft creation or update is reversible and executes automatically by default.';
  ELSIF NOT v_target_matched THEN
    v_approval_policy := 'human_required';
    v_reason := 'Consequential Dataset writes require human approval unless a matching credential-bound delegation policy applies.';
  ELSIF NOT v_create_only THEN
    v_approval_policy := 'human_required';
    v_reason := 'Automatic Dataset writes are limited to create and append rows. Updates and overwrites remain human-required.';
  ELSIF NOT v_limit_satisfied THEN
    v_approval_policy := 'human_required';
    v_reason := 'The matching delegation policy limit would be exceeded.';
  ELSE
    v_approval_policy := 'delegated';
    v_reason := 'The matching owner or steward delegation policy permits this bounded create or append.';
  END IF;

  RETURN jsonb_build_object(
    'riskClass', v_risk,
    'approvalPolicy', v_approval_policy,
    'policyId', v_policy_id,
    'policyReason', v_reason,
    'policyLimits', v_policy_limits,
    'policyTarget', coalesce(v_target, '{}'::jsonb),
    'policyEvidence', jsonb_build_object(
      'actorKind', v_actor_kind,
      'credentialId', api.current_credential_id(),
      'requiredScope', v_required_scope,
      'scopeSatisfied', v_scope_ok,
      'targetMatched', v_target_matched,
      'createOnly', v_create_only,
      'affectedRows', v_affected_rows,
      'maxAffectedRows', v_max_rows,
      'limitSatisfied', v_limit_satisfied,
      'riskClass', v_risk,
      'evaluatedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
END;
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
