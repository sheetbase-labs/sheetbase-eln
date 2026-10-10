CREATE TABLE "api"."folder_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_folder_items_object" UNIQUE("workspace_id","object_kind","object_id"),
	CONSTRAINT "chk_folder_items_kind" CHECK ("api"."folder_items"."object_kind" IN ('sheet_instance', 'dataset', 'analysis_view', 'pipeline_definition'))
);
--> statement-breakpoint
ALTER TABLE "api"."folder_items" ADD CONSTRAINT "folder_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."folder_items" ADD CONSTRAINT "folder_items_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "api"."folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."folder_items" ADD CONSTRAINT "folder_items_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_folder_items_folder" ON "api"."folder_items" USING btree ("folder_id");