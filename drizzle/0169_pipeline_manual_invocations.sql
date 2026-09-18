CREATE OR REPLACE FUNCTION api.start_pipeline_run(
  p_workspace_id uuid,
  p_definition_version_id uuid,
  p_trigger_kind text DEFAULT 'manual',
  p_parameters jsonb DEFAULT '{}'::jsonb,
  p_input_versions jsonb DEFAULT '{}'::jsonb,
  p_retry_of_run_id uuid DEFAULT NULL,
  p_trigger_occurrence_id text DEFAULT NULL,
  p_schedule_id uuid DEFAULT NULL
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
  v_digest text;
  v_occurrence_run boolean;
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
  -- Scheduled/event runs always carry a stable trigger occurrence identity;
  -- manual runs never do.
  IF p_trigger_occurrence_id IS NOT NULL AND p_trigger_kind = 'manual' AND p_trigger_occurrence_id !~ '^manual:[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'invalid manual invocation identity' USING ERRCODE = 'SB034';
  END IF;
  IF p_trigger_occurrence_id IS NOT NULL AND (
    length(p_trigger_occurrence_id) NOT BETWEEN 8 AND 128
    OR p_trigger_occurrence_id !~ '^[a-z]+:[A-Za-z0-9:_+-]+$'
  ) THEN
    RAISE EXCEPTION 'invalid trigger occurrence identity' USING ERRCODE = 'SB034';
  END IF;
  IF p_schedule_id IS NOT NULL AND p_trigger_kind = 'manual' THEN
    RAISE EXCEPTION 'manual runs cannot carry a schedule identity' USING ERRCODE = 'SB034';
  END IF;
  IF p_schedule_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.pipeline_schedules
     WHERE id = p_schedule_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'schedule not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_definition_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle <> 'published' THEN
    -- Reproducibility: a retry pins the EXACT version the failed/crashed
    -- attempt used, even if that version has since been retired. Only
    -- genuinely new runs must use a currently-published version.
    IF p_retry_of_run_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM api.pipeline_runs
       WHERE id = p_retry_of_run_id
         AND definition_version_id = v_version.id
         AND workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'only published Pipeline versions can be run' USING ERRCODE = 'SB072';
    END IF;
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

  -- The canonical run identity is computed here, from the request the
  -- database already holds: definition version + parameters + input Dataset
  -- Versions (all canonical jsonb). The caller can never choose or forge
  -- the digest, so replay/concurrency/retry decisions are authoritative.
  v_digest := encode(sha256(convert_to(
    jsonb_build_object(
      'definitionVersionId', p_definition_version_id::text,
      'parameters', COALESCE(p_parameters, '{}'::jsonb),
      'inputVersions', COALESCE(p_input_versions, '{}'::jsonb)
    )::text, 'UTF8')), 'hex');

  -- Manual runs dedupe by canonical digest; scheduled/event occurrences
  -- dedupe by their stable trigger occurrence identity.
  v_occurrence_run := p_trigger_occurrence_id IS NOT NULL;
  IF v_occurrence_run THEN
    SELECT * INTO v_existing FROM api.pipeline_runs
     WHERE workspace_id = p_workspace_id
       AND trigger_occurrence_id = p_trigger_occurrence_id
     ORDER BY started_at DESC
     LIMIT 1;
  ELSE
    SELECT * INTO v_existing FROM api.pipeline_runs
     WHERE definition_version_id = p_definition_version_id
       AND input_digest = v_digest
       AND trigger_occurrence_id IS NULL
       AND workspace_id = p_workspace_id
     ORDER BY started_at DESC
     LIMIT 1;
  END IF;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.definition_version_id IS DISTINCT FROM p_definition_version_id OR v_existing.input_digest IS DISTINCT FROM v_digest THEN
      RAISE EXCEPTION 'invocation already used with different inputs or version' USING ERRCODE = 'SB034';
    END IF;
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

  IF p_retry_of_run_id IS NOT NULL THEN
    IF v_retry_of.id IS DISTINCT FROM p_retry_of_run_id THEN
      SELECT * INTO v_retry_of FROM api.pipeline_runs
       WHERE id = p_retry_of_run_id AND workspace_id = p_workspace_id;
      IF v_retry_of IS NULL THEN
        RAISE EXCEPTION 'retry target not found' USING ERRCODE = 'SB036';
      END IF;
    END IF;
    -- Retry lineage must be reproducible: the retry executes the exact
    -- version the failed/crashed attempt used.
    IF v_retry_of.definition_version_id IS DISTINCT FROM p_definition_version_id THEN
      RAISE EXCEPTION 'retry target uses a different Pipeline version' USING ERRCODE = 'SB034';
    END IF;
    IF v_retry_of.trigger_occurrence_id IS DISTINCT FROM p_trigger_occurrence_id THEN
      RAISE EXCEPTION 'retry target does not match the trigger occurrence' USING ERRCODE = 'SB034';
    END IF;
  END IF;

  INSERT INTO api.pipeline_runs(
    workspace_id, definition_version_id, trigger_kind, status, attempt,
    retry_of_run_id, trigger_occurrence_id, schedule_id, input_digest,
    parameters, input_versions, actor_user_id, actor_credential_id
  ) VALUES (
    p_workspace_id, p_definition_version_id, p_trigger_kind, 'running',
    CASE WHEN v_retry_of.id IS NOT NULL THEN v_retry_of.attempt + 1 ELSE 1 END,
    COALESCE(v_retry_of.id, p_retry_of_run_id),
    p_trigger_occurrence_id,
    p_schedule_id,
    v_digest,
    COALESCE(p_parameters, '{}'::jsonb),
    COALESCE(p_input_versions, '{}'::jsonb),
    api.current_user_id(), api.current_credential_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.start_pipeline_run(uuid, uuid, text, jsonb, jsonb, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.start_pipeline_run(uuid, uuid, text, jsonb, jsonb, uuid, text, uuid) TO authenticated;

--> statement-breakpoint

