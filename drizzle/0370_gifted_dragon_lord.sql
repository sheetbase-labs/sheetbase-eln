ALTER TABLE "api"."file_objects" ADD COLUMN "previous_version_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."file_objects" ADD COLUMN "retention_until" timestamp with time zone;