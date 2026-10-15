-- R5-CONFIG-05 — the milestone plan gains risk and a real starting point.
--
-- The plan surface (PROJ-02) already reads milestones as api.study_tasks of type
-- 'milestone', their "done when" conditions as api.study_deliverables, their
-- client visibility from client_visible/shared_since (migration 0263) and their
-- dependency edges from api.study_task_dependencies (migration 0051). This
-- migration adds the two things the surface could not derive before:
--
--   1. api.milestone_risks — the at-risk read model. The rule is deliberately
--      small and stated in the plan UI:
--        done     — the milestone is completed;
--        late     — its due date has passed and it is not completed;
--        at_risk  — due within 14 days, not completed, and at least one
--                   "done when" condition is still open or a milestone it
--                   depends on is not completed;
--        on_track — everything else.
--      Risk is derived, never stored, so no existing row changes meaning.
--
--   2. api.create_plan_from_project — start this project's plan from another
--      project's plan. "A template" is a plan already built on another project
--      in the workspace; the RPC reads it and creates phases and milestones
--      through the canonical RPCs (create_study_workstream, create_study_task,
--      create_study_deliverable, set_study_task_client_visible), resetting
--      completion and copying no records or evidence, as PROJ-01's structure
--      copy does.
--
-- A dependency cycle remains impossible to store: authenticated holds only
-- SELECT on api.study_task_dependencies, and api.create_dependency walks the
-- existing edges with a recursive CTE before inserting (SB029).

CREATE OR REPLACE VIEW api.milestone_risks
WITH (security_invoker = true) AS
WITH conditions AS (
  SELECT d.task_id,
         count(*) AS total_count,
         count(*) FILTER (WHERE d.status <> 'delivered') AS open_count
    FROM api.study_deliverables d
   GROUP BY d.task_id
),
unfinished_dependencies AS (
  SELECT dep.successor_id AS task_id,
         count(*) AS unfinished_count,
         min(p.title) AS blocking_title
    FROM api.study_task_dependencies dep
    JOIN api.study_tasks p
      ON p.id = dep.predecessor_id
     AND p.status <> 'completed'
   GROUP BY dep.successor_id
),
base AS (
  SELECT t.id AS task_id,
         t.workspace_id,
         t.project_id,
         t.due_at,
         t.status,
         coalesce(c.total_count, 0)::int AS conditions_total,
         coalesce(c.open_count, 0)::int AS conditions_open,
         coalesce(u.unfinished_count, 0)::int AS unfinished_dependencies,
         u.blocking_title,
         CASE
           WHEN t.status = 'completed' THEN 'done'
           WHEN t.due_at IS NOT NULL AND t.due_at::date < current_date THEN 'late'
           WHEN t.due_at IS NOT NULL
            AND t.due_at::date <= current_date + 14
            AND (coalesce(c.open_count, 0) > 0 OR coalesce(u.unfinished_count, 0) > 0)
             THEN 'at_risk'
           ELSE 'on_track'
         END AS risk
    FROM api.study_tasks t
    LEFT JOIN conditions c ON c.task_id = t.id
    LEFT JOIN unfinished_dependencies u ON u.task_id = t.id
   WHERE t.task_type = 'milestone'
)
SELECT task_id,
       workspace_id,
       project_id,
       due_at,
       status,
       conditions_total,
       conditions_open,
       unfinished_dependencies,
       blocking_title,
       (risk = 'late') AS late,
       risk,
       CASE risk
         WHEN 'done' THEN 'Completed'
         WHEN 'late' THEN
           'Due date passed'
           || CASE WHEN conditions_open > 0
                   THEN '; ' || conditions_open || ' of ' || conditions_total
                        || ' conditions still open'
                   ELSE '' END
         WHEN 'at_risk' THEN
           'Due within 14 days'
           || CASE WHEN conditions_open > 0
                   THEN '; ' || conditions_open || ' of ' || conditions_total
                        || ' conditions still open'
                   ELSE '' END
           || CASE WHEN unfinished_dependencies > 0
                   THEN '; depends on "' || blocking_title || '"'
                   ELSE '' END
         ELSE 'On track'
       END AS risk_reason
  FROM base;
--> statement-breakpoint
REVOKE ALL ON api.milestone_risks FROM PUBLIC, anon;
--> statement-breakpoint
GRANT SELECT ON api.milestone_risks TO authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_plan_from_project(
  p_target_project_id uuid,
  p_source_project_id uuid,
  p_start_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_target api.projects;
  v_source api.projects;
  v_first date;
  v_phase api.study_workstreams;
  v_phase_map jsonb := '{}'::jsonb;
  v_phase_new uuid;
  v_task api.study_tasks;
  v_new_task uuid;
  v_deliverable api.study_deliverables;
  v_due timestamptz;
  v_phases integer := 0;
  v_milestones integer := 0;
  v_conditions integer := 0;
BEGIN
  IF p_target_project_id IS NULL
     OR p_source_project_id IS NULL
     OR p_start_date IS NULL THEN
    RAISE EXCEPTION 'target project, source project and start date are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_target_project_id = p_source_project_id THEN
    RAISE EXCEPTION 'a plan cannot be started from itself' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target FROM api.projects
    WHERE id = p_target_project_id AND workspace_id = v_ws;
  IF v_target.id IS NULL THEN
    RAISE EXCEPTION 'target project not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
  IF NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'plan creation denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source FROM api.projects
    WHERE id = p_source_project_id AND workspace_id = v_ws;
  IF v_source.id IS NULL OR NOT internal.can_view_project(v_source.id) THEN
    RAISE EXCEPTION 'source project not found in active workspace' USING ERRCODE = 'SB026';
  END IF;

  -- Offsets are measured from the source plan's first milestone, so a template
  -- keeps its shape whatever start date is chosen.
  SELECT min(t.due_at::date) INTO v_first
    FROM api.study_tasks t
   WHERE t.project_id = p_source_project_id AND t.task_type = 'milestone';
  IF v_first IS NULL THEN
    RAISE EXCEPTION 'the source project has no milestones' USING ERRCODE = '22023';
  END IF;

  -- Recreate only the phases the source plan actually uses.
  FOR v_phase IN
    SELECT w.* FROM api.study_workstreams w
     WHERE w.id IN (
       SELECT DISTINCT t.workstream_id FROM api.study_tasks t
        WHERE t.project_id = p_source_project_id
          AND t.task_type = 'milestone'
          AND t.workstream_id IS NOT NULL)
     ORDER BY w.position, w.id
  LOOP
    v_phase_new := (api.create_study_workstream(
      v_ws, v_phase.name, p_target_project_id, v_phase.color, v_phase.position)).id;
    v_phase_map := v_phase_map || jsonb_build_object(v_phase.id::text, v_phase_new);
    v_phases := v_phases + 1;
  END LOOP;

  FOR v_task IN
    SELECT * FROM api.study_tasks
     WHERE project_id = p_source_project_id AND task_type = 'milestone'
     ORDER BY position, created_at, id
  LOOP
    v_due := (p_start_date + (v_task.due_at::date - v_first))::timestamptz;
    v_new_task := (api.create_study_task(
      p_workspace_id => v_ws,
      p_title => v_task.title,
      p_task_type => 'milestone',
      p_workstream_id => CASE WHEN v_task.workstream_id IS NULL THEN NULL
                              ELSE (v_phase_map ->> v_task.workstream_id::text)::uuid END,
      p_project_id => p_target_project_id,
      p_description => v_task.description,
      p_status => 'not_started',
      p_priority => v_task.priority,
      p_due_at => v_due,
      p_timezone => v_task.timezone,
      p_position => v_task.position,
      p_color => v_task.color,
      p_tags => v_task.tags)).id;
    v_milestones := v_milestones + 1;

    IF v_task.client_visible THEN
      PERFORM api.set_study_task_client_visible(v_new_task, NULL, true, NULL);
    END IF;

    FOR v_deliverable IN
      SELECT * FROM api.study_deliverables
       WHERE task_id = v_task.id
       ORDER BY position NULLS LAST, created_at, id
    LOOP
      PERFORM api.create_study_deliverable(
        v_new_task,
        v_deliverable.name,
        v_deliverable.description,
        'planned',
        CASE WHEN v_deliverable.due_at IS NULL THEN NULL
             ELSE (p_start_date + (v_deliverable.due_at::date - v_first))::timestamptz END);
      v_conditions := v_conditions + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'targetProjectId', p_target_project_id,
    'sourceProjectId', p_source_project_id,
    'startDate', p_start_date,
    'phases', v_phases,
    'milestones', v_milestones,
    'conditions', v_conditions);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_plan_from_project(uuid, uuid, date) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_plan_from_project(uuid, uuid, date) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
