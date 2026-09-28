ALTER TABLE "api"."workspace_settings" ADD COLUMN "site" text;--> statement-breakpoint
ALTER TABLE "api"."workspace_settings" ADD COLUMN "timezone" text DEFAULT 'Europe/London' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."workspace_settings" ADD COLUMN "date_format" text DEFAULT 'd MMM yyyy' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."workspace_settings" ADD COLUMN "number_format" text DEFAULT 'decimal' NOT NULL;