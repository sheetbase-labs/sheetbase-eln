-- Pipelines and plugins reach the API, MCP, the assistant, pipelines and
-- webhooks.
--
--   * run a given published version, or retry a failed or cancelled run, as
--     the person the token belongs to (`run_pipeline` by key is #491's)
--   * plugin change events say what changed (installed, updated, switched on,
--     switched off, removed), so webhooks and pipeline triggers can tell them
--     apart, and no longer carry the whole manifest
--   * the webhook event names gain the pipeline and plugin events

-- ---------------------------------------------------------------------------
-- Run a given version
-- ---------------------------------------------------------------------------
-- Like run_pipeline, but for one exact published version, so a script that
-- tested version 4 runs version 4 even after version 5 is published.
CREATE FUNCTION api.run_pipeline_version(
    p_version_id uuid,
    p_parameters jsonb DEFAULT '{}'::jsonb,
    p_input_versions jsonb DEFAULT '{}'::jsonb
) RETURNS api.pipeline_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'a person must start a pipeline run' USING ERRCODE = '42501';
  END IF;
  RETURN api.start_pipeline_run(
    v_workspace_id, p_version_id, 'manual',
    coalesce(p_parameters, '{}'::jsonb), coalesce(p_input_versions, '{}'::jsonb),
    NULL, NULL, NULL);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.run_pipeline_version(uuid, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.run_pipeline_version(uuid, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.run_pipeline_version(uuid, jsonb, jsonb) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Retry a run
-- ---------------------------------------------------------------------------
-- Runs a failed or cancelled run again, on the same version with the same
-- parameters and inputs, as the Retry button does. The new run points back at
-- the old one (`retry_of_run_id`) and its attempt number goes up by one.
CREATE FUNCTION api.retry_pipeline_run(p_run_id uuid) RETURNS api.pipeline_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_run api.pipeline_runs;
BEGIN
  IF v_workspace_id IS NULL OR api.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'a person must start a pipeline run' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_run FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = v_workspace_id;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'pipeline run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_run.status NOT IN ('failed', 'cancelled') THEN
    RAISE EXCEPTION 'only a failed or cancelled run can be retried' USING ERRCODE = 'SB034';
  END IF;
  -- A scheduled or event run is retried as the same occurrence, so the
  -- schedule does not fire it a second time; a manual run stays manual.
  RETURN api.start_pipeline_run(
    v_workspace_id, v_run.definition_version_id, v_run.trigger_kind,
    v_run.parameters, v_run.input_versions, v_run.id,
    v_run.trigger_occurrence_id, v_run.schedule_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.retry_pipeline_run(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.retry_pipeline_run(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.retry_pipeline_run(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Plugin change events say what changed
-- ---------------------------------------------------------------------------
-- The row change carries `change`: installed, updated (a new version or
-- manifest), enabled, disabled or removed. Switching one part on or off and
-- applying a field type send their own events (set_extension_point_enabled,
-- set_field_plugin_type), so an update that only changes the switched-off
-- parts sends nothing more. The manifest stays out: it can be large, and the
-- install is on `extensions`.
CREATE OR REPLACE FUNCTION internal.trg_change_event_extension() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_op text;
  v_row api.extensions;
  v_change text;
BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_row := NEW; v_change := 'installed';
    WHEN 'DELETE' THEN v_op := 'delete'; v_row := OLD; v_change := 'removed';
    ELSE
      v_op := 'update'; v_row := NEW;
      IF NEW.version IS DISTINCT FROM OLD.version
         OR NEW.manifest IS DISTINCT FROM OLD.manifest
         OR NEW.source IS DISTINCT FROM OLD.source
         OR NEW.name IS DISTINCT FROM OLD.name THEN
        v_change := 'updated';
      ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        v_change := CASE WHEN NEW.status = 'enabled' THEN 'enabled' ELSE 'disabled' END;
      ELSE
        RETURN NULL;
      END IF;
  END CASE;
  PERFORM internal.emit_change_event(
    v_row.workspace_id, 'extension', v_row.id, v_op, NULL, NULL,
    jsonb_build_object(
      'change', v_change,
      'id', v_row.id,
      'extensionKey', v_row.key,
      'name', v_row.name,
      'version', v_row.version,
      'status', v_row.status,
      'previousVersion', CASE WHEN TG_OP = 'UPDATE' THEN OLD.version END));
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Webhook event names
-- ---------------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('pipeline.created'),
  ('pipeline.updated'),
  ('pipeline.deleted'),
  ('pipeline.version.created'),
  ('pipeline.version.updated'),
  ('pipeline.version.published'),
  ('pipeline.version.retired'),
  ('pipeline.run.created'),
  ('pipeline.run.updated'),
  ('pipeline.run.succeeded'),
  ('pipeline.run.failed'),
  ('pipeline.run.cancelled'),
  ('pipeline.run.waiting'),
  ('pipeline.schedule.created'),
  ('pipeline.schedule.updated'),
  ('pipeline.schedule.deleted'),
  ('extension.installed'),
  ('extension.updated'),
  ('extension.enabled'),
  ('extension.disabled'),
  ('extension.removed')
ON CONFLICT DO NOTHING;
