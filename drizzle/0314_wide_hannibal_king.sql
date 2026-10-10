CREATE TABLE "internal"."signature_authentication_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal"."signature_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"submission_id" uuid,
	"revision_digest" text,
	"authorization_id" uuid,
	"auth_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "chk_signature_grants_purpose" CHECK ("internal"."signature_grants"."purpose" IN ('sign', 'certify', 'practice', 'enroll', 'recover')),
	CONSTRAINT "chk_signature_grants_auth_method" CHECK ("internal"."signature_grants"."auth_method" = 'password'),
	CONSTRAINT "chk_signature_grants_binding" CHECK (("internal"."signature_grants"."purpose" = 'sign' AND "internal"."signature_grants"."submission_id" IS NOT NULL AND "internal"."signature_grants"."revision_digest" ~ '^[0-9a-f]{64}$') OR ("internal"."signature_grants"."purpose" <> 'sign' AND "internal"."signature_grants"."submission_id" IS NULL AND "internal"."signature_grants"."revision_digest" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "internal"."signature_password_attempts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api"."signatures" DROP CONSTRAINT "chk_signatures_auth_method";--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ALTER COLUMN "statement_version" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ALTER COLUMN "certified_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ALTER COLUMN "certified_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "identity_verified_by" text;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "identity_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "verified_email" text;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "credential_session_id" text;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "credential_authorization_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "credential_authorization_consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "certified_session_id" text;--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD COLUMN "auth_method" text;--> statement-breakpoint
ALTER TABLE "internal"."signature_authentication_events" ADD CONSTRAINT "signature_authentication_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_authentication_events" ADD CONSTRAINT "signature_authentication_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "signature_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "signature_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "signature_grants_submission_id_review_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "api"."review_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_password_attempts" ADD CONSTRAINT "signature_password_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_signature_grants_user" ON "internal"."signature_grants" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "api"."user_signature_certifications" ADD CONSTRAINT "user_signature_certifications_identity_verified_by_user_id_fk" FOREIGN KEY ("identity_verified_by") REFERENCES "internal"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."signatures" ADD CONSTRAINT "chk_signatures_auth_method" CHECK ("api"."signatures"."auth_method" IN ('session+name-confirmation', 'password'));