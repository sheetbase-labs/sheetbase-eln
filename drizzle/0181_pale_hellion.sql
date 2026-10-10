ALTER TABLE "api"."projects" ADD COLUMN "require_effective_protocol" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "require_independent_reviewer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."projects" ADD COLUMN "auto_share_to_client" boolean DEFAULT false NOT NULL;