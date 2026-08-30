CREATE TABLE "api"."agent_operation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"operation_kind" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_operation_policies_workspace_name" UNIQUE("workspace_id","name"),
	CONSTRAINT "chk_agent_operation_policies_kind" CHECK ("api"."agent_operation_policies"."operation_kind" IN ('dataset_schema.create','sheet_definition.create','sheet_definition.update_draft','pipeline_definition.create','pipeline_definition.create_version','pipeline_definition.update_draft','dataset_rows.commit')),
	CONSTRAINT "chk_agent_operation_policies_target_type" CHECK ("api"."agent_operation_policies"."target_type" IN ('workspace','project','record','dataset','pipeline_definition','dataset_schema','sheet_definition','sheet_definition_version')),
	CONSTRAINT "chk_agent_operation_policies_target_id" CHECK (("api"."agent_operation_policies"."target_type" = 'workspace' AND "api"."agent_operation_policies"."target_id" IS NULL) OR ("api"."agent_operation_policies"."target_type" <> 'workspace' AND "api"."agent_operation_policies"."target_id" IS NOT NULL)),
	CONSTRAINT "chk_agent_operation_policies_limits" CHECK (jsonb_typeof("api"."agent_operation_policies"."limits") = 'object' AND ("api"."agent_operation_policies"."limits"->>'maxAffectedRows' IS NULL OR (("api"."agent_operation_policies"."limits"->>'maxAffectedRows')::integer BETWEEN 1 AND 1000)))
);
--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" DROP CONSTRAINT "chk_agent_operation_proposals_policy";--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" DROP CONSTRAINT "chk_agent_operation_proposals_approval_actor";--> statement-breakpoint
ALTER TABLE "internal"."api_credentials" DROP CONSTRAINT "chk_api_credentials_scopes";--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "risk_class" text DEFAULT 'consequential_write' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "policy_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "policy_limits" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "policy_target" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "policy_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD COLUMN "executed_by_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_policies" ADD CONSTRAINT "agent_operation_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_policies" ADD CONSTRAINT "agent_operation_policies_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_policies" ADD CONSTRAINT "agent_operation_policies_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_operation_policies_workspace" ON "api"."agent_operation_policies" USING btree ("workspace_id","enabled","operation_kind");--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "agent_operation_proposals_policy_id_agent_operation_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "api"."agent_operation_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "agent_operation_proposals_executed_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("executed_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "chk_agent_operation_proposals_risk" CHECK ("api"."agent_operation_proposals"."risk_class" IN ('safe_draft','consequential_write'));--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "chk_agent_operation_proposals_policy_payload" CHECK (jsonb_typeof("api"."agent_operation_proposals"."policy_limits") = 'object' AND jsonb_typeof("api"."agent_operation_proposals"."policy_target") = 'object' AND jsonb_typeof("api"."agent_operation_proposals"."policy_evidence") = 'object');--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "chk_agent_operation_proposals_execution_actor" CHECK ("api"."agent_operation_proposals"."status" NOT IN ('executing','succeeded','failed') OR (("api"."agent_operation_proposals"."executed_by_user_id" IS NOT NULL)::int + ("api"."agent_operation_proposals"."executed_by_credential_id" IS NOT NULL)::int) = 1);--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "chk_agent_operation_proposals_policy" CHECK ("api"."agent_operation_proposals"."approval_policy" IN ('automatic','human_required','delegated'));--> statement-breakpoint
ALTER TABLE "api"."agent_operation_proposals" ADD CONSTRAINT "chk_agent_operation_proposals_approval_actor" CHECK ("api"."agent_operation_proposals"."approval_policy" <> 'human_required' OR "api"."agent_operation_proposals"."status" NOT IN ('approved','executing','succeeded','failed') OR ("api"."agent_operation_proposals"."approved_by_user_id" IS NOT NULL AND "api"."agent_operation_proposals"."approved_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "internal"."api_credentials" ADD CONSTRAINT "chk_api_credentials_scopes" CHECK (cardinality("internal"."api_credentials"."scopes") > 0 AND "internal"."api_credentials"."scopes" <@ ARRAY['projects:read','projects:write','datasets:read','datasets:write','schema:read','schema:write','schema:publish','sheets:read','sheets:write','models:read','models:write','templates:read','templates:write','reviews:read','reviews:write','files:read','files:write','webhooks:read','webhooks:write','agent_operations:read','agent_operations:write']::text[]);