CREATE TABLE "api"."user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"appearance" text DEFAULT 'system' NOT NULL,
	"nav_collapsed" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_preferences_user" UNIQUE("user_id"),
	CONSTRAINT "chk_user_preferences_appearance" CHECK ("api"."user_preferences"."appearance" IN ('system', 'light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "api"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;