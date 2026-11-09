-- Start a pipeline run from outside the app: by the pipeline's key, on its
-- latest published version, as the person the token belongs to. The run is
-- queued for a worker the same way a run started on the pipeline page is, and
-- is followed on pipeline_runs.
--
-- Asking again with the same parameters and inputs after a run succeeded
-- returns that run; after one failed, a new attempt is made by retrying from
-- the pipeline page (the database refuses to guess).
CREATE FUNCTION api.run_pipeline(
    p_pipeline_key text,
    p_parameters jsonb DEFAULT '{}'::jsonb,
    p_input_versions jsonb DEFAULT '{}'::jsonb
) RETURNS api.pipeline_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_definition api.pipeline_definitions;
  v_version_id uuid;
BEGIN
  IF v_workspace_id IS NULL OR api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'a person must start a pipeline run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_definition FROM api.pipeline_definitions
   WHERE workspace_id = v_workspace_id AND key = p_pipeline_key;
  IF v_definition.id IS NULL THEN
    RAISE EXCEPTION 'pipeline not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT v.id INTO v_version_id FROM api.pipeline_definition_versions v
   WHERE v.definition_id = v_definition.id AND v.lifecycle = 'published'
   ORDER BY v.version DESC LIMIT 1;
  IF v_version_id IS NULL THEN
    RAISE EXCEPTION 'only published Pipeline versions can be run' USING ERRCODE = 'SB072';
  END IF;
  RETURN api.start_pipeline_run(
    v_workspace_id, v_version_id, 'manual',
    coalesce(p_parameters, '{}'::jsonb), coalesce(p_input_versions, '{}'::jsonb),
    NULL, NULL, NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_pipeline(text, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_pipeline(text, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_pipeline(text, jsonb, jsonb) TO authenticated;
