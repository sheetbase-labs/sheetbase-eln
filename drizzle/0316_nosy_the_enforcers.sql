CREATE TABLE "api"."signature_witness_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"revision_digest" text NOT NULL,
	"witness_user_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"requested_session_id" text NOT NULL,
	"due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "uq_signature_witness_request" UNIQUE("submission_id","witness_user_id"),
	CONSTRAINT "chk_signature_witness_digest" CHECK ("api"."signature_witness_requests"."revision_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_signature_witness_requester" CHECK ("api"."signature_witness_requests"."witness_user_id" <> "api"."signature_witness_requests"."requested_by_user_id")
);
--> statement-breakpoint
ALTER TABLE "api"."signatures" DROP CONSTRAINT "uq_signatures_submission_signer";--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" DROP CONSTRAINT "chk_signature_grants_purpose";--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" DROP CONSTRAINT "chk_signature_grants_binding";--> statement-breakpoint
ALTER TABLE "api"."signatures" DROP CONSTRAINT "chk_signatures_meaning";--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD COLUMN "signature_meaning" text;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD COLUMN "submission_arguments" jsonb;--> statement-breakpoint
ALTER TABLE "api"."signatures" ADD COLUMN "signer_name" text;--> statement-breakpoint
ALTER TABLE "api"."signature_witness_requests" ADD CONSTRAINT "signature_witness_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."signature_witness_requests" ADD CONSTRAINT "signature_witness_requests_submission_id_review_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "api"."review_submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."signature_witness_requests" ADD CONSTRAINT "signature_witness_requests_witness_user_id_user_id_fk" FOREIGN KEY ("witness_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."signature_witness_requests" ADD CONSTRAINT "signature_witness_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "signature_grants_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."signatures" ADD CONSTRAINT "uq_signatures_submission_signer_meaning" UNIQUE("submission_id","signer_user_id","signature_meaning");--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "chk_signature_grants_purpose" CHECK ("internal"."signature_grants"."purpose" IN ('sign', 'author-submit', 'certify', 'practice', 'enroll', 'recover'));--> statement-breakpoint
ALTER TABLE "internal"."signature_grants" ADD CONSTRAINT "chk_signature_grants_binding" CHECK (("internal"."signature_grants"."purpose" = 'sign' AND "internal"."signature_grants"."submission_id" IS NOT NULL AND "internal"."signature_grants"."revision_digest" ~ '^[0-9a-f]{64}$' AND "internal"."signature_grants"."record_id" IS NULL AND "internal"."signature_grants"."submission_arguments" IS NULL) OR ("internal"."signature_grants"."purpose" = 'author-submit' AND "internal"."signature_grants"."submission_id" IS NULL AND "internal"."signature_grants"."revision_digest" ~ '^[0-9a-f]{64}$' AND "internal"."signature_grants"."record_id" IS NOT NULL AND "internal"."signature_grants"."signature_meaning" = 'authored' AND jsonb_typeof("internal"."signature_grants"."submission_arguments") = 'object') OR ("internal"."signature_grants"."purpose" NOT IN ('sign', 'author-submit') AND "internal"."signature_grants"."submission_id" IS NULL AND "internal"."signature_grants"."revision_digest" IS NULL AND "internal"."signature_grants"."record_id" IS NULL AND "internal"."signature_grants"."signature_meaning" IS NULL AND "internal"."signature_grants"."submission_arguments" IS NULL));--> statement-breakpoint
ALTER TABLE "api"."signatures" ADD CONSTRAINT "chk_signatures_meaning" CHECK ("api"."signatures"."signature_meaning" IN ('approve-for-record', 'witness', 'authored', 'reviewed', 'reviewed-and-approved', 'witnessed'));