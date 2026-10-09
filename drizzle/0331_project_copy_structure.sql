-- PROJ-01 — atomically copy a project's structure.
--
-- Copies the project's milestones (study tasks) and their deliverables into a
-- new project created through the canonical RPC. Completion is reset and no
-- source records, study records or evidence are copied: a copied milestone
-- starts not_started with no progress and no linked record, and its
-- deliverables are planned. Source authority is explicit project management,
-- not workspace membership or read access, and the source revision must match.
CREATE FUNCTION api.create_project_from_structure(
  p_source_project_id uuid,
  p_expected_source_revision bigint,
  p_title text,
  p_client_id uuid DEFAULT NULL,
  p_modality text DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_lead_user_id text DEFAULT NULL,
  p_default_reviewer_user_id text DEFAULT NULL,
  p_agreement_reference text DEFAULT NULL,
  p_started_on date DEFAULT NULL
) RETURNS api.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_source api.projects;
  v_target api.projects;
  v_task api.study_tasks;
  v_new_task uuid;
BEGIN
  SELECT * INTO v_source FROM api.projects WHERE id = p_source_project_id FOR UPDATE;
  IF v_source.id IS NULL OR v_source.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'source project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  -- Explicit management of the source is required; read access is not enough.
  IF NOT internal.can_manage_project(v_source.id) THEN
    RAISE EXCEPTION 'source project management required' USING ERRCODE = '42501';
  END IF;
  IF p_expected_source_revision IS NULL OR p_expected_source_revision IS DISTINCT FROM v_source.revision THEN
    RAISE EXCEPTION 'stale source project revision' USING ERRCODE = 'SB001';
  END IF;

  v_target := api.create_project(
    p_title, p_client_id, p_modality, p_stage, p_lead_user_id,
    p_default_reviewer_user_id, p_agreement_reference, p_started_on
  );

  FOR v_task IN
    SELECT * FROM api.study_tasks WHERE project_id = v_source.id ORDER BY position, created_at
  LOOP
    INSERT INTO api.study_tasks(
      workspace_id, project_id, title, description, task_type, status, priority,
      starts_at, ends_at, due_at, timezone, position, color, progress_percent,
      approval_required, tags, created_by_user_id
    ) VALUES (
      v_target.workspace_id, v_target.id, v_task.title, v_task.description,
      v_task.task_type, 'not_started', v_task.priority, v_task.starts_at,
      v_task.ends_at, v_task.due_at, v_task.timezone, v_task.position,
      v_task.color, 0, v_task.approval_required, v_task.tags, api.current_user_id()
    )
    RETURNING id INTO v_new_task;

    INSERT INTO api.study_deliverables(
      workspace_id, task_id, name, description, status, due_at
    )
    SELECT v_target.workspace_id, v_new_task, d.name, d.description, 'planned', d.due_at
    FROM api.study_deliverables d WHERE d.task_id = v_task.id;
  END LOOP;

  PERFORM internal.emit_change_event(v_target.workspace_id, 'project', v_target.id, 'create', NULL, v_target.id,
    jsonb_build_object('copiedFrom', v_source.id));
  RETURN v_target;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_project_from_structure(uuid, bigint, text, uuid, text, text, text, text, text, date) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_project_from_structure(uuid, bigint, text, uuid, text, text, text, text, text, date) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
