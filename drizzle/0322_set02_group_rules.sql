CREATE TABLE "api"."project_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_project_access_request_status" CHECK ("api"."project_access_requests"."status" IN ('pending', 'approved', 'denied')),
	CONSTRAINT "chk_project_access_request_reason" CHECK (length(btrim("api"."project_access_requests"."reason")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "api"."workspace_group_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_group_membership" UNIQUE("workspace_id","group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "api"."workspace_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_groups_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "uq_workspace_groups_workspace_name" UNIQUE("workspace_id","name"),
	CONSTRAINT "chk_workspace_groups_name" CHECK (length(btrim("api"."workspace_groups"."name")) BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "api"."project_access" DROP CONSTRAINT "chk_project_access_access_level";--> statement-breakpoint
ALTER TABLE "api"."project_access" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "can_view" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "can_edit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "can_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "client_portal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD COLUMN "can_manage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."project_access_requests" ADD CONSTRAINT "project_access_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "internal"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_access_requests" ADD CONSTRAINT "project_access_requests_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "api"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_access_requests" ADD CONSTRAINT "project_access_requests_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "api"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_group_memberships" ADD CONSTRAINT "workspace_group_memberships_workspace_id_group_id_workspace_groups_workspace_id_id_fk" FOREIGN KEY ("workspace_id","group_id") REFERENCES "api"."workspace_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_group_memberships" ADD CONSTRAINT "workspace_group_memberships_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "api"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_groups" ADD CONSTRAINT "workspace_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_access_pending_request" ON "api"."project_access_requests" USING btree ("project_id","user_id") WHERE "api"."project_access_requests"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "project_access_workspace_id_project_id_projects_workspace_id_id_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "api"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "project_access_workspace_id_user_id_workspace_memberships_workspace_id_user_id_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "api"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "project_access_workspace_id_group_id_workspace_groups_workspace_id_id_fk" FOREIGN KEY ("workspace_id","group_id") REFERENCES "api"."workspace_groups"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "uq_project_access_workspace_project_group" UNIQUE("workspace_id","project_id","group_id");--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "chk_project_access_principal" CHECK (("api"."project_access"."user_id" IS NULL) <> ("api"."project_access"."group_id" IS NULL));--> statement-breakpoint
ALTER TABLE "api"."project_access" ADD CONSTRAINT "chk_project_access_access_level" CHECK ("api"."project_access"."access_level" IN ('owner', 'editor', 'reviewer', 'viewer'));