CREATE TABLE "api"."dataset_import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dataset_id" uuid,
	"filename" text NOT NULL,
	"media_type" text,
	"byte_size" bigint NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'stored' NOT NULL,
	"parse_error" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dataset_import_files_checksum" CHECK ("api"."dataset_import_files"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_dataset_import_files_status" CHECK ("api"."dataset_import_files"."status" IN ('stored', 'parsed', 'failed')),
	CONSTRAINT "chk_dataset_import_files_format" CHECK ("api"."dataset_import_files"."format" IN ('csv', 'tsv', 'xlsx', 'json')),
	CONSTRAINT "chk_dataset_import_files_size" CHECK ("api"."dataset_import_files"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "api"."dataset_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"experiment_record_id" uuid,
	"instrument_id" uuid,
	"parser_id" uuid,
	"parser_version_id" uuid,
	"file_id" uuid NOT NULL,
	"mapping" jsonb DEFAULT '{}' NOT NULL,
	"outcome" jsonb DEFAULT '{}' NOT NULL,
	"snapshot_version_id" uuid,
	"status" text DEFAULT 'preview' NOT NULL,
	"error_detail" text,
	"idempotency_key" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dataset_imports_status" CHECK ("api"."dataset_imports"."status" IN ('preview', 'committed', 'failed')),
	CONSTRAINT "chk_dataset_imports_idempotency_key" CHECK (length(btrim("api"."dataset_imports"."idempotency_key")) BETWEEN 1 AND 128),
	CONSTRAINT "chk_dataset_imports_committed" CHECK ("api"."dataset_imports"."status" <> 'committed' OR "api"."dataset_imports"."snapshot_version_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "api"."parser_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_id" uuid NOT NULL,
	"target_key" text NOT NULL,
	"mapping" jsonb DEFAULT '{}' NOT NULL,
	"is_default" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_parser_mappings_target_key" CHECK (length(btrim("api"."parser_mappings"."target_key")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "api"."parser_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"parser_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"signature" jsonb DEFAULT '{}' NOT NULL,
	"mapping" jsonb DEFAULT '{}' NOT NULL,
	"test_result" jsonb,
	"validated_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_parser_versions_status" CHECK ("api"."parser_versions"."status" IN ('draft', 'validated', 'approved', 'retired')),
	CONSTRAINT "chk_parser_versions_version" CHECK ("api"."parser_versions"."version" > 0),
	CONSTRAINT "chk_parser_versions_approved" CHECK ("api"."parser_versions"."approved_at" IS NULL OR "api"."parser_versions"."status" = 'approved')
);
--> statement-breakpoint
CREATE TABLE "api"."parsers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instrument_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"format" text NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_parsers_format" CHECK ("api"."parsers"."format" IN ('csv', 'tsv', 'xlsx', 'json')),
	CONSTRAINT "chk_parsers_key" CHECK (length(btrim("api"."parsers"."key")) BETWEEN 1 AND 200),
	CONSTRAINT "chk_parsers_name" CHECK (length(btrim("api"."parsers"."name")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."dataset_import_files" ADD CONSTRAINT "dataset_import_files_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_import_files" ADD CONSTRAINT "dataset_import_files_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_import_files" ADD CONSTRAINT "dataset_import_files_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_experiment_record_id_records_id_fk" FOREIGN KEY ("experiment_record_id") REFERENCES "api"."records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "api"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_parser_id_parsers_id_fk" FOREIGN KEY ("parser_id") REFERENCES "api"."parsers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_parser_version_id_parser_versions_id_fk" FOREIGN KEY ("parser_version_id") REFERENCES "api"."parser_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_file_id_dataset_import_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "api"."dataset_import_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_snapshot_version_id_dataset_versions_id_fk" FOREIGN KEY ("snapshot_version_id") REFERENCES "api"."dataset_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_mappings" ADD CONSTRAINT "parser_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_mappings" ADD CONSTRAINT "parser_mappings_parser_id_parsers_id_fk" FOREIGN KEY ("parser_id") REFERENCES "api"."parsers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_mappings" ADD CONSTRAINT "parser_mappings_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_versions" ADD CONSTRAINT "parser_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_versions" ADD CONSTRAINT "parser_versions_parser_id_parsers_id_fk" FOREIGN KEY ("parser_id") REFERENCES "api"."parsers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_versions" ADD CONSTRAINT "parser_versions_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parser_versions" ADD CONSTRAINT "parser_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parsers" ADD CONSTRAINT "parsers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parsers" ADD CONSTRAINT "parsers_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "api"."instruments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."parsers" ADD CONSTRAINT "parsers_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_import_files_workspace" ON "api"."dataset_import_files" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_import_files_dataset" ON "api"."dataset_import_files" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dataset_imports_workspace_idempotency" ON "api"."dataset_imports" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_dataset" ON "api"."dataset_imports" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_imports_experiment" ON "api"."dataset_imports" USING btree ("experiment_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_parser_mappings_default" ON "api"."parser_mappings" USING btree ("workspace_id","parser_id","target_key") WHERE "api"."parser_mappings"."is_default";--> statement-breakpoint
CREATE INDEX "idx_parser_mappings_parser" ON "api"."parser_mappings" USING btree ("parser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_parser_versions_parser_version" ON "api"."parser_versions" USING btree ("parser_id","version");--> statement-breakpoint
CREATE INDEX "idx_parser_versions_parser" ON "api"."parser_versions" USING btree ("parser_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_parsers_workspace_key" ON "api"."parsers" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "idx_parsers_workspace" ON "api"."parsers" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type" CHECK ("api"."change_events"."entity_type" IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation', 'record_field_definition', 'model_field_option', 'file', 'dataset_schema', 'dataset_schema_field', 'dataset_schema_relationship', 'dataset', 'dataset_version', 'sample_event', 'comment', 'review_submission', 'signature', 'review_decision', 'storage_site', 'storage_room', 'storage_unit', 'storage_shelf', 'storage_rack', 'storage_box', 'storage_position', 'storage_movement', 'plate_design', 'plate_well', 'plate_layout_template', 'calendar_resource', 'calendar_booking', 'calendar_booking_participant', 'calendar_booking_sample', 'study_workstream', 'study_task', 'study_task_dependency', 'study_task_assignment', 'study_task_resource', 'study_deliverable', 'study_project', 'study_experiment', 'study_plan_snapshot', 'instrument', 'instrument_run', 'instrument_run_stage', 'instrument_observation', 'instrument_plate_snapshot', 'instrument_qc_check', 'instrument_raw_file', 'instrument_run_link', 'report_definition', 'report_section', 'report_generation', 'sheet_instance', 'sheet_definition', 'sheet_definition_version', 'notebook_template', 'notebook_template_version', 'workspace_invitation', 'workspace_settings', 'project_access', 'api_credential', 'connector', 'connector_run', 'pipeline_definition', 'pipeline_definition_version', 'pipeline_run', 'pipeline_schedule', 'webhook_subscription', 'webhook_delivery', 'agent_operation_policy', 'agent_operation_proposal', 'extension', 'dataset_import_file', 'dataset_import', 'parser', 'parser_version'));