-- Keep consequential-write policy evidence accurate for notebook blocks.
--
-- Notebook block inserts are consequential content writes. Their external
-- scope is projects:write (the scope api.insert_block requires), and the
-- human-facing reason must not describe every consequential write as a
-- Dataset write. Delegation for notebook inserts is still not offered.

CREATE OR REPLACE FUNCTION internal.agent_operation_policy_evaluate_core(p_workspace_id uuid, p_operation jsonb, p_contract jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    WHEN v_kind = 'notebook_block.insert' THEN 'projects:write'
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
    v_reason := 'Consequential writes require human approval unless a matching credential-bound delegation policy applies.';
  ELSIF NOT v_create_only THEN
    v_approval_policy := 'human_required';
    v_reason := 'Automatic writes are limited to create and append operations. Updates and overwrites remain human-required.';
  ELSIF NOT v_limit_satisfied THEN
    v_approval_policy := 'human_required';
    v_reason := 'The matching delegation policy limit would be exceeded.';
  ELSE
    v_approval_policy := 'delegated';
    v_reason := 'The matching owner or steward delegation policy permits this bounded create or append write.';
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
$function$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_operation_policy_evaluate_core(uuid, jsonb, jsonb) OWNER TO migrator;
