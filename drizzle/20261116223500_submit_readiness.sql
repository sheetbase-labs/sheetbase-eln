-- Honest readiness before an experiment is submitted and signed.
--
-- An experiment with open protocol steps and no recorded decision used to show
-- "Ready" and could be approved and signed. The readiness list now also names:
--
--   * protocol steps nobody has finished, and
--   * a missing decision (the Results tab's supported / refuted / inconclusive).
--
-- Whether those stop the submission is an admin choice, kept on the workspace:
-- api.workspace_settings.submit_readiness_mode is `off` (not checked), `warn`
-- (listed, never stops; the default) or `block` (listed and stops the submit).
--
--   * api.set_submit_readiness_mode(workspace, mode): the admin setting.
--   * api.experiment_readiness: adds openSteps, decisionMissing and mode, and
--     `ready` follows the mode. The submit RPC already gates on `ready`.

ALTER TABLE api.workspace_settings
    ADD COLUMN submit_readiness_mode text DEFAULT 'warn' NOT NULL;
--> statement-breakpoint
ALTER TABLE api.workspace_settings
    ADD CONSTRAINT chk_workspace_settings_submit_readiness_mode
    CHECK (submit_readiness_mode IN ('off', 'warn', 'block'));
--> statement-breakpoint

CREATE FUNCTION api.set_submit_readiness_mode(p_workspace_id uuid, p_mode text) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'signatures', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('off', 'warn', 'block') THEN
    RAISE EXCEPTION 'invalid submit readiness mode' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, submit_readiness_mode, created_by_user_id)
  VALUES (p_workspace_id, p_mode, api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET submit_readiness_mode = p_mode, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'submit_readiness', 'mode', v.submit_readiness_mode));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_submit_readiness_mode(p_workspace_id uuid, p_mode text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_submit_readiness_mode(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_submit_readiness_mode(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.experiment_readiness(p_record_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_revision uuid;
  v_validation jsonb := '[]'::jsonb;
  v_comments jsonb := '[]'::jsonb;
  v_required jsonb := '[]'::jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_decision_missing boolean := false;
  v_mode text;
  v_instance record;
  v_param jsonb;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'view');

  SELECT r.id INTO v_revision FROM api.revisions r
   WHERE r.record_id = p_record_id
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 1;

  -- 1. Validation errors: the checks that did not pass on the latest revision.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'revisionId', c.revision_id,
           'checkDefinitionKey', c.check_definition_key,
           'checkDefinitionVersion', c.check_definition_version,
           'overallStatus', c.overall_status,
           'blockingFailures', c.blocking_failure_count,
           'warningFailures', c.warning_failure_count,
           'results', c.results,
           'runAt', c.run_at)
         ORDER BY c.run_at DESC), '[]'::jsonb)
    INTO v_validation
    FROM api.review_check_results c
   WHERE c.record_id = p_record_id
     AND c.overall_status <> 'pass'
     AND (v_revision IS NULL OR c.revision_id = v_revision);

  -- 2. Open comment threads. A reply lives under its thread, so only roots count.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'commentId', cm.id,
           'body', cm.body,
           'authorUserId', cm.author_user_id,
           'target', cm.target,
           'createdAt', cm.created_at)
         ORDER BY cm.created_at), '[]'::jsonb)
    INTO v_comments
    FROM api.comments cm
   WHERE cm.record_id = p_record_id
     AND cm.root_id = cm.id
     AND cm.state = 'open';

  -- 3. Required Sheet parameters with no value and no binding.
  FOR v_instance IN
    SELECT i.id, i.name, i.source_definition_version_id, i.state
      FROM api.sheet_instances i
     WHERE i.notebook_record_id = p_record_id
       AND i.lifecycle <> 'archived'
     ORDER BY i.created_at, i.id
  LOOP
    FOR v_param IN
      SELECT value
        FROM jsonb_array_elements(coalesce(
          (SELECT v.configuration->'parameters'
             FROM api.sheet_definition_versions v
            WHERE v.id = v_instance.source_definition_version_id),
          '[]'::jsonb))
    LOOP
      CONTINUE WHEN coalesce((v_param->>'required')::boolean, false) IS NOT TRUE;
      CONTINUE WHEN v_param ? 'defaultValue';
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(v_instance.state->'parameterValues', '[]'::jsonb)) pv
         WHERE pv->>'parameterId' = v_param->>'id');
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(coalesce(v_instance.state->'bindings', '[]'::jsonb)) b
         WHERE b->>'parameterId' = v_param->>'id');
      v_required := v_required || jsonb_build_array(jsonb_build_object(
        'instanceId', v_instance.id,
        'instanceName', v_instance.name,
        'parameterId', v_param->>'id',
        'parameterKey', v_param->>'key',
        'label', v_param->>'label'));
    END LOOP;
  END LOOP;

  -- 4. Protocol steps nobody has finished, in notebook order.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'blockId', b.id,
           'partId', b.payload->>'partId',
           'stepNumber', b.payload->'stepNumber',
           'text', btrim(b.payload->>'text'))
         ORDER BY b."order", b.created_at), '[]'::jsonb)
    INTO v_steps
    FROM api.blocks b
   WHERE b.record_id = p_record_id
     AND b.type = 'procedure_step'
     AND btrim(coalesce(b.payload->>'text', '')) <> ''
     AND coalesce((b.payload->>'completed')::boolean, false) IS NOT TRUE;

  -- 5. No decision recorded on the Results tab.
  v_decision_missing := v_record.decision IS NULL;

  SELECT coalesce(
           (SELECT s.submit_readiness_mode FROM api.workspace_settings s
             WHERE s.workspace_id = v_record.workspace_id),
           'warn')
    INTO v_mode;

  RETURN jsonb_build_object(
    'recordId', p_record_id,
    -- The list shows every check that did not pass, so the author can see warnings
    -- too; only a blocking failure stops submission. Open steps and a missing
    -- decision stop it only when the workspace's readiness mode is `block`.
    'ready', NOT EXISTS (
               SELECT 1 FROM api.review_check_results c
                WHERE c.record_id = p_record_id
                  AND c.blocking_failure_count > 0
                  AND (v_revision IS NULL OR c.revision_id = v_revision))
             AND jsonb_array_length(v_comments) = 0
             AND jsonb_array_length(v_required) = 0
             AND (v_mode <> 'block'
                  OR (jsonb_array_length(v_steps) = 0 AND NOT v_decision_missing)),
    'mode', v_mode,
    'validationErrors', v_validation,
    'openCommentThreads', v_comments,
    'emptyRequiredFields', v_required,
    'openSteps', CASE WHEN v_mode = 'off' THEN '[]'::jsonb ELSE v_steps END,
    'decisionMissing', v_mode <> 'off' AND v_decision_missing);
END $$;
