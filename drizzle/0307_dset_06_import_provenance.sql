ALTER TABLE "api"."dataset_imports" ALTER COLUMN "file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD COLUMN "connector_run_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD COLUMN "imported_row_ids" jsonb DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD COLUMN "parser_provenance" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD COLUMN "source_provenance" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD COLUMN "intended_use" text DEFAULT 'exploratory_research' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "dataset_imports_connector_run_id_connector_runs_id_fk" FOREIGN KEY ("connector_run_id") REFERENCES "api"."connector_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_imports" ADD CONSTRAINT "chk_dataset_imports_source" CHECK ("api"."dataset_imports"."file_id" IS NOT NULL OR "api"."dataset_imports"."connector_run_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "chk_datasets_intended_use" CHECK ("api"."datasets"."intended_use" IN ('exploratory_research', 'controlled_development', 'regulated_record'));