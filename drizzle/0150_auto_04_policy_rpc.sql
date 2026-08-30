-- AUTO-04 policy revision.
--
-- Safe draft operations execute automatically when the actor has the matching
-- canonical external scope. Consequential writes stay human-required unless a
-- workspace owner or steward delegates a bounded canonical target.

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK (
  entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link', 'scientific_table',
    'scientific_row', 'formula', 'calculation', 'record_field_definition',
    'model_field_option', 'file', 'dataset_schema', 'dataset_schema_field',
    'dataset_schema_relationship', 'dataset', 'dataset_version', 'sample_event',
    'comment', 'review_submission', 'signature', 'review_decision', 'storage_site',
    'storage_room', 'storage_unit', 'storage_shelf', 'storage_rack', 'storage_box',
    'storage_position', 'storage_movement', 'plate_design', 'plate_well',
    'plate_layout_template', 'calendar_resource', 'calendar_booking',
    'calendar_booking_participant', 'calendar_booking_sample', 'study_workstream',
    'study_task', 'study_task_dependency', 'study_task_assignment',
    'study_task_resource', 'study_deliverable', 'study_project', 'study_experiment',
    'study_plan_snapshot', 'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot', 'instrument_qc_check',
    'instrument_raw_file', 'instrument_run_link', 'report_definition',
    'report_section', 'report_generation', 'sheet_instance', 'sheet_definition',
    'sheet_definition_version', 'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential', 'connector', 'connector_run', 'pipeline_definition',
    'pipeline_definition_version', 'pipeline_run', 'pipeline_schedule',
    'webhook_subscription', 'webhook_delivery', 'agent_operation_policy',
    'agent_operation_proposal'
  )
);
--> statement-breakpoint

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
    IF p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM api.agent_operation_proposals proposal
      WHERE proposal.workspace_id = p_workspace_id
        AND proposal.status = 'executing'
        AND proposal.executed_by_credential_id = api.current_credential_id()
        AND (
          (proposal.operation_kind LIKE 'pipeline_definition.%'
           AND p_capability = 'pipelines.manage'
           AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
          OR (proposal.operation_kind IN (
            'dataset_schema.create',
            'sheet_definition.create',
            'sheet_definition.update_draft'
          ) AND p_capability = 'schema.edit'
          AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
        )
    );
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
  IF session_user = 'migrator' AND v_mask IS NOT NULL THEN
    RETURN p_capability = ANY (
      string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
    );
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.require_agent_policy_manager(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF api.current_user_id() IS NULL
     OR api.current_credential_id() IS NOT NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT (
       api.has_capability(p_workspace_id, 'workspace.admin')
       OR api.is_workspace_member(p_workspace_id, 'steward')
     ) THEN
    RAISE EXCEPTION 'workspace owner or steward required' USING ERRCODE = '42501';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.require_agent_policy_manager(uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.validate_agent_policy_target(
  p_workspace_id uuid,
  p_target_type text,
  p_target_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_target_type = 'workspace' THEN
    IF p_target_id IS NOT NULL AND p_target_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'workspace policy target must be the active workspace' USING ERRCODE = '22023';
    END IF;
    RETURN;
  END IF;
  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'a non-workspace policy target requires an id' USING ERRCODE = '22023';
  END IF;
  IF p_target_type = 'project' AND NOT EXISTS (
    SELECT 1 FROM api.projects WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'project policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'record' AND NOT EXISTS (
    SELECT 1 FROM api.records WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Notebook record policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'dataset' AND NOT EXISTS (
    SELECT 1 FROM api.datasets WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Dataset policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'pipeline_definition' AND NOT EXISTS (
    SELECT 1 FROM api.pipeline_definitions WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Pipeline Definition policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'dataset_schema' AND NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Dataset Schema policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'sheet_definition' AND NOT EXISTS (
    SELECT 1 FROM api.sheet_definitions WHERE id = p_target_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Sheet Definition policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type = 'sheet_definition_version' AND NOT EXISTS (
    SELECT 1
    FROM api.sheet_definition_versions version_row
    JOIN api.sheet_definitions definition ON definition.id = version_row.definition_id
    WHERE version_row.id = p_target_id AND definition.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Sheet Definition Version policy target is outside the active workspace' USING ERRCODE = '42501';
  ELSIF p_target_type NOT IN (
    'project', 'record', 'dataset', 'pipeline_definition', 'dataset_schema',
    'sheet_definition', 'sheet_definition_version'
  ) THEN
    RAISE EXCEPTION 'unsupported policy target type' USING ERRCODE = '22023';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.validate_agent_policy_target(uuid,text,uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_agent_operation_policy(
  p_workspace_id uuid,
  p_name text,
  p_operation_kind text,
  p_target_type text,
  p_target_id uuid,
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
    workspace_id, name, operation_kind, target_type, target_id, limits,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, btrim(p_name), p_operation_kind, p_target_type, p_target_id,
    v_limits, api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v_result;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'agent_operation_policy', v_result.id, 'create',
    NULL, NULL, jsonb_build_object(
      'name', v_result.name,
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

CREATE OR REPLACE FUNCTION api.disable_agent_operation_policy(
  p_workspace_id uuid,
  p_policy_id uuid
) RETURNS api.agent_operation_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_policies;
BEGIN
  PERFORM internal.require_agent_policy_manager(p_workspace_id);
  UPDATE api.agent_operation_policies
     SET enabled = false, updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = p_policy_id AND workspace_id = p_workspace_id
  RETURNING * INTO v_result;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'agent operation policy not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'agent_operation_policy', v_result.id, 'update',
    NULL, NULL, jsonb_build_object('enabled', false)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,jsonb),
  api.disable_agent_operation_policy(uuid,uuid)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,jsonb),
  api.disable_agent_operation_policy(uuid,uuid)
  TO authenticated;
--> statement-breakpoint

CREATE POLICY agent_operation_policies_select
  ON api.agent_operation_policies FOR SELECT TO authenticated
  USING (api.is_workspace_member(workspace_id));
ALTER TABLE api.agent_operation_policies ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.agent_operation_policies TO authenticated;
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
     OR NOT p_policy.enabled THEN
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
REVOKE EXECUTE ON FUNCTION internal.agent_operation_policy_matches(
  api.agent_operation_policies, uuid, jsonb, jsonb
) FROM PUBLIC, authenticated, api_client;
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
    v_reason := 'Consequential Dataset writes require human approval unless a matching delegation policy applies.';
  ELSIF NOT v_limit_satisfied THEN
    v_approval_policy := 'human_required';
    v_reason := 'The matching delegation policy limit would be exceeded.';
  ELSE
    v_approval_policy := 'delegated';
    v_reason := 'The matching owner or steward delegation policy permits this bounded write.';
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
      'requiredScope', v_required_scope,
      'scopeSatisfied', v_scope_ok,
      'targetMatched', v_target_matched,
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

CREATE OR REPLACE FUNCTION api.propose_agent_operation(
  p_workspace_id uuid,
  p_title text,
  p_summary text,
  p_operation jsonb,
  p_provenance jsonb,
  p_idempotency_key text
) RETURNS api.agent_operation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_contract jsonb;
  v_evaluation jsonb;
  v_digest text;
  v_existing api.agent_operation_proposals;
  v_result api.agent_operation_proposals;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace write actor required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(coalesce(p_summary,''))) NOT BETWEEN 1 AND 2000
     OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid proposal metadata' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_provenance) IS DISTINCT FROM 'object'
     OR p_provenance - ARRAY['agentId','agentName','tool','model','invocationId'] <> '{}'::jsonb
     OR length(btrim(p_provenance->>'agentId')) NOT BETWEEN 1 AND 200
     OR length(btrim(p_provenance->>'invocationId')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_provenance->'tool') IS DISTINCT FROM 'object'
     OR length(btrim(p_provenance->'tool'->>'name')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_provenance->'model') IS DISTINCT FROM 'object'
     OR length(btrim(p_provenance->'model'->>'provider')) NOT BETWEEN 1 AND 100
     OR length(btrim(p_provenance->'model'->>'name')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'agent, tool, model, and invocation provenance are required' USING ERRCODE = '22023';
  END IF;

  IF p_operation->>'kind' IN (
       'sheet_definition.update_draft',
       'pipeline_definition.create_version',
       'pipeline_definition.update_draft',
       'dataset_rows.commit'
     )
     AND (
       (
         p_operation->>'kind' = 'pipeline_definition.create_version'
         AND p_operation->>'expectedDefinitionRevision' IS NULL
       )
       OR (
         p_operation->>'kind' <> 'pipeline_definition.create_version'
         AND p_operation->>'expectedRevision' IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'optimistic concurrency revision is required' USING ERRCODE = '22023';
  END IF;

  v_contract := internal.agent_operation_contract(p_workspace_id, p_operation);
  v_evaluation := internal.agent_operation_policy_evaluate(
    p_workspace_id, p_operation, v_contract
  );
  v_digest := encode(sha256(convert_to(jsonb_build_object(
    'workspaceId',p_workspace_id,'title',btrim(p_title),'summary',btrim(p_summary),
    'operation',p_operation,'provenance',p_provenance
  )::text,'UTF8')),'hex');

  SELECT * INTO v_existing
    FROM api.agent_operation_proposals
   WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_digest <> v_digest
       OR v_existing.proposed_by_user_id IS DISTINCT FROM v_actor_user
       OR v_existing.proposed_by_credential_id IS DISTINCT FROM v_actor_credential THEN
      RAISE EXCEPTION 'idempotency key was used for a different proposal' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO api.agent_operation_proposals(
    workspace_id,title,summary,operation_kind,operation,preview,impact,
    risk_class,approval_policy,policy_id,policy_reason,policy_limits,
    policy_target,policy_evidence,idempotency_key,request_digest,provenance,
    proposed_by_user_id,proposed_by_credential_id
  ) VALUES (
    p_workspace_id,btrim(p_title),btrim(p_summary),p_operation->>'kind',
    p_operation,v_contract->'preview',v_contract->'impact',
    v_evaluation->>'riskClass',v_evaluation->>'approvalPolicy',
    nullif(v_evaluation->>'policyId','')::uuid,
    v_evaluation->>'policyReason',v_evaluation->'policyLimits',
    v_evaluation->'policyTarget',v_evaluation->'policyEvidence',
    p_idempotency_key,v_digest,p_provenance,v_actor_user,v_actor_credential
  ) RETURNING * INTO v_result;
  PERFORM internal.agent_operation_append_event(v_result,'proposed',
    jsonb_build_object(
      'operationKind',v_result.operation_kind,
      'requestDigest',v_digest,
      'riskClass',v_result.risk_class,
      'approvalPolicy',v_result.approval_policy,
      'policyId',v_result.policy_id,
      'reason',v_result.policy_reason,
      'limits',v_result.policy_limits,
      'target',v_result.policy_target,
      'evaluation',v_result.policy_evidence
    ));
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'create',
    NULL,NULL,jsonb_build_object(
      'status',v_result.status,
      'operationKind',v_result.operation_kind,
      'riskClass',v_result.risk_class,
      'approvalPolicy',v_result.approval_policy
    )
  );
  IF v_result.approval_policy IN ('automatic', 'delegated') THEN
    PERFORM internal.agent_operation_execute(v_result.id);
    SELECT * INTO v_result
      FROM api.agent_operation_proposals
     WHERE id = v_result.id AND workspace_id = p_workspace_id;
  END IF;
  RETURN v_result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_execute(p_proposal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_proposals;
  v_operation jsonb;
  v_execution jsonb;
  v_pipeline_revision bigint;
  v_code text;
  v_message text;
BEGIN
  SELECT * INTO v_result
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id()
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
  PERFORM internal.agent_operation_append_event(v_result,'execution_started','{}'::jsonb);
  v_operation := v_result.operation;

  BEGIN
    IF v_result.operation_kind = 'dataset_schema.create' THEN
      v_execution := api.create_dataset_schema_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description',v_operation->'fields'
      );
    ELSIF v_result.operation_kind = 'sheet_definition.create' THEN
      v_execution := api.create_sheet_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description',v_operation->'configuration'
      );
    ELSIF v_result.operation_kind = 'sheet_definition.update_draft' THEN
      v_execution := to_jsonb(api.update_sheet_definition_draft(
        (v_operation->>'versionId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.create' THEN
      v_execution := to_jsonb(api.create_pipeline_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.create_version' THEN
      SELECT revision INTO v_pipeline_revision
        FROM api.pipeline_definitions
       WHERE id = (v_operation->>'definitionId')::uuid
         AND workspace_id = v_result.workspace_id
       FOR UPDATE;
      IF v_pipeline_revision IS DISTINCT FROM
         (v_operation->>'expectedDefinitionRevision')::bigint THEN
        RAISE EXCEPTION 'stale Pipeline Definition revision' USING ERRCODE = 'SB001';
      END IF;
      v_execution := to_jsonb(api.create_pipeline_definition_version(
        v_result.workspace_id,(v_operation->>'definitionId')::uuid,
        v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.update_draft' THEN
      v_execution := to_jsonb(api.update_pipeline_definition_version_draft(
        v_result.workspace_id,(v_operation->>'versionId')::uuid,
        (v_operation->>'expectedRevision')::bigint,v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'dataset_rows.commit' THEN
      v_execution := api.commit_dataset_row_batch(
        (v_operation->>'datasetId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->'rows','agent-proposal:' || v_result.id::text
      );
      IF (v_execution->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'canonical Dataset commit rejected: %', v_execution USING ERRCODE = 'SB073';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported or human-only operation kind' USING ERRCODE = '22023';
    END IF;

    UPDATE api.agent_operation_proposals
       SET status = 'succeeded',
           revision = revision + 1,
           result = v_execution,
           error_code = NULL,
           error_message = NULL,
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_succeeded',
      jsonb_build_object('result',v_execution));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    UPDATE api.agent_operation_proposals
       SET status = 'failed',
           revision = revision + 1,
           error_code = v_code,
           error_message = left(v_message,2000),
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_failed',
      jsonb_build_object('errorCode',v_code,'message',left(v_message,2000)));
  END;
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'update',
    NULL,NULL,jsonb_build_object(
      'status',v_result.status,
      'operationKind',v_result.operation_kind,
      'canonicalResult',v_result.result,
      'policyId',v_result.policy_id,
      'approvalPolicy',v_result.approval_policy
    )
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.agent_operation_execute(uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.execute_agent_operation(
  p_proposal_id uuid,
  p_expected_revision bigint
) RETURNS api.agent_operation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_proposals;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required for execution' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_result
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_operation_capability(v_result);
  IF v_result.status <> 'approved' OR v_result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'proposal is not approved at the expected revision' USING ERRCODE = 'SB001';
  END IF;
  PERFORM internal.agent_operation_execute(v_result.id);
  SELECT * INTO v_result
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id();
  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION api.execute_agent_operation(uuid,bigint)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.execute_agent_operation(uuid,bigint)
  TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
