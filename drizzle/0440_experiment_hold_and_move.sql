-- EXP-03 / ADMIN-05 — put an experiment on hold, and move a draft to another project.
--
-- The experiments list has had an On hold tab since the lifecycle landed, but
-- `api.set_experiment_status` could not reach it: its allowed transitions were
-- the review loop only. Holding is a decision about the experiment, not about
-- its evidence, so it needs the same reason the other transitions need and the
-- same edit authority, and nothing else. Resuming returns to `in_progress`.
--
-- A draft started in the wrong project could never be moved (the form defaults
-- to the first project the caller can edit). `api.move_record_to_project` moves
-- a draft experiment, and only a draft: nothing yet depends on its project.
-- Drafts that already own sheets or bookings stay put, because those rows carry
-- the project of the notebook they were made in.
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
     OR p_status NOT IN ('draft', 'in_progress', 'on_hold', 'in_review', 'returned', 'approved') THEN
    RAISE EXCEPTION 'invalid experiment status' USING ERRCODE = '22023';
  END IF;
  IF v_record.status = p_status THEN
    RAISE EXCEPTION 'experiment already has that status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'in_progress' AND v_record.status = 'draft' THEN
    RAISE EXCEPTION 'start an experiment with api.start_experiment' USING ERRCODE = 'SB109';
  END IF;
  IF NOT (
       (v_record.status = 'in_progress' AND p_status IN ('in_review', 'on_hold'))
    OR (v_record.status = 'on_hold' AND p_status = 'in_progress')
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

CREATE OR REPLACE FUNCTION "api"."move_record_to_project"(
  p_record_id uuid,
  p_project_id uuid,
  p_expected_metadata_version bigint
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record api.records;
  v_from uuid;
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
  IF v_record.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft experiment can move to another project' USING ERRCODE = 'SB109';
  END IF;
  IF v_record.project_id IS NOT DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'experiment is already in that project' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.projects
     WHERE id = p_project_id AND workspace_id = v_record.workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in the active workspace' USING ERRCODE = '42501';
  END IF;
  IF internal.project_is_archived(p_project_id) THEN
    RAISE EXCEPTION 'project is archived' USING ERRCODE = 'SB004';
  END IF;
  IF v_record.project_id IS NULL
     OR NOT internal.can_edit_project(v_record.project_id)
     OR NOT internal.can_edit_project(p_project_id) THEN
    RAISE EXCEPTION 'project edit authority required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM api.sheet_instances WHERE notebook_record_id = v_record.id)
     OR EXISTS (
       SELECT 1 FROM api.calendar_bookings WHERE linked_experiment_record_id = v_record.id
     ) THEN
    RAISE EXCEPTION 'a draft with sheets or bookings cannot move to another project'
      USING ERRCODE = 'SB109';
  END IF;

  v_from := v_record.project_id;
  UPDATE api.records
     SET project_id = p_project_id,
         folder_id = NULL,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_record;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update',
    v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'experiment_moved',
      'fromProjectId', v_from, 'toProjectId', p_project_id));
  RETURN v_record;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."move_record_to_project"(uuid, uuid, bigint) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."move_record_to_project"(uuid, uuid, bigint) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
