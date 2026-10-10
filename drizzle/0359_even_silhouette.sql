ALTER TABLE "api"."workspace_settings" ADD COLUMN "require_change_reason" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."workspace_settings" ADD COLUMN "lock_on_sign" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."workspace_settings" ADD COLUMN "allow_offline_editing" boolean DEFAULT true NOT NULL;