CREATE TABLE "api"."work_item_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_work_item_follows_user_record" UNIQUE("user_id","record_id")
);
--> statement-breakpoint
ALTER TABLE "api"."work_item_follows" ADD CONSTRAINT "work_item_follows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."work_item_follows" ADD CONSTRAINT "work_item_follows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."work_item_follows" ADD CONSTRAINT "work_item_follows_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_work_item_follows_user_created" ON "api"."work_item_follows" USING btree ("user_id","created_at");