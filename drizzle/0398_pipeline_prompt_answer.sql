-- PIPE-02.2/.3 — answering a prompt is one attributable act.
--
-- The executor stops a run in `waiting` with a prompt naming the people asked. This
-- is the only way that prompt is answered, so the decision cannot be written without
-- the person who made it: the caller must be one of the asked users, the prompt must
-- be unanswered and unexpired, and the answer, its author and its time are written
-- together (the table's check enforces the same invariant).
--
-- The decision is recorded in the run's history as a change event attributed to the
-- answering user, which is what "recorded under the person's name" means here. The
-- run's own status is left to the executor: answering records the decision, it does
-- not silently restart the run.

CREATE OR REPLACE FUNCTION api.answer_pipeline_run_prompt(
  p_prompt_id uuid,
  p_answer jsonb
)
RETURNS api.pipeline_run_prompts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row api.pipeline_run_prompts;
  v_me text := api.current_user_id();
BEGIN
  SELECT * INTO v_row FROM api.pipeline_run_prompts WHERE id = p_prompt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown prompt' USING ERRCODE='22023';
  END IF;
  IF v_row.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace mismatch' USING ERRCODE='42501';
  END IF;
  IF NOT (v_me = ANY (v_row.asked_user_ids)) THEN
    RAISE EXCEPTION 'This prompt did not ask you' USING ERRCODE='42501';
  END IF;
  IF v_row.answer IS NOT NULL THEN
    RAISE EXCEPTION 'This prompt is already answered' USING ERRCODE='22023';
  END IF;
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= now() THEN
    RAISE EXCEPTION 'This prompt has expired' USING ERRCODE='22023';
  END IF;
  IF p_answer IS NULL THEN
    RAISE EXCEPTION 'An answer is required' USING ERRCODE='22023';
  END IF;

  UPDATE api.pipeline_run_prompts
     SET answer = p_answer,
         answered_by_user_id = v_me,
         answered_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(
    v_row.workspace_id,
    'pipeline_run',
    v_row.run_id,
    'update',
    NULL,
    NULL,
    jsonb_build_object(
      'decision', 'prompt_answered',
      'stepId', v_row.step_id,
      'promptId', v_row.id,
      'answeredBy', v_me,
      'answer', p_answer
    )
  );

  RETURN v_row;
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.answer_pipeline_run_prompt(uuid, jsonb) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.answer_pipeline_run_prompt(uuid, jsonb) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
