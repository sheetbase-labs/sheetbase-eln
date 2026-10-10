-- EXP-03 / LAB-07 — a controlled experiment lifecycle with a server start gate.
--
-- Starting an experiment is the point where PROJ-03 (`require_effective_protocol`)
-- and LAB-07 (effective version, exact-version acknowledgement) become authority,
-- so it is a server decision, not a UI one. `api.start_experiment` is the only
-- transition out of `draft`; `api.set_experiment_status` owns the rest of the
-- lifecycle with allowed transitions and reasons. Experiments keep the version
-- they started on.
ALTER TABLE "api"."records"
  ADD CONSTRAINT "records_protocol_version_id_fk"
  FOREIGN KEY ("protocol_version_id") REFERENCES "api"."protocol_versions"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "idx_records_protocol_version" ON "api"."records" ("protocol_version_id");
--> statement-breakpoint

-- The protocol version an experiment started on, resolved from the explicit
-- argument or (when the project requires an effective protocol) its current pin.
CREATE OR REPLACE FUNCTION "api"."start_experiment"(
  p_record_id uuid,
  p_expected_metadata_version bigint,
  p_protocol_version_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record api.records;
  v_project api.projects;
  v_version api.protocol_versions;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF v_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft experiment can start' USING ERRCODE = 'SB109';
  END IF;
  IF p_expected_metadata_version IS NULL
     OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  IF v_record.project_id IS NULL THEN
    RAISE EXCEPTION 'an experiment needs a project' USING ERRCODE = '22023';
  END IF;
  IF NOT internal.can_edit_project(v_record.project_id) THEN
    RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_project FROM api.projects
   WHERE id = v_record.project_id AND workspace_id = v_record.workspace_id;

  -- An explicit version wins; otherwise a project that requires an effective
  -- protocol starts on its current pin.
  IF p_protocol_version_id IS NOT NULL THEN
    SELECT * INTO v_version FROM api.protocol_versions
     WHERE id = p_protocol_version_id AND workspace_id = v_record.workspace_id;
    IF v_version.id IS NULL THEN
      RAISE EXCEPTION 'protocol version not found in the active workspace' USING ERRCODE = '42501';
    END IF;
  ELSIF v_project.require_effective_protocol THEN
    SELECT pv.* INTO v_version FROM api.project_protocols pp
      JOIN api.protocol_versions pv ON pv.id = pp.protocol_version_id
     WHERE pp.project_id = v_record.project_id
       AND pp.workspace_id = v_record.workspace_id;
  END IF;

  IF v_version.id IS NULL THEN
    IF v_project.require_effective_protocol THEN
      RAISE EXCEPTION 'project requires an effective protocol version' USING ERRCODE = 'SB110';
    END IF;
  ELSE
    -- Lifecycle eligibility, exact-version acknowledgement (LAB-07 training) and
    -- the project's exact pin where it requires one.
    PERFORM internal.assert_protocol_start_eligible(
      v_version.id, api.current_user_id(), v_record.project_id);
  END IF;

  UPDATE api.records
     SET status = 'in_progress',
         protocol_version_id = v_version.id,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_started',
      'protocolVersionId', v_version.id, 'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  RETURN v_record;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."start_experiment"(uuid, bigint, uuid, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."start_experiment"(uuid, bigint, uuid, text) TO authenticated;
--> statement-breakpoint

-- The rest of the controlled lifecycle. `draft -> in_progress` is deliberately
-- absent: only api.start_experiment may start an experiment, so the start gate
-- cannot be bypassed.
CREATE OR REPLACE FUNCTION "api"."set_experiment_status"(
  p_record_id uuid,
  p_expected_metadata_version bigint,
  p_status text,
  p_reason text
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record api.records;
BEGIN
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL FOR UPDATE;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_record.kind <> 'experiment' THEN
    RAISE EXCEPTION 'not an experiment' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_record.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NULL
     OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('draft', 'in_progress', 'in_review', 'returned', 'approved') THEN
    RAISE EXCEPTION 'invalid experiment status' USING ERRCODE = '22023';
  END IF;
  IF v_record.status = p_status THEN
    RAISE EXCEPTION 'experiment already has that status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'in_progress' AND v_record.status = 'draft' THEN
    RAISE EXCEPTION 'start an experiment with api.start_experiment' USING ERRCODE = 'SB109';
  END IF;
  IF NOT (
       (v_record.status = 'in_progress' AND p_status = 'in_review')
    OR (v_record.status = 'in_review' AND p_status IN ('returned', 'approved'))
    OR (v_record.status = 'returned' AND p_status = 'in_progress')
    OR (v_record.status = 'approved' AND p_status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'illegal experiment status transition' USING ERRCODE = 'SB111';
  END IF;
  IF v_record.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'record is locked; create an amendment instead' USING ERRCODE = 'SB112';
  END IF;
  IF p_status IN ('returned', 'approved') THEN
    IF v_record.project_id IS NULL OR NOT internal.can_review_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project review authority required' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_record.project_id IS NULL OR NOT internal.can_edit_project(v_record.project_id) THEN
      RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF v_record.status <> 'draft'
     AND (p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000) THEN
    RAISE EXCEPTION 'a transition reason is required' USING ERRCODE = '22023';
  END IF;

  UPDATE api.records
     SET status = p_status,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_status', 'status', p_status,
      'reason', btrim(coalesce(p_reason, ''))));
  RETURN v_record;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."set_experiment_status"(uuid, bigint, text, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."set_experiment_status"(uuid, bigint, text, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
