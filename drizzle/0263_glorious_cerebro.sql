CREATE TABLE "api"."study_task_due_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"from_due_at" timestamp with time zone,
	"to_due_at" timestamp with time zone,
	"reason" text NOT NULL,
	"client_notified" boolean DEFAULT false NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by_user_id" text,
	CONSTRAINT "chk_study_task_due_changes_reason" CHECK (length(btrim("api"."study_task_due_changes"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "api"."study_tasks" ADD COLUMN "client_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."study_tasks" ADD COLUMN "shared_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."study_tasks" ADD COLUMN "client_visible_reason" text;--> statement-breakpoint
ALTER TABLE "api"."study_task_due_changes" ADD CONSTRAINT "study_task_due_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."study_task_due_changes" ADD CONSTRAINT "study_task_due_changes_task_id_study_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "api"."study_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."study_task_due_changes" ADD CONSTRAINT "study_task_due_changes_changed_by_user_id_user_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_study_task_due_changes_task" ON "api"."study_task_due_changes" USING btree ("task_id","changed_at");--> statement-breakpoint
-- PROJ-02: milestone client visibility and an append-only date history.
GRANT SELECT ON "api"."study_task_due_changes" TO authenticated;
--> statement-breakpoint
ALTER TABLE "api"."study_task_due_changes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "study_task_due_changes_select" ON "api"."study_task_due_changes"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.move_study_task_due(
  p_task_id uuid,
  p_expected_metadata_version integer,
  p_due_at timestamptz,
  p_reason text,
  p_notify_client boolean DEFAULT false
)
RETURNS api.study_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_row api.study_tasks;
BEGIN
  SELECT * INTO v_row FROM api.study_tasks
    WHERE id = p_task_id AND workspace_id = v_ws FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
  IF NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'study task denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE = 'SB001';
  END IF;
  IF p_due_at IS NULL THEN
    RAISE EXCEPTION 'a due date is required' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.study_task_due_changes(
    workspace_id, task_id, from_due_at, to_due_at, reason,
    client_notified, changed_by_user_id
  ) VALUES (
    v_ws, p_task_id, v_row.due_at, p_due_at, btrim(p_reason),
    coalesce(p_notify_client, false), api.current_user_id()
  );
  UPDATE api.study_tasks
    SET due_at = p_due_at,
        metadata_version = metadata_version + 1,
        updated_at = now(),
        updated_by_user_id = api.current_user_id()
    WHERE id = p_task_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.move_study_task_due(uuid,integer,timestamptz,text,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.move_study_task_due(uuid,integer,timestamptz,text,boolean) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_study_task_client_visible(
  p_task_id uuid,
  p_expected_metadata_version integer,
  p_client_visible boolean,
  p_reason text DEFAULT NULL
)
RETURNS api.study_tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_row api.study_tasks;
BEGIN
  SELECT * INTO v_row FROM api.study_tasks
    WHERE id = p_task_id AND workspace_id = v_ws FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE = 'SB026';
  END IF;
  IF NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'study task denied' USING ERRCODE = '42501';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE = 'SB001';
  END IF;
  IF p_client_visible IS NOT TRUE
     AND length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a reason is required to hide a milestone' USING ERRCODE = '22023';
  END IF;
  UPDATE api.study_tasks
    SET client_visible = coalesce(p_client_visible, false),
        shared_since = CASE
          WHEN coalesce(p_client_visible, false) THEN coalesce(shared_since, now())
          ELSE shared_since END,
        client_visible_reason = CASE
          WHEN coalesce(p_client_visible, false) THEN NULL
          ELSE btrim(p_reason) END,
        metadata_version = metadata_version + 1,
        updated_at = now(),
        updated_by_user_id = api.current_user_id()
    WHERE id = p_task_id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.set_study_task_client_visible(uuid,integer,boolean,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_study_task_client_visible(uuid,integer,boolean,text) TO authenticated;
