ALTER TABLE "api"."dataset_rows" ADD COLUMN "status" text DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_rows" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."dataset_rows" ADD CONSTRAINT "chk_dataset_rows_status" CHECK ("api"."dataset_rows"."status" IN ('planned', 'recorded'));