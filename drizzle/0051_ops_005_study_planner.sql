-- ===========================================================================
-- OPS-005: Study Planner.
--
-- Adds six workspace-scoped tables for study planning:
--
--   api.study_workstreams        — swimlane groupings of tasks (e.g. "Vector
--                                  Design & Build", "Stability Studies").
--   api.study_tasks              — the unified task model: tasks (date-range
--                                  bars) and milestones (single-point
--                                  diamonds). Linked to projects, experiments
--                                  and protocols. Timestamps are timestamptz
--                                  (UTC-stored, zone-aware); the task's
--                                  `timezone` column fixes the display/DST
--                                  boundary.
--   api.study_task_dependencies  — directed edges (predecessor → successor)
--                                  with type and lag. Circular dependencies
--                                  are rejected transactionally by a
--                                  recursive CTE in create_dependency.
--   api.study_task_assignments   — user/role assignments per task.
--   api.study_task_resources     — calendar-resource bookings linked to a
--                                  task. Overbooking is rejected by
--                                  assign_task_resource which checks
--                                  tstzrange overlaps for the same resource.
--   api.study_deliverables       — deliverables produced by a task, with
--                                  status and optional linked record.
--
-- RLS is the read access-control boundary; members read study rows in their
-- workspace. Controlled RPCs (SECURITY DEFINER) are the only writers for
-- tasks, dependencies, assignments and resources so circular-dependency
-- detection and overbooking checks are always enforced transactionally.
--
-- Error codes:
--   SB005 invalid input, SB016 wrong workspace, SB026 task not found,
--   SB027 workstream not found, SB028 dependency not found,
--   SB029 circular dependency, SB030 resource overbooking,
--   SB031 dependency self-reference, SB032 invalid time range.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- api.study_workstreams: swimlane groupings of tasks.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_workstreams" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid,
  "name" text NOT NULL,
  "color" text,
  "position" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'active',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  CONSTRAINT "study_workstreams_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_workstreams_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_workstreams_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_workstreams_updated_by_user_id_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_workstreams_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_study_workstreams_status" CHECK ("status" IN ('active','archived')),
  CONSTRAINT "chk_study_workstreams_position" CHECK ("position" >= 0)
);
--> statement-breakpoint

CREATE INDEX "idx_study_workstreams_workspace" ON "api"."study_workstreams" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_workstreams_project" ON "api"."study_workstreams" ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_study_workstreams_workspace_position" ON "api"."study_workstreams" ("workspace_id", "position");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.study_tasks: the unified task model (tasks and milestones).
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "workstream_id" uuid,
  "project_id" uuid,
  "title" text NOT NULL,
  "description" text,
  "task_type" text NOT NULL DEFAULT 'task',
  "status" text NOT NULL DEFAULT 'not_started',
  "priority" text NOT NULL DEFAULT 'medium',
  "starts_at" timestamp with time zone,
  "ends_at" timestamp with time zone,
  "due_at" timestamp with time zone,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "position" integer NOT NULL DEFAULT 0,
  "color" text,
  "progress_percent" integer NOT NULL DEFAULT 0,
  "linked_experiment_record_id" uuid,
  "linked_experiment_identifier" text,
  "linked_experiment_title" text,
  "linked_protocol_record_id" uuid,
  "linked_protocol_identifier" text,
  "approval_required" boolean NOT NULL DEFAULT false,
  "approval_status" text NOT NULL DEFAULT 'not_required',
  "tags" text[] NOT NULL DEFAULT '{}'::text[],
  "metadata_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  CONSTRAINT "study_tasks_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_tasks_workstream_id_study_workstreams_id_fk"
    FOREIGN KEY ("workstream_id") REFERENCES "api"."study_workstreams"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_tasks_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_tasks_linked_experiment_record_id_records_id_fk"
    FOREIGN KEY ("linked_experiment_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_tasks_linked_protocol_record_id_records_id_fk"
    FOREIGN KEY ("linked_protocol_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_tasks_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "study_tasks_updated_by_user_id_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_tasks_title" CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_study_tasks_type" CHECK ("task_type" IN ('task','milestone')),
  CONSTRAINT "chk_study_tasks_status" CHECK ("status" IN ('not_started','in_progress','review','completed','blocked','cancelled')),
  CONSTRAINT "chk_study_tasks_priority" CHECK ("priority" IN ('low','medium','high','critical')),
  CONSTRAINT "chk_study_tasks_approval" CHECK ("approval_status" IN ('not_required','pending','approved','rejected')),
  CONSTRAINT "chk_study_tasks_version" CHECK ("metadata_version" > 0),
  CONSTRAINT "chk_study_tasks_progress" CHECK ("progress_percent" BETWEEN 0 AND 100),
  CONSTRAINT "chk_study_tasks_position" CHECK ("position" >= 0),
  CONSTRAINT "chk_study_tasks_milestone_dates"
    CHECK ("task_type" = 'milestone' AND "due_at" IS NOT NULL
           OR "task_type" = 'task')
);
--> statement-breakpoint

CREATE INDEX "idx_study_tasks_workspace" ON "api"."study_tasks" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_tasks_workstream" ON "api"."study_tasks" ("workstream_id");
--> statement-breakpoint
CREATE INDEX "idx_study_tasks_project" ON "api"."study_tasks" ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_study_tasks_workspace_position" ON "api"."study_tasks" ("workspace_id", "position");
--> statement-breakpoint
CREATE INDEX "idx_study_tasks_active_range"
  ON "api"."study_tasks" ("workspace_id", "starts_at", "ends_at")
  WHERE "status" <> 'cancelled';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.study_task_dependencies: directed edges (predecessor → successor).
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_task_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "predecessor_id" uuid NOT NULL,
  "successor_id" uuid NOT NULL,
  "dependency_type" text NOT NULL DEFAULT 'finish_to_start',
  "lag_days" integer NOT NULL DEFAULT 0,
  "is_external" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  CONSTRAINT "study_task_dependencies_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_dependencies_predecessor_id_study_tasks_id_fk"
    FOREIGN KEY ("predecessor_id") REFERENCES "api"."study_tasks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_dependencies_successor_id_study_tasks_id_fk"
    FOREIGN KEY ("successor_id") REFERENCES "api"."study_tasks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_dependencies_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_task_deps_type"
    CHECK ("dependency_type" IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish')),
  CONSTRAINT "chk_study_task_deps_self" CHECK ("predecessor_id" <> "successor_id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_study_task_deps_edge"
  ON "api"."study_task_dependencies" ("predecessor_id", "successor_id", "dependency_type");
--> statement-breakpoint
CREATE INDEX "idx_study_task_deps_workspace" ON "api"."study_task_dependencies" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_task_deps_predecessor" ON "api"."study_task_dependencies" ("predecessor_id");
--> statement-breakpoint
CREATE INDEX "idx_study_task_deps_successor" ON "api"."study_task_dependencies" ("successor_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.study_task_assignments: user/role assignments per task.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_task_assignments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "user_id" text,
  "display_name" text,
  "role" text NOT NULL DEFAULT 'assignee',
  "effort_percent" integer NOT NULL DEFAULT 100,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "study_task_assignments_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_assignments_task_id_study_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "api"."study_tasks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_assignments_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_task_assignments_role"
    CHECK ("role" IN ('assignee','reviewer','observer')),
  CONSTRAINT "chk_study_task_assignments_identity"
    CHECK ("user_id" IS NOT NULL OR "display_name" IS NOT NULL),
  CONSTRAINT "chk_study_task_assignments_effort"
    CHECK ("effort_percent" BETWEEN 0 AND 100)
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_study_task_assignments_task_user"
  ON "api"."study_task_assignments" ("task_id", "user_id")
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_study_task_assignments_workspace" ON "api"."study_task_assignments" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_task_assignments_task" ON "api"."study_task_assignments" ("task_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.study_task_resources: calendar-resource bookings linked to a task.
-- Overbooking is detected by assign_task_resource.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_task_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "calendar_resource_id" uuid NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  CONSTRAINT "study_task_resources_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_resources_task_id_study_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "api"."study_tasks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_resources_calendar_resource_id_calendar_resources_id_fk"
    FOREIGN KEY ("calendar_resource_id") REFERENCES "api"."calendar_resources"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_task_resources_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_task_resources_range" CHECK ("ends_at" > "starts_at")
);
--> statement-breakpoint

CREATE INDEX "idx_study_task_resources_workspace" ON "api"."study_task_resources" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_task_resources_task" ON "api"."study_task_resources" ("task_id");
--> statement-breakpoint
CREATE INDEX "idx_study_task_resources_resource"
  ON "api"."study_task_resources" ("calendar_resource_id", "starts_at", "ends_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.study_deliverables: deliverables produced by a task.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."study_deliverables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'planned',
  "due_at" timestamp with time zone,
  "linked_record_id" uuid,
  "linked_record_identifier" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "study_deliverables_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_deliverables_task_id_study_tasks_id_fk"
    FOREIGN KEY ("task_id") REFERENCES "api"."study_tasks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "study_deliverables_linked_record_id_records_id_fk"
    FOREIGN KEY ("linked_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_study_deliverables_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_study_deliverables_status"
    CHECK ("status" IN ('planned','in_progress','delivered','overdue'))
);
--> statement-breakpoint

CREATE INDEX "idx_study_deliverables_workspace" ON "api"."study_deliverables" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_study_deliverables_task" ON "api"."study_deliverables" ("task_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."study_workstreams" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_tasks" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_dependencies" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_assignments" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_resources" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_deliverables" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."study_workstreams" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."study_tasks" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_dependencies" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_assignments" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."study_task_resources" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."study_deliverables" TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- ---------------------------------------------------------------------------

ALTER TABLE "api"."study_workstreams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."study_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."study_task_dependencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."study_task_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."study_task_resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."study_deliverables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "study_workstreams_select" ON "api"."study_workstreams"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_workstreams_select_api_client" ON "api"."study_workstreams"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "study_workstreams_write" ON "api"."study_workstreams"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "study_tasks_select" ON "api"."study_tasks"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_tasks_select_api_client" ON "api"."study_tasks"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "study_task_dependencies_select" ON "api"."study_task_dependencies"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_task_dependencies_select_api_client" ON "api"."study_task_dependencies"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "study_task_assignments_select" ON "api"."study_task_assignments"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_task_assignments_select_api_client" ON "api"."study_task_assignments"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "study_task_resources_select" ON "api"."study_task_resources"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_task_resources_select_api_client" ON "api"."study_task_resources"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "study_deliverables_select" ON "api"."study_deliverables"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "study_deliverables_select_api_client" ON "api"."study_deliverables"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

-- ===========================================================================
-- create_study_workstream: create a swimlane grouping.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_study_workstream"(
  p_workspace_id uuid,
  p_name text,
  p_project_id uuid DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_position integer DEFAULT 0
)
RETURNS "api"."study_workstreams"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."study_workstreams";
  v_ws_id uuid;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  IF v_ws_id IS NULL OR v_ws_id <> p_workspace_id THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_name) = '' OR length(p_name) > 200 THEN
    RAISE EXCEPTION 'workstream name must be 1–200 characters' USING ERRCODE = 'SB005';
  END IF;
  INSERT INTO "api"."study_workstreams"
    (workspace_id, project_id, name, color, position, created_by_user_id, updated_by_user_id)
  VALUES
    (v_ws_id, p_project_id, btrim(p_name), p_color, p_position,
     "api"."current_user_id"(), "api"."current_user_id"())
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_study_workstream"(uuid, text, uuid, text, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_study_workstream"(uuid, text, uuid, text, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- create_study_task: create a task or milestone with optional assignments and
-- resource bookings in a single transaction.
--
-- p_assignments: JSONB array of {userId?, displayName?, role?, effortPercent?}.
-- p_resources:   JSONB array of {calendarResourceId, startsAt, endsAt, notes?}.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_study_task"(
  p_workspace_id uuid,
  p_title text,
  p_task_type text DEFAULT 'task',
  p_workstream_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_status text DEFAULT 'not_started',
  p_priority text DEFAULT 'medium',
  p_starts_at timestamp with time zone DEFAULT NULL,
  p_ends_at timestamp with time zone DEFAULT NULL,
  p_due_at timestamp with time zone DEFAULT NULL,
  p_timezone text DEFAULT 'UTC',
  p_position integer DEFAULT 0,
  p_color text DEFAULT NULL,
  p_progress_percent integer DEFAULT 0,
  p_linked_experiment_record_id uuid DEFAULT NULL,
  p_linked_protocol_record_id uuid DEFAULT NULL,
  p_approval_required boolean DEFAULT false,
  p_tags text[] DEFAULT '{}'::text[],
  p_assignments jsonb DEFAULT '[]'::jsonb,
  p_resources jsonb DEFAULT '[]'::jsonb
)
RETURNS "api"."study_tasks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_row "api"."study_tasks";
  v_ws "api"."study_workstreams";
  v_exp_rec "api"."records";
  v_proto_rec "api"."records";
  v_assign jsonb;
  v_res jsonb;
  v_resource "api"."calendar_resources";
  v_conflict "api"."study_task_resources";
  v_cal_conflict "api"."calendar_bookings";
  v_user_id text;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  IF v_ws_id IS NULL OR v_ws_id <> p_workspace_id THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF btrim(p_title) = '' OR length(p_title) > 200 THEN
    RAISE EXCEPTION 'task title must be 1–200 characters' USING ERRCODE = 'SB005';
  END IF;
  IF p_task_type NOT IN ('task','milestone') THEN
    RAISE EXCEPTION 'invalid task type: %', p_task_type USING ERRCODE = 'SB005';
  END IF;
  IF p_status NOT IN ('not_started','in_progress','review','completed','blocked','cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'SB005';
  END IF;
  IF p_priority NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid priority: %', p_priority USING ERRCODE = 'SB005';
  END IF;

  -- Milestones require due_at; tasks require starts_at and ends_at.
  IF p_task_type = 'milestone' AND p_due_at IS NULL THEN
    RAISE EXCEPTION 'milestones require a due_at date' USING ERRCODE = 'SB005';
  END IF;
  IF p_task_type = 'task' THEN
    IF p_starts_at IS NULL OR p_ends_at IS NULL THEN
      RAISE EXCEPTION 'tasks require starts_at and ends_at' USING ERRCODE = 'SB005';
    END IF;
    IF p_ends_at <= p_starts_at THEN
      RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = 'SB032';
    END IF;
  END IF;

  -- Validate workstream belongs to workspace.
  IF p_workstream_id IS NOT NULL THEN
    SELECT * INTO v_ws FROM "api"."study_workstreams"
      WHERE id = p_workstream_id AND workspace_id = v_ws_id;
    IF v_ws IS NULL THEN
      RAISE EXCEPTION 'workstream not found in active workspace' USING ERRCODE = 'SB027';
    END IF;
  END IF;

  -- Validate linked experiment.
  IF p_linked_experiment_record_id IS NOT NULL THEN
    SELECT * INTO v_exp_rec FROM "api"."records" WHERE id = p_linked_experiment_record_id;
    IF v_exp_rec IS NULL OR v_exp_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked experiment not found in active workspace' USING ERRCODE = 'SB016';
    END IF;
    IF v_exp_rec.kind <> 'experiment' THEN
      RAISE EXCEPTION 'linked record % is not an experiment', p_linked_experiment_record_id
        USING ERRCODE = 'SB005';
    END IF;
  END IF;

  -- Validate linked protocol.
  IF p_linked_protocol_record_id IS NOT NULL THEN
    SELECT * INTO v_proto_rec FROM "api"."records" WHERE id = p_linked_protocol_record_id;
    IF v_proto_rec IS NULL OR v_proto_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked protocol not found in active workspace' USING ERRCODE = 'SB016';
    END IF;
    IF v_proto_rec.kind <> 'protocol' THEN
      RAISE EXCEPTION 'linked record % is not a protocol', p_linked_protocol_record_id
        USING ERRCODE = 'SB005';
    END IF;
  END IF;

  v_user_id := "api"."current_user_id"();

  INSERT INTO "api"."study_tasks"
    (workspace_id, workstream_id, project_id, title, description, task_type,
     status, priority, starts_at, ends_at, due_at, timezone, position, color,
     progress_percent, linked_experiment_record_id, linked_experiment_identifier,
     linked_experiment_title, linked_protocol_record_id, linked_protocol_identifier,
     approval_required, approval_status, tags, created_by_user_id, updated_by_user_id)
  VALUES
    (v_ws_id, p_workstream_id, p_project_id, btrim(p_title), p_description, p_task_type,
     p_status, p_priority, p_starts_at, p_ends_at, p_due_at, COALESCE(p_timezone, 'UTC'),
     p_position, p_color, LEAST(GREATEST(p_progress_percent, 0), 100),
     p_linked_experiment_record_id,
     CASE WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.identifier ELSE NULL END,
     CASE WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.title ELSE NULL END,
     p_linked_protocol_record_id,
     CASE WHEN p_linked_protocol_record_id IS NOT NULL THEN v_proto_rec.identifier ELSE NULL END,
     p_approval_required,
     CASE WHEN p_approval_required THEN 'pending' ELSE 'not_required' END,
     COALESCE(p_tags, '{}'::text[]), v_user_id, v_user_id)
  RETURNING * INTO v_row;

  -- Insert assignments.
  IF jsonb_typeof(p_assignments) = 'array' THEN
    FOR v_assign IN SELECT * FROM jsonb_array_elements(p_assignments) LOOP
      INSERT INTO "api"."study_task_assignments"
        (workspace_id, task_id, user_id, display_name, role, effort_percent)
      VALUES
        (v_ws_id, v_row.id,
         NULLIF(v_assign ->> 'userId', ''),
         v_assign ->> 'displayName',
         COALESCE(v_assign ->> 'role', 'assignee'),
         COALESCE((v_assign ->> 'effortPercent')::integer, 100))
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- Insert resource bookings with overbooking detection.
  IF jsonb_typeof(p_resources) = 'array' THEN
    FOR v_res IN SELECT * FROM jsonb_array_elements(p_resources) LOOP
      SELECT * INTO v_resource FROM "api"."calendar_resources"
        WHERE id = (v_res ->> 'calendarResourceId')::uuid
          AND workspace_id = v_ws_id FOR UPDATE;
      IF v_resource IS NULL THEN
        RAISE EXCEPTION 'calendar resource not found in active workspace' USING ERRCODE = 'SB021';
      END IF;
      -- Check overbooking against other study task resources.
      SELECT * INTO v_conflict FROM "api"."study_task_resources"
        WHERE calendar_resource_id = v_resource.id
          AND workspace_id = v_ws_id
          AND tstzrange(starts_at, ends_at) && tstzrange(
              (v_res ->> 'startsAt')::timestamptz,
              (v_res ->> 'endsAt')::timestamptz)
        LIMIT 1;
      IF v_conflict.id IS NOT NULL THEN
        RAISE EXCEPTION 'resource % is overbooked in the requested time range',
          v_resource.name USING ERRCODE = 'SB030';
      END IF;
      -- Also check against calendar bookings.
      SELECT * INTO v_cal_conflict FROM "api"."calendar_bookings"
        WHERE resource_id = v_resource.id
          AND workspace_id = v_ws_id
          AND status <> 'cancelled'
          AND tstzrange(starts_at, ends_at) && tstzrange(
              (v_res ->> 'startsAt')::timestamptz,
              (v_res ->> 'endsAt')::timestamptz)
        LIMIT 1;
      IF v_cal_conflict.id IS NOT NULL THEN
        RAISE EXCEPTION 'resource % is booked by calendar booking %',
          v_resource.name, v_cal_conflict.id USING ERRCODE = 'SB030';
      END IF;
      INSERT INTO "api"."study_task_resources"
        (workspace_id, task_id, calendar_resource_id, starts_at, ends_at,
         notes, created_by_user_id)
      VALUES
        (v_ws_id, v_row.id, v_resource.id,
         (v_res ->> 'startsAt')::timestamptz,
         (v_res ->> 'endsAt')::timestamptz,
         v_res ->> 'notes', v_user_id);
    END LOOP;
  END IF;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_study_task"(uuid, text, text, uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, integer, text, integer, uuid, uuid, boolean, text[], jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_study_task"(uuid, text, text, uuid, uuid, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, integer, text, integer, uuid, uuid, boolean, text[], jsonb, jsonb) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- edit_study_task: update a task's mutable fields. p_expected_metadata_version
-- guards against stale concurrent edits.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."edit_study_task"(
  p_task_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_task_type text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_starts_at timestamp with time zone DEFAULT NULL,
  p_ends_at timestamp with time zone DEFAULT NULL,
  p_due_at timestamp with time zone DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_workstream_id text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_position integer DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_progress_percent integer DEFAULT NULL,
  p_linked_experiment_record_id uuid DEFAULT NULL,
  p_linked_protocol_record_id uuid DEFAULT NULL,
  p_approval_required boolean DEFAULT NULL,
  p_approval_status text DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_expected_metadata_version integer DEFAULT NULL
)
RETURNS "api"."study_tasks"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_row "api"."study_tasks";
  v_new_start timestamp with time zone;
  v_new_end timestamp with time zone;
  v_exp_rec "api"."records";
  v_proto_rec "api"."records";
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  SELECT * INTO v_row FROM "api"."study_tasks"
    WHERE id = p_task_id AND workspace_id = v_ws_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('not_started','in_progress','review','completed','blocked','cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'SB005';
  END IF;
  IF p_priority IS NOT NULL AND p_priority NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid priority: %', p_priority USING ERRCODE = 'SB005';
  END IF;

  v_new_start := COALESCE(p_starts_at, v_row.starts_at);
  v_new_end := COALESCE(p_ends_at, v_row.ends_at);
  IF v_new_start IS NOT NULL AND v_new_end IS NOT NULL AND v_new_end <= v_new_start THEN
    RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = 'SB032';
  END IF;

  -- Validate linked experiment.
  IF p_linked_experiment_record_id IS NOT NULL THEN
    SELECT * INTO v_exp_rec FROM "api"."records" WHERE id = p_linked_experiment_record_id;
    IF v_exp_rec IS NULL OR v_exp_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked experiment not found in active workspace' USING ERRCODE = 'SB016';
    END IF;
    IF v_exp_rec.kind <> 'experiment' THEN
      RAISE EXCEPTION 'linked record % is not an experiment', p_linked_experiment_record_id
        USING ERRCODE = 'SB005';
    END IF;
  END IF;

  -- Validate linked protocol.
  IF p_linked_protocol_record_id IS NOT NULL THEN
    SELECT * INTO v_proto_rec FROM "api"."records" WHERE id = p_linked_protocol_record_id;
    IF v_proto_rec IS NULL OR v_proto_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked protocol not found in active workspace' USING ERRCODE = 'SB016';
    END IF;
    IF v_proto_rec.kind <> 'protocol' THEN
      RAISE EXCEPTION 'linked record % is not a protocol', p_linked_protocol_record_id
        USING ERRCODE = 'SB005';
    END IF;
  END IF;

  UPDATE "api"."study_tasks"
    SET title = COALESCE(btrim(p_title), title),
        description = COALESCE(p_description, description),
        task_type = COALESCE(p_task_type, task_type),
        status = COALESCE(p_status, status),
        priority = COALESCE(p_priority, priority),
        starts_at = v_new_start,
        ends_at = v_new_end,
        due_at = COALESCE(p_due_at, due_at),
        timezone = COALESCE(p_timezone, timezone),
        workstream_id = CASE
          WHEN p_workstream_id = '__clear__' THEN NULL
          WHEN p_workstream_id IS NOT NULL THEN p_workstream_id::uuid
          ELSE workstream_id END,
        project_id = COALESCE(p_project_id, project_id),
        position = COALESCE(p_position, position),
        color = COALESCE(p_color, color),
        progress_percent = CASE
          WHEN p_progress_percent IS NOT NULL THEN LEAST(GREATEST(p_progress_percent, 0), 100)
          ELSE progress_percent END,
        linked_experiment_record_id = COALESCE(p_linked_experiment_record_id, linked_experiment_record_id),
        linked_experiment_identifier = CASE
          WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.identifier
          ELSE linked_experiment_identifier END,
        linked_experiment_title = CASE
          WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.title
          ELSE linked_experiment_title END,
        linked_protocol_record_id = COALESCE(p_linked_protocol_record_id, linked_protocol_record_id),
        linked_protocol_identifier = CASE
          WHEN p_linked_protocol_record_id IS NOT NULL THEN v_proto_rec.identifier
          ELSE linked_protocol_identifier END,
        approval_required = COALESCE(p_approval_required, approval_required),
        approval_status = COALESCE(p_approval_status, approval_status),
        tags = COALESCE(p_tags, tags),
        metadata_version = metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"(),
        updated_at = now()
    WHERE id = p_task_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."edit_study_task"(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, text, uuid, integer, text, integer, uuid, uuid, boolean, text, text[], integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."edit_study_task"(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, text, text, uuid, integer, text, integer, uuid, uuid, boolean, text, text[], integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- delete_study_task: delete a task and cascade its dependencies, assignments,
-- resources and deliverables.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."delete_study_task"(
  p_task_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  DELETE FROM "api"."study_tasks"
    WHERE id = p_task_id AND workspace_id = v_ws_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."delete_study_task"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."delete_study_task"(uuid) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- create_dependency: create a directed edge (predecessor → successor) with
-- circular-dependency detection. A recursive CTE walks existing edges from
-- successor back toward predecessor; if a path exists, adding this edge
-- would close a cycle and is rejected.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_dependency"(
  p_workspace_id uuid,
  p_predecessor_id uuid,
  p_successor_id uuid,
  p_dependency_type text DEFAULT 'finish_to_start',
  p_lag_days integer DEFAULT 0,
  p_is_external boolean DEFAULT false
)
RETURNS "api"."study_task_dependencies"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_row "api"."study_task_dependencies";
  v_cycle boolean;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  IF v_ws_id IS NULL OR v_ws_id <> p_workspace_id THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF p_predecessor_id = p_successor_id THEN
    RAISE EXCEPTION 'a task cannot depend on itself' USING ERRCODE = 'SB031';
  END IF;
  IF p_dependency_type NOT IN ('finish_to_start','start_to_start','finish_to_finish','start_to_finish') THEN
    RAISE EXCEPTION 'invalid dependency type: %', p_dependency_type USING ERRCODE = 'SB005';
  END IF;

  -- Verify both tasks belong to the workspace.
  PERFORM 1 FROM "api"."study_tasks"
    WHERE id = p_predecessor_id AND workspace_id = v_ws_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'predecessor task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
  PERFORM 1 FROM "api"."study_tasks"
    WHERE id = p_successor_id AND workspace_id = v_ws_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'successor task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;

  -- Circular dependency detection: is there already a path from successor
  -- back to predecessor? If so, adding predecessor→successor closes a cycle.
  WITH RECURSIVE chain AS (
    SELECT predecessor_id, successor_id
      FROM "api"."study_task_dependencies"
      WHERE workspace_id = v_ws_id
        AND predecessor_id = p_successor_id
    UNION ALL
    SELECT e.predecessor_id, e.successor_id
      FROM "api"."study_task_dependencies" e
      JOIN chain ON e.predecessor_id = chain.successor_id
      WHERE e.workspace_id = v_ws_id
  )
  SELECT EXISTS(
    SELECT 1 FROM chain WHERE successor_id = p_predecessor_id
  ) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'circular dependency detected: % → % would create a cycle',
      p_predecessor_id, p_successor_id USING ERRCODE = 'SB029';
  END IF;

  INSERT INTO "api"."study_task_dependencies"
    (workspace_id, predecessor_id, successor_id, dependency_type,
     lag_days, is_external, created_by_user_id)
  VALUES
    (v_ws_id, p_predecessor_id, p_successor_id, p_dependency_type,
     p_lag_days, p_is_external, "api"."current_user_id"())
  ON CONFLICT (predecessor_id, successor_id, dependency_type) DO NOTHING
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_dependency"(uuid, uuid, uuid, text, integer, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_dependency"(uuid, uuid, uuid, text, integer, boolean) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- delete_dependency: remove a dependency edge.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."delete_dependency"(
  p_dependency_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  DELETE FROM "api"."study_task_dependencies"
    WHERE id = p_dependency_id AND workspace_id = v_ws_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dependency not found in active workspace' USING ERRCODE = 'SB028';
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."delete_dependency"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."delete_dependency"(uuid) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- assign_task_resource: assign a calendar resource to a task with overbooking
-- detection. Checks overlaps against both study_task_resources and
-- calendar_bookings for the same resource.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."assign_task_resource"(
  p_workspace_id uuid,
  p_task_id uuid,
  p_calendar_resource_id uuid,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_notes text DEFAULT NULL
)
RETURNS "api"."study_task_resources"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_row "api"."study_task_resources";
  v_resource "api"."calendar_resources";
  v_conflict "api"."study_task_resources";
  v_cal_conflict "api"."calendar_bookings";
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  IF v_ws_id IS NULL OR v_ws_id <> p_workspace_id THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = 'SB032';
  END IF;

  -- Verify task.
  PERFORM 1 FROM "api"."study_tasks"
    WHERE id = p_task_id AND workspace_id = v_ws_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;

  -- Lock the resource row.
  SELECT * INTO v_resource FROM "api"."calendar_resources"
    WHERE id = p_calendar_resource_id AND workspace_id = v_ws_id FOR UPDATE;
  IF v_resource IS NULL THEN
    RAISE EXCEPTION 'calendar resource not found in active workspace' USING ERRCODE = 'SB021';
  END IF;

  -- Overbooking check against study task resources.
  SELECT * INTO v_conflict FROM "api"."study_task_resources"
    WHERE calendar_resource_id = p_calendar_resource_id
      AND workspace_id = v_ws_id
      AND tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_ends_at)
    LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'resource % is overbooked: overlaps with task resource %',
      v_resource.name, v_conflict.id USING ERRCODE = 'SB030';
  END IF;

  -- Overbooking check against calendar bookings.
  SELECT * INTO v_cal_conflict FROM "api"."calendar_bookings"
    WHERE resource_id = p_calendar_resource_id
      AND workspace_id = v_ws_id
      AND status <> 'cancelled'
      AND tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_ends_at)
    LIMIT 1;
  IF v_cal_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'resource % is booked by calendar booking %',
      v_resource.name, v_cal_conflict.id USING ERRCODE = 'SB030';
  END IF;

  INSERT INTO "api"."study_task_resources"
    (workspace_id, task_id, calendar_resource_id, starts_at, ends_at,
     notes, created_by_user_id)
  VALUES
    (v_ws_id, p_task_id, p_calendar_resource_id, p_starts_at, p_ends_at,
     p_notes, "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."assign_task_resource"(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."assign_task_resource"(uuid, uuid, uuid, timestamp with time zone, timestamp with time zone, text) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- Widen the change-events entity vocabulary for study planner entities.
-- ===========================================================================

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'sample_event',
    'comment', 'review_submission', 'signature',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement',
    'plate_design', 'plate_well', 'plate_layout_template',
    'calendar_resource', 'calendar_booking', 'calendar_booking_participant',
    'calendar_booking_sample',
    'study_workstream', 'study_task', 'study_task_dependency',
    'study_task_assignment', 'study_task_resource', 'study_deliverable'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_study"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity text;
  v_op text;
  v_payload jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  PERFORM "internal"."emit_change_event"(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    v_entity,
    COALESCE(NEW.id, OLD.id),
    v_op,
    NULL,
    NULL,
    v_payload
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_study"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "change_event_study_workstreams"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."study_workstreams"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_workstream');
--> statement-breakpoint
CREATE TRIGGER "change_event_study_tasks"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."study_tasks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_task');
--> statement-breakpoint
CREATE TRIGGER "change_event_study_task_dependencies"
  AFTER INSERT OR DELETE ON "api"."study_task_dependencies"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_task_dependency');
--> statement-breakpoint
CREATE TRIGGER "change_event_study_task_assignments"
  AFTER INSERT OR DELETE ON "api"."study_task_assignments"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_task_assignment');
--> statement-breakpoint
CREATE TRIGGER "change_event_study_task_resources"
  AFTER INSERT OR DELETE ON "api"."study_task_resources"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_task_resource');
--> statement-breakpoint
CREATE TRIGGER "change_event_study_deliverables"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."study_deliverables"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_study"('study_deliverable');
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
