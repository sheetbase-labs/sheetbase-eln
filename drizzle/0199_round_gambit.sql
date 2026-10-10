CREATE TABLE "api"."notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_notification_preferences_user_event" UNIQUE("user_id","event_type"),
	CONSTRAINT "chk_notification_preferences_event" CHECK ("api"."notification_preferences"."event_type" IN ('review_requested', 'signature_requested', 'data_issue', 'run_waiting', 'run_failed', 'material_expiring', 'approval_required', 'conflict'))
);
--> statement-breakpoint
ALTER TABLE "api"."user_preferences" ADD COLUMN "quiet_hours_start" text;--> statement-breakpoint
ALTER TABLE "api"."user_preferences" ADD COLUMN "quiet_hours_end" text;--> statement-breakpoint
ALTER TABLE "api"."user_preferences" ADD COLUMN "digest_time" text;--> statement-breakpoint
ALTER TABLE "api"."notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;