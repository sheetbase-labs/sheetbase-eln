-- Advanced mode: a push of the version file (from git, the command line, the API
-- or an SDK) records who pushed, when, and the commit it came from, on the
-- draft it saved. The editor shows it as "Last push". Recording never changes
-- the draft's configuration or revision, and never publishes.
ALTER TABLE api.pipeline_definition_versions
  ADD COLUMN pushed_at timestamp with time zone,
  ADD COLUMN pushed_by_user_id text REFERENCES internal."user"(id) ON DELETE SET NULL,
  ADD COLUMN push_commit text,
  ADD CONSTRAINT chk_pipeline_definition_versions_push_commit
    CHECK (push_commit IS NULL OR char_length(push_commit) BETWEEN 1 AND 80);
--> statement-breakpoint

COMMENT ON COLUMN api.pipeline_definition_versions.pushed_at IS 'When the version file was last pushed into this draft.';
--> statement-breakpoint
COMMENT ON COLUMN api.pipeline_definition_versions.pushed_by_user_id IS 'Who last pushed the version file into this draft.';
--> statement-breakpoint
COMMENT ON COLUMN api.pipeline_definition_versions.push_commit IS 'The commit the pushed file came from, when the pusher said.';
--> statement-breakpoint

CREATE FUNCTION api.record_pipeline_version_push(p_workspace_id uuid, p_version_id uuid, p_commit text DEFAULT NULL) RETURNS api.pipeline_definition_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.pipeline_definition_versions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Pipeline versions may be pushed to' USING ERRCODE = 'SB072';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    pushed_at = now(),
    pushed_by_user_id = api.current_user_id(),
    push_commit = NULLIF(btrim(p_commit), '')
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_pipeline_version_push(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_pipeline_version_push(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_pipeline_version_push(uuid, uuid, text) TO authenticated;
