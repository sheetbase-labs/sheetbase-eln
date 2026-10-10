CREATE TABLE "api"."pipeline_run_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_id" text NOT NULL,
	"form_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"asked_user_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"answer" jsonb,
	"answered_by_user_id" text,
	"answered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_pipeline_run_prompts_step_id" CHECK (length(btrim("api"."pipeline_run_prompts"."step_id")) between 1 and 96),
	CONSTRAINT "chk_pipeline_run_prompts_answer" CHECK (("api"."pipeline_run_prompts"."answer" IS NULL) = ("api"."pipeline_run_prompts"."answered_by_user_id" IS NULL) AND ("api"."pipeline_run_prompts"."answer" IS NULL) = ("api"."pipeline_run_prompts"."answered_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "api"."pipeline_runs" DROP CONSTRAINT "chk_pipeline_runs_status";--> statement-breakpoint
ALTER TABLE "api"."pipeline_run_prompts" ADD CONSTRAINT "pipeline_run_prompts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."pipeline_run_prompts" ADD CONSTRAINT "fk_pipeline_run_prompts_run" FOREIGN KEY ("workspace_id","run_id") REFERENCES "api"."pipeline_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_prompts_run" ON "api"."pipeline_run_prompts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_pipeline_run_prompts_workspace" ON "api"."pipeline_run_prompts" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."pipeline_runs" ADD CONSTRAINT "chk_pipeline_runs_status" CHECK ("api"."pipeline_runs"."status" IN ('running', 'waiting', 'succeeded', 'failed', 'cancelled'));
--> statement-breakpoint

-- PIPE-02.1: a run that pauses for a person is readable by the workspace, so the
-- run page and the inbox can show what was asked and who answered. Writes stay
-- with the executor, exactly as pipeline_run_logs does.
ALTER TABLE api.pipeline_run_prompts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_run_prompts_select ON api.pipeline_run_prompts
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.pipeline_run_prompts TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';