CREATE TABLE "api"."sheet_definition_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"configuration_format_version" integer DEFAULT 1 NOT NULL,
	"configuration" jsonb NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"published_at" timestamp with time zone,
	"published_by_user_id" text,
	"retired_at" timestamp with time zone,
	"retired_by_user_id" text,
	CONSTRAINT "uq_sheet_definition_versions_definition_version" UNIQUE("definition_id","version"),
	CONSTRAINT "chk_sheet_definition_versions_version" CHECK ("api"."sheet_definition_versions"."version" > 0),
	CONSTRAINT "chk_sheet_definition_versions_lifecycle" CHECK ("api"."sheet_definition_versions"."lifecycle" IN ('draft','published','retired')),
	CONSTRAINT "chk_sheet_definition_versions_format" CHECK ("api"."sheet_definition_versions"."configuration_format_version" = 1),
	CONSTRAINT "chk_sheet_definition_versions_revision" CHECK ("api"."sheet_definition_versions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "api"."sheet_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_sheet_definitions_workspace_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "chk_sheet_definitions_key" CHECK ("api"."sheet_definitions"."key" ~ '^[a-z][a-z0-9_]{0,59}$'),
	CONSTRAINT "chk_sheet_definitions_lifecycle" CHECK ("api"."sheet_definitions"."lifecycle" IN ('active','retired')),
	CONSTRAINT "chk_sheet_definitions_revision" CHECK ("api"."sheet_definitions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_definition_versions" ADD CONSTRAINT "sheet_definition_versions_definition_id_sheet_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "api"."sheet_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definition_versions" ADD CONSTRAINT "sheet_definition_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definition_versions" ADD CONSTRAINT "sheet_definition_versions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definition_versions" ADD CONSTRAINT "sheet_definition_versions_published_by_user_id_user_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definition_versions" ADD CONSTRAINT "sheet_definition_versions_retired_by_user_id_user_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definitions" ADD CONSTRAINT "sheet_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definitions" ADD CONSTRAINT "sheet_definitions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_definitions" ADD CONSTRAINT "sheet_definitions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_definition_versions_definition" ON "api"."sheet_definition_versions" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "idx_sheet_definitions_workspace" ON "api"."sheet_definitions" USING btree ("workspace_id");
