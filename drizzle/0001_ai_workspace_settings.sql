-- AI-04 — workspace AI policy.
--
-- Provider profiles and their keys stay in the deployment environment; this
-- table only selects a profile id and bounds the calls the workspace allows.
-- `ai_enabled` is the kill switch: off means no assistant request is served,
-- even if a provider is configured. Cloud profiles additionally require
-- `ai_cloud_egress_enabled`, an explicit owner-recorded consent, before any
-- prompt can leave the deployment.
--
-- RLS is unchanged: every member can read the row, only an owner can update
-- it. The existing workspace_settings change-event trigger records the owner's
-- edit, including the AI fields, without adding a second audit path.

ALTER TABLE "api"."workspace_settings"
  ADD COLUMN "ai_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN "ai_provider_profile" text,
  ADD COLUMN "ai_model" text DEFAULT 'sheetbase-assist-1' NOT NULL,
  ADD COLUMN "ai_cloud_egress_enabled" boolean DEFAULT false NOT NULL,
  ADD COLUMN "ai_max_tokens_per_call" integer DEFAULT 8000 NOT NULL,
  ADD COLUMN "ai_max_cost_microusd_per_call" integer DEFAULT 50000 NOT NULL,
  ADD COLUMN "ai_updated_by_user_id" text;
--> statement-breakpoint

ALTER TABLE "api"."workspace_settings"
  ADD CONSTRAINT "chk_workspace_settings_ai_max_tokens"
  CHECK ("ai_max_tokens_per_call" > 0);
--> statement-breakpoint

ALTER TABLE "api"."workspace_settings"
  ADD CONSTRAINT "chk_workspace_settings_ai_max_cost"
  CHECK ("ai_max_cost_microusd_per_call" >= 0);
--> statement-breakpoint

ALTER TABLE "api"."workspace_settings"
  ADD CONSTRAINT "workspace_settings_ai_updated_by_user_id_fkey"
  FOREIGN KEY ("ai_updated_by_user_id")
  REFERENCES "internal"."user"("id")
  ON DELETE SET NULL;
