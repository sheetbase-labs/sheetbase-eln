-- A run that waits for a job on an HPC queue can be cancelled, like a running
-- one. A run that waits for a person is moved on by answering its prompt, so
-- it is still not cancelled here; only a run with an open remote job is. The
-- job itself is stopped on the cluster by the next sweep, which sees that its
-- run is no longer waiting.
CREATE OR REPLACE FUNCTION api.cancel_pipeline_run(p_workspace_id uuid, p_run_id uuid) RETURNS api.pipeline_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_runs;
  v_waits_on_job boolean;
BEGIN IF api.has_capability(api.current_workspace_id(), 'work.runs') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.runs' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR NO KEY UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  v_waits_on_job := v.status = 'waiting' AND EXISTS (
    SELECT 1 FROM api.pipeline_remote_jobs j
     WHERE j.run_id = v.id AND j.state IN ('submitted', 'running'));
  IF v.status <> 'running' AND NOT v_waits_on_job THEN
    RAISE EXCEPTION 'run is not running' USING ERRCODE = 'SB042';
  END IF;
  -- The run actor (or a steward) may cancel; other writers cannot.
  IF api.current_user_id() IS DISTINCT FROM v.actor_user_id
     AND NOT api.has_capability(p_workspace_id, 'pipelines.manage') THEN
    RAISE EXCEPTION 'only the run actor or a Pipeline manager may cancel a run' USING ERRCODE = '42501';
  END IF;
  -- Record the cancellation reason while the run is still 'running'
  -- (append_pipeline_run_log only accepts running runs).
  IF v.status = 'running' THEN
    PERFORM api.append_pipeline_run_log(
      p_workspace_id, v.id, 'warning', 'cancel',
      'Run cancelled by a workspace writer.', '{}'::jsonb
    );
  END IF;
  UPDATE api.pipeline_runs SET
    status = 'cancelled', finished_at = now(),
    error_code = 'cancelled', error_message = 'run cancelled by user'
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
