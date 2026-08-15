CREATE TABLE "api"."sheet_instance_calculation_mutations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"retry_token" uuid NOT NULL,
	"request_digest" text NOT NULL,
	"operation" text NOT NULL,
	"result_revision" bigint NOT NULL,
	"result" jsonb NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sheet_calculation_mutation_retry" UNIQUE("instance_id","retry_token"),
	CONSTRAINT "chk_sheet_calculation_mutation_digest" CHECK ("api"."sheet_instance_calculation_mutations"."request_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_sheet_calculation_mutation_operation" CHECK ("api"."sheet_instance_calculation_mutations"."operation" IN ('definition_mutation','recalculate')),
	CONSTRAINT "chk_sheet_calculation_mutation_revision" CHECK ("api"."sheet_instance_calculation_mutations"."result_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "internal"."sheet_instance_calculation_results" (
	"instance_id" uuid NOT NULL,
	"calculation_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"definition_version_id" uuid,
	"instance_revision" bigint NOT NULL,
	"expression" jsonb NOT NULL,
	"dependencies" jsonb NOT NULL,
	"output_field" jsonb NOT NULL,
	"source_revisions" jsonb NOT NULL,
	"dependency_provenance" jsonb NOT NULL,
	"result_kind" text NOT NULL,
	"value" jsonb,
	"error_code" text,
	"diagnostic" text,
	"engine_version" text NOT NULL,
	"function_profile" text NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sheet_instance_calculation_results_instance_id_calculation_id_row_key_pk" PRIMARY KEY("instance_id","calculation_id","row_key"),
	CONSTRAINT "chk_sheet_calculation_result_row_key" CHECK ("internal"."sheet_instance_calculation_results"."row_key" ~ '^sb-row-v1:[0-9a-f]{64}$' OR "internal"."sheet_instance_calculation_results"."row_key" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
	CONSTRAINT "chk_sheet_calculation_result_scope" CHECK ("internal"."sheet_instance_calculation_results"."scope" IN ('definition','instance')),
	CONSTRAINT "chk_sheet_calculation_result_kind" CHECK ("internal"."sheet_instance_calculation_results"."result_kind" IN ('value','error')),
	CONSTRAINT "chk_sheet_calculation_result_profile" CHECK ("internal"."sheet_instance_calculation_results"."engine_version" = '3.3.0' AND "internal"."sheet_instance_calculation_results"."function_profile" = 'scientific-core-v2')
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_calculation_mutations" ADD CONSTRAINT "sheet_instance_calculation_mutations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_calculation_mutations" ADD CONSTRAINT "sheet_instance_calculation_mutations_instance_id_sheet_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_instance_calculation_mutations" ADD CONSTRAINT "sheet_instance_calculation_mutations_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."sheet_instance_calculation_results" ADD CONSTRAINT "sheet_instance_calculation_results_instance_id_sheet_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."sheet_instance_calculation_results" ADD CONSTRAINT "sheet_instance_calculation_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal"."sheet_instance_calculation_results" ADD CONSTRAINT "sheet_instance_calculation_results_definition_version_id_sheet_definition_versions_id_fk" FOREIGN KEY ("definition_version_id") REFERENCES "api"."sheet_definition_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_calculation_mutations_instance" ON "api"."sheet_instance_calculation_mutations" USING btree ("instance_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sheet_calculation_results_instance" ON "internal"."sheet_instance_calculation_results" USING btree ("instance_id");