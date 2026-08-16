CREATE TABLE "api"."sheet_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"notebook_record_id" uuid,
	"source_definition_version_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"duplicated_from_instance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "chk_sheet_instances_lifecycle" CHECK ("api"."sheet_instances"."lifecycle" IN ('active','archived')),
	CONSTRAINT "chk_sheet_instances_revision" CHECK ("api"."sheet_instances"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_notebook_record_id_records_id_fk" FOREIGN KEY ("notebook_record_id") REFERENCES "api"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_source_definition_version_id_sheet_definition_versions_id_fk" FOREIGN KEY ("source_definition_version_id") REFERENCES "api"."sheet_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_duplicated_from_instance_id_sheet_instances_id_fk" FOREIGN KEY ("duplicated_from_instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instances" ADD CONSTRAINT "sheet_instances_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_instances_workspace" ON "api"."sheet_instances" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_sheet_instances_source_version" ON "api"."sheet_instances" USING btree ("source_definition_version_id");