CREATE TABLE "api"."dataset_version_prunes" (
	"dataset_version_id" uuid PRIMARY KEY NOT NULL,
	"rows_removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pruned_row_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_version_prunes" ADD CONSTRAINT "dataset_version_prunes_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "api"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;