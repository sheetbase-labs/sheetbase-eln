CREATE TABLE "api"."clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "uq_clients_workspace_code" UNIQUE("workspace_id","code"),
	CONSTRAINT "chk_clients_code" CHECK ("api"."clients"."code" ~ '^CL-[0-9]{3,}$'),
	CONSTRAINT "chk_clients_name" CHECK (length(btrim("api"."clients"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "display_id" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "modality" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "lead_user_id" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "default_reviewer_user_id" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "agreement_reference" text;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "started_on" date;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "revision" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."clients" ADD CONSTRAINT "clients_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."clients" ADD CONSTRAINT "clients_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_clients_workspace" ON "api"."clients" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "projects_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "api"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "projects_lead_user_id_user_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "projects_default_reviewer_user_id_user_id_fk" FOREIGN KEY ("default_reviewer_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "uq_projects_workspace_display_id" UNIQUE("workspace_id","display_id");--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "chk_projects_display_id" CHECK ("api"."projects"."display_id" IS NULL OR "api"."projects"."display_id" ~ '^PRJ-[0-9]{4,}$');--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "chk_projects_revision" CHECK ("api"."projects"."revision" > 0);