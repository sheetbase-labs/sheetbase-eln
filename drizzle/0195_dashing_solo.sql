CREATE TABLE "api"."dataset_version_flags" (
	"dataset_version_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"comment" text,
	"set_by_user_id" text,
	"set_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dataset_version_flags_dataset_version_id_row_id_field_id_kind_pk" PRIMARY KEY("dataset_version_id","row_id","field_id","kind")
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "dataset_version_flags_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "api"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_flags" ADD CONSTRAINT "dataset_version_flags_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;