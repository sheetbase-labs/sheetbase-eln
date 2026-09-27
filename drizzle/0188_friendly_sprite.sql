CREATE TABLE "api"."dataset_version_keeps" (
	"dataset_version_id" uuid PRIMARY KEY NOT NULL,
	"kept_until" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	CONSTRAINT "chk_dataset_version_keeps_reason" CHECK (length(btrim("api"."dataset_version_keeps"."reason")) BETWEEN 1 AND 500)
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_version_keeps" ADD CONSTRAINT "dataset_version_keeps_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "api"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_version_keeps" ADD CONSTRAINT "dataset_version_keeps_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;