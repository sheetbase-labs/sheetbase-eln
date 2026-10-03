ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "system_rule" text;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "evaluated_value" jsonb;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "threshold" jsonb;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD COLUMN "cleared_reason" text;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD COLUMN "system_rule" text;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD COLUMN "evaluated_value" jsonb;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD COLUMN "threshold" jsonb;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD COLUMN "evaluated_at" timestamp with time zone;--> statement-breakpoint
-- DSET-01.1 — backfill provenance for flags written before the rule columns
-- existed: the rule that produced a system flag is its kind, and it was last
-- evaluated when it was set. Manual flags stay without provenance.
UPDATE "api"."dataset_value_flags"
   SET "system_rule" = "kind", "evaluated_at" = "set_at"
 WHERE "source" = 'system' AND "system_rule" IS NULL;--> statement-breakpoint
UPDATE "api"."dataset_version_flags"
   SET "system_rule" = "kind", "evaluated_at" = "set_at"
 WHERE "source" = 'system' AND "system_rule" IS NULL;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "chk_dataset_value_flags_system_rule" CHECK ("api"."dataset_value_flags"."system_rule" IS NULL OR "api"."dataset_value_flags"."system_rule" IN ('out_of_range', 'missing_unit', 'high_cv'));--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "chk_dataset_value_flags_provenance" CHECK (("api"."dataset_value_flags"."source" = 'manual' AND "api"."dataset_value_flags"."system_rule" IS NULL) OR ("api"."dataset_value_flags"."source" = 'system' AND "api"."dataset_value_flags"."system_rule" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "chk_dataset_value_flags_cleared_reason" CHECK ("api"."dataset_value_flags"."cleared_reason" IS NULL OR "api"."dataset_value_flags"."cleared_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "chk_dataset_version_flags_system_rule" CHECK ("api"."dataset_version_flags"."system_rule" IS NULL OR "api"."dataset_version_flags"."system_rule" IN ('out_of_range', 'missing_unit', 'high_cv'));--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "chk_dataset_version_flags_provenance" CHECK (("api"."dataset_version_flags"."source" = 'manual' AND "api"."dataset_version_flags"."system_rule" IS NULL) OR ("api"."dataset_version_flags"."source" = 'system' AND "api"."dataset_version_flags"."system_rule" IS NOT NULL));