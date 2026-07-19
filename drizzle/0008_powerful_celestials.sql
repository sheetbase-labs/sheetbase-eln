CREATE TABLE "api"."blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"payload_schema_version" integer DEFAULT 1 NOT NULL,
	"order" real NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "chk_blocks_type" CHECK ("api"."blocks"."type" IN ('heading', 'rich_text', 'checklist', 'linked_record', 'list', 'callout', 'table', 'chart', 'plate_map', 'file', 'metric', 'procedure_step'))
);
--> statement-breakpoint
CREATE TABLE "api"."folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"parent_id" uuid,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "uq_folders_project_identifier" UNIQUE("project_id","identifier")
);
--> statement-breakpoint
CREATE TABLE "api"."record_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_record_id" uuid NOT NULL,
	"target_record_id" uuid,
	"target_kind" text NOT NULL,
	"target_identifier" text NOT NULL,
	"link_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	CONSTRAINT "uq_record_links_source_target_type" UNIQUE("source_record_id","target_identifier","link_type"),
	CONSTRAINT "chk_record_links_link_type" CHECK ("api"."record_links"."link_type" IN ('sample', 'protocol', 'dataset', 'reagent', 'analysis', 'file', 'general'))
);
--> statement-breakpoint
CREATE TABLE "api"."records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"kind" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"structure_version" integer DEFAULT 1 NOT NULL,
	"metadata_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text,
	CONSTRAINT "uq_records_project_identifier" UNIQUE("project_id","identifier"),
	CONSTRAINT "chk_records_kind" CHECK ("api"."records"."kind" IN ('experiment', 'protocol_template', 'report'))
);
--> statement-breakpoint
CREATE TABLE "api"."revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"record_id" uuid NOT NULL,
	"structure_version" integer NOT NULL,
	"metadata_version" integer NOT NULL,
	"metadata_snapshot" jsonb NOT NULL,
	"block_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"superseded_by_revision_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	CONSTRAINT "chk_revisions_reason" CHECK ("api"."revisions"."reason" IN ('submit', 'sign', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "blocks_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "blocks_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."blocks" ADD CONSTRAINT "blocks_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."folders" ADD CONSTRAINT "folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_links" ADD CONSTRAINT "record_links_source_record_id_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_links" ADD CONSTRAINT "record_links_target_record_id_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "api"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_links" ADD CONSTRAINT "record_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "api"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."revisions" ADD CONSTRAINT "revisions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."revisions" ADD CONSTRAINT "revisions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_blocks_record_id" ON "api"."blocks" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_record_order" ON "api"."blocks" USING btree ("record_id","order");--> statement-breakpoint
CREATE INDEX "idx_folders_project_id" ON "api"."folders" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_folders_parent_id" ON "api"."folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_record_links_source_record_id" ON "api"."record_links" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "idx_record_links_target_record_id" ON "api"."record_links" USING btree ("target_record_id");--> statement-breakpoint
CREATE INDEX "idx_record_links_link_type" ON "api"."record_links" USING btree ("link_type");--> statement-breakpoint
CREATE INDEX "idx_records_workspace_id" ON "api"."records" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_records_project_id" ON "api"."records" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_records_folder_id" ON "api"."records" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "idx_records_kind" ON "api"."records" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_records_status" ON "api"."records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_revisions_record_id" ON "api"."revisions" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "idx_revisions_created_at" ON "api"."revisions" USING btree ("created_at");