CREATE TABLE "api"."instrument_qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"granted_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_instrument_qualifications_instrument_user" UNIQUE("instrument_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "api"."instruments" ADD COLUMN "qualified_for" text;--> statement-breakpoint
ALTER TABLE "api"."instrument_qualifications" ADD CONSTRAINT "instrument_qualifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_qualifications" ADD CONSTRAINT "instrument_qualifications_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "api"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_qualifications" ADD CONSTRAINT "instrument_qualifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."instrument_qualifications" ADD CONSTRAINT "instrument_qualifications_granted_by_user_id_user_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_instrument_qualifications_workspace" ON "api"."instrument_qualifications" USING btree ("workspace_id");