CREATE TABLE "internal"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_account_provider_account" UNIQUE("providerId","accountId")
);
--> statement-breakpoint
CREATE TABLE "api"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "uq_projects_workspace_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "chk_projects_status" CHECK ("api"."projects"."status" IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "internal"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "internal"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "internal"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api"."workspace_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_workspace_memberships_workspace_user" UNIQUE("workspace_id","user_id"),
	CONSTRAINT "chk_workspace_memberships_role" CHECK ("api"."workspace_memberships"."role" IN ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "api"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "chk_workspaces_status" CHECK ("api"."workspaces"."status" IN ('active', 'suspended', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "internal"."account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_user_id" ON "internal"."account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_projects_workspace_id" ON "api"."projects" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_session_user_id" ON "internal"."session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_workspace_memberships_user_id" ON "api"."workspace_memberships" USING btree ("user_id");--> statement-breakpoint

-- updated_at is database-maintained on api tables: any UPDATE stamps the row.
CREATE OR REPLACE FUNCTION "internal"."set_updated_at"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."updated_at" := now();
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."workspaces"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."workspace_memberships"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."projects"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint

-- Exposed-surface grants. anon gets nothing; RLS (AUTH-004) narrows
-- authenticated to the caller's workspace.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON "api"."workspaces", "api"."workspace_memberships", "api"."projects"
  TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';