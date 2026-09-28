ALTER TABLE "api"."file_objects" ADD COLUMN "extracted_text" text;--> statement-breakpoint
ALTER TABLE "api"."file_objects" ADD COLUMN "extracted_at" timestamp with time zone;