-- PROJ-02.2 — milestone RPCs over the existing planner model.
--
-- The decision recorded in the task is that milestones reuse api.study_deliverables
-- rather than a second planning model: it already carries name, description, status,
-- target date and an evidence link. What it lacked was ordering, so this adds a
-- `position` scoped to the owning task and the RPCs the project page needs: create,
-- update, reorder within a task, and link evidence.
ALTER TABLE api.study_deliverables ADD COLUMN IF NOT EXISTS position integer;
--> statement-breakpoint

-- Backfill in a stable order so existing rows have a deterministic position.
UPDATE api.study_deliverables d
   SET position = ordered.rank
  FROM (
    SELECT id, row_number() OVER (PARTITION BY task_id ORDER BY created_at, id) AS rank
      FROM api.study_deliverables
  ) ordered
 WHERE ordered.id = d.id AND d.position IS NULL;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_study_deliverable(
  p_task_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_status text DEFAULT 'planned',
  p_due_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task api.study_tasks;
  v_position integer;
  v_row api.study_deliverables;
BEGIN
  SELECT * INTO v_task FROM api.study_tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT api.is_workspace_writer(v_task.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a milestone name is required' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('planned', 'in_progress', 'delivered', 'overdue') THEN
    RAISE EXCEPTION 'invalid milestone status' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(max(position), 0) + 1 INTO v_position
    FROM api.study_deliverables WHERE task_id = p_task_id;

  INSERT INTO api.study_deliverables
    (workspace_id, task_id, name, description, status, due_at, position)
  VALUES (v_task.workspace_id, p_task_id, btrim(p_name),
          nullif(btrim(coalesce(p_description, '')), ''), p_status, p_due_at, v_position)
  RETURNING * INTO v_row;

  PERFORM internal.emit_change_event(v_task.workspace_id, 'study_task', p_task_id, 'update',
    NULL, v_task.project_id,
    jsonb_build_object('effect', 'milestone_created', 'milestoneId', v_row.id));

  RETURN jsonb_build_object('id', v_row.id, 'taskId', v_row.task_id, 'name', v_row.name,
    'status', v_row.status, 'dueAt', v_row.due_at, 'position', v_row.position);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_study_deliverable(uuid,text,text,text,timestamptz)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_study_deliverable(uuid,text,text,text,timestamptz) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_study_deliverable(
  p_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_due_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row api.study_deliverables;
BEGIN
  SELECT * INTO v_row FROM api.study_deliverables WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'milestone not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NOT NULL AND length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid milestone name' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('planned', 'in_progress', 'delivered', 'overdue') THEN
    RAISE EXCEPTION 'invalid milestone status' USING ERRCODE = '22023';
  END IF;

  UPDATE api.study_deliverables
     SET name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         description = coalesce(p_description, description),
         status = coalesce(p_status, status),
         due_at = coalesce(p_due_at, due_at),
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'name', v_row.name, 'status', v_row.status,
    'dueAt', v_row.due_at, 'position', v_row.position);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_study_deliverable(uuid,text,text,text,timestamptz)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_study_deliverable(uuid,text,text,text,timestamptz) TO authenticated;
--> statement-breakpoint

-- Reorder within the owning task: the given ids take positions 1..n, anything else
-- keeps its relative order after them.
CREATE OR REPLACE FUNCTION api.reorder_study_deliverables(
  p_task_id uuid,
  p_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task api.study_tasks;
  v_position integer := 0;
  v_id uuid;
BEGIN
  SELECT * INTO v_task FROM api.study_tasks WHERE id = p_task_id;
  IF v_task.id IS NULL THEN
    RAISE EXCEPTION 'task not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT api.is_workspace_writer(v_task.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'a milestone order is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_ids) AS given(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM api.study_deliverables d WHERE d.id = given.id AND d.task_id = p_task_id)
  ) THEN
    RAISE EXCEPTION 'milestone does not belong to this task' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    v_position := v_position + 1;
    UPDATE api.study_deliverables
       SET position = v_position, updated_at = now()
     WHERE id = v_id AND task_id = p_task_id;
  END LOOP;

  FOR v_id IN
    SELECT d.id FROM api.study_deliverables d
     WHERE d.task_id = p_task_id AND NOT (d.id = ANY (p_ids))
     ORDER BY d.position NULLS LAST, d.created_at, d.id
  LOOP
    v_position := v_position + 1;
    UPDATE api.study_deliverables SET position = v_position, updated_at = now() WHERE id = v_id;
  END LOOP;

  RETURN jsonb_build_object('taskId', p_task_id, 'ordered', v_position);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reorder_study_deliverables(uuid,uuid[]) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.reorder_study_deliverables(uuid,uuid[]) TO authenticated;
--> statement-breakpoint

-- Evidence: the existing linked_record_id pair, set through the canonical link so the
-- captured identifier cannot drift from the record it names.
CREATE OR REPLACE FUNCTION api.link_study_deliverable_evidence(
  p_id uuid,
  p_record_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row api.study_deliverables;
  v_record api.records;
BEGIN
  SELECT * INTO v_row FROM api.study_deliverables WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'milestone not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_record FROM api.records
   WHERE id = p_record_id AND deleted_at IS NULL;
  IF v_record.id IS NULL OR v_record.workspace_id <> v_row.workspace_id THEN
    RAISE EXCEPTION 'evidence record not found in this workspace' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'view');

  UPDATE api.study_deliverables
     SET linked_record_id = v_record.id,
         linked_record_identifier = v_record.identifier,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('id', v_row.id, 'linkedRecordId', v_row.linked_record_id,
    'linkedRecordIdentifier', v_row.linked_record_identifier);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.link_study_deliverable_evidence(uuid,uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.link_study_deliverable_evidence(uuid,uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
