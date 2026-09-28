CREATE TABLE "api"."dataset_value_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"set_by_user_id" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by_user_id" text,
	CONSTRAINT "chk_dataset_value_flags_kind" CHECK ("api"."dataset_value_flags"."kind" IN ('out_of_range', 'missing_unit', 'above_curve', 'high_cv')),
	CONSTRAINT "chk_dataset_value_flags_reason" CHECK (length(btrim("api"."dataset_value_flags"."reason")) BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "dataset_value_flags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "dataset_value_flags_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "dataset_value_flags_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_value_flags" ADD CONSTRAINT "dataset_value_flags_cleared_by_user_id_user_id_fk" FOREIGN KEY ("cleared_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_value_flags_value" ON "api"."dataset_value_flags" USING btree ("dataset_id","row_id","field_id");