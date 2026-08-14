CREATE TABLE "api"."dataset_schema_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "uq_dataset_schema_definitions_workspace_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "chk_dataset_schema_definitions_key" CHECK ("api"."dataset_schema_definitions"."key" ~ '^[a-z][a-z0-9_]{0,59}$'),
	CONSTRAINT "chk_dataset_schema_definitions_lifecycle" CHECK ("api"."dataset_schema_definitions"."lifecycle" IN ('draft','active','retired'))
);
--> statement-breakpoint
CREATE TABLE "api"."dataset_schema_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_by_user_id" text,
	CONSTRAINT "uq_dataset_schema_versions_schema_version" UNIQUE("schema_id","version"),
	CONSTRAINT "chk_dataset_schema_versions_version" CHECK ("api"."dataset_schema_versions"."version" > 0),
	CONSTRAINT "chk_dataset_schema_versions_lifecycle" CHECK ("api"."dataset_schema_versions"."lifecycle" IN ('draft','active','retired'))
);
--> statement-breakpoint
CREATE TABLE "api"."datasets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"primary_project_id" uuid,
	"schema_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "chk_datasets_lifecycle" CHECK ("api"."datasets"."lifecycle" IN ('active','archived')),
	CONSTRAINT "chk_datasets_revision" CHECK ("api"."datasets"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_definitions" ADD CONSTRAINT "dataset_schema_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_definitions" ADD CONSTRAINT "dataset_schema_definitions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_versions" ADD CONSTRAINT "dataset_schema_versions_schema_id_dataset_schema_definitions_id_fk" FOREIGN KEY ("schema_id") REFERENCES "api"."dataset_schema_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_versions" ADD CONSTRAINT "dataset_schema_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "datasets_primary_project_id_projects_id_fk" FOREIGN KEY ("primary_project_id") REFERENCES "api"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "datasets_schema_version_id_dataset_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "api"."dataset_schema_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "datasets_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_definitions_workspace" ON "api"."dataset_schema_definitions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_versions_schema" ON "api"."dataset_schema_versions" USING btree ("schema_id");--> statement-breakpoint
CREATE INDEX "idx_datasets_workspace" ON "api"."datasets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_datasets_schema_version" ON "api"."datasets" USING btree ("schema_version_id");