-- AUTO-04 governance correction: the policy RPC keeps p_credential_id and
-- gains a required reason and e-signature meaning. Drop the two earlier
-- overloads so only the governed one remains.
DROP FUNCTION IF EXISTS api.create_agent_operation_policy(uuid,text,text,text,uuid,jsonb,text,text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS api.create_agent_operation_policy(uuid,text,text,text,uuid,uuid,jsonb);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.create_agent_operation_policy(
  p_workspace_id uuid,
  p_name text,
  p_operation_kind text,
  p_target_type text,
  p_target_id uuid,
  p_credential_id uuid,
  p_limits jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL,
  p_meaning text DEFAULT NULL
) RETURNS api.agent_operation_policies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_policies;
  v_limits jsonb := coalesce(p_limits, '{}'::jsonb);
  v_max integer;
  v_actor text := api.current_user_id();
BEGIN
  PERFORM internal.require_agent_policy_manager(p_workspace_id);
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_meaning, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a signature meaning is required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.user_signature_certifications c
    WHERE c.workspace_id = p_workspace_id AND c.user_id = v_actor AND c.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'signature certification required' USING ERRCODE = '42501';
  END IF;
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
    limits, reason, signed_by_user_id, signed_meaning, signed_at,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, btrim(p_name), p_credential_id, p_operation_kind,
    p_target_type, p_target_id, v_limits, btrim(p_reason), v_actor,
    btrim(p_meaning), now(), v_actor, v_actor
  ) RETURNING * INTO v_result;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'agent_operation_policy', v_result.id, 'create',
    NULL, NULL, jsonb_build_object(
      'name', v_result.name,
      'credentialId', v_result.credential_id,
      'operationKind', v_result.operation_kind,
      'targetType', v_result.target_type,
      'targetId', v_result.target_id,
      'limits', v_result.limits,
      'reason', v_result.reason
    )
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,uuid,jsonb,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_agent_operation_policy(uuid,text,text,text,uuid,uuid,jsonb,text,text) TO authenticated;
