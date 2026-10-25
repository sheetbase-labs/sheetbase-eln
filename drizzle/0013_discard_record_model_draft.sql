-- Discard an unsubmitted Record Model draft.
--
-- A draft can be abandoned before it is approved: the version row goes, the
-- published version it was started from stays current, and no record ever
-- pointed at it. Published versions are immutable and a draft locked by a
-- pending approval request must be withdrawn first.

CREATE FUNCTION api.discard_record_model_version(p_version_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version "api"."record_model_versions";
BEGIN
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record Model version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_version.workspace_id, 'schema.edit');
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Record Model versions may be discarded' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS (SELECT 1 FROM api.approval_requests r
    WHERE r.object_kind = 'record_model_version' AND r.object_id = v_version.id AND r.state = 'pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  DELETE FROM api.record_model_versions WHERE id = v_version.id;
  PERFORM internal.emit_change_event(v_version.workspace_id, 'record_model_version', v_version.id, 'delete', NULL, NULL,
    jsonb_build_object('modelId', v_version.model_id, 'version', v_version.version));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.discard_record_model_version(p_version_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.discard_record_model_version(p_version_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.discard_record_model_version(p_version_id uuid) TO authenticated;
