-- Pipelines: remind the people a waiting run asked, from the run's panel on
-- Starts and runs.
--
-- It goes to each person's own notifications (and so their channels and preferences) as a
-- waiting run; at most one reminder per person per run an hour. Returns how
-- many were reminded: nobody when the run was not asked of anyone by name.
CREATE FUNCTION api.remind_pipeline_run(p_workspace_id uuid, p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_run api.pipeline_runs;
  v_prompt api.pipeline_run_prompts;
  v_name text;
  v_user text;
  v_count integer := 0;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.runs') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs work.runs' USING ERRCODE = '42501';
  END IF;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id;
  IF v_run IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_run.status <> 'waiting' THEN
    RAISE EXCEPTION 'run is not waiting for a person' USING ERRCODE = 'SB042';
  END IF;
  SELECT * INTO v_prompt FROM api.pipeline_run_prompts
   WHERE run_id = p_run_id AND answered_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_prompt IS NULL THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(d.display_id || ' ' || d.name, d.name) INTO v_name
    FROM api.pipeline_definition_versions v
    JOIN api.pipeline_definitions d ON d.id = v.definition_id
   WHERE v.id = v_run.definition_version_id;
  FOREACH v_user IN ARRAY v_prompt.asked_user_ids LOOP
    IF v_user IS NOT DISTINCT FROM api.current_user_id()
       OR NOT internal.notification_recipient_enabled(v_user, 'run_waiting')
       OR EXISTS (
         SELECT 1 FROM internal.notifications n
          WHERE n.user_id = v_user
            AND n.dedupe_tag = 'remind:' || p_run_id::text
            AND n.created_at > now() - interval '1 hour') THEN
      CONTINUE;
    END IF;
    INSERT INTO internal.notifications
      (workspace_id, user_id, event_type, title, body, dedupe_tag, link)
    VALUES (
      p_workspace_id, v_user, 'run_waiting',
      v_name || ' is still waiting for you',
      'Open the run to answer it.',
      'remind:' || p_run_id::text,
      '/pipelines/runs/' || p_run_id::text);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint


ALTER FUNCTION api.remind_pipeline_run(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint


REVOKE ALL ON FUNCTION api.remind_pipeline_run(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint


GRANT EXECUTE ON FUNCTION api.remind_pipeline_run(uuid, uuid)
  TO authenticated, api_client;
