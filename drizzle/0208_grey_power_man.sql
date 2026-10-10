ALTER TABLE "api"."datasets" ADD COLUMN "display_id" text;--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "uq_datasets_workspace_display_id" UNIQUE("workspace_id","display_id");--> statement-breakpoint
ALTER TABLE "api"."datasets" ADD CONSTRAINT "chk_datasets_display_id" CHECK ("api"."datasets"."display_id" IS NULL OR "api"."datasets"."display_id" ~ '^DS-[0-9]{4,}$');