CREATE TABLE "api"."label_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"record_kind" text NOT NULL,
	"show_condition" boolean DEFAULT true NOT NULL,
	"show_use_by" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_label_templates_workspace_name" UNIQUE("workspace_id","name"),
	CONSTRAINT "chk_label_templates_name" CHECK (length(btrim("api"."label_templates"."name")) between 1 and 120),
	CONSTRAINT "chk_label_templates_record_kind" CHECK (length(btrim("api"."label_templates"."record_kind")) between 1 and 48)
);
--> statement-breakpoint
ALTER TABLE "api"."label_templates" ADD CONSTRAINT "label_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."label_templates" ADD CONSTRAINT "label_templates_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_label_templates_workspace" ON "api"."label_templates" USING btree ("workspace_id");
--> statement-breakpoint

-- LAB-05.1: a template is workspace configuration, readable by the workspace so the
-- sample inspector can preview the label it produces. Writes belong to the RPCs that
-- own configuration, not to a direct table grant.
ALTER TABLE api.label_templates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY label_templates_select ON api.label_templates
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.label_templates TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';