CREATE TABLE "api"."dataset_cell_search" (
	"dataset_version_id" uuid NOT NULL,
	"row_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"dataset_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"field_label" text NOT NULL,
	"value_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(value_text, '') || ' ' || coalesce(field_label, ''))) STORED,
	CONSTRAINT "dataset_cell_search_dataset_version_id_row_id_field_id_ordinal_pk" PRIMARY KEY("dataset_version_id","row_id","field_id","ordinal")
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_cell_search" ADD CONSTRAINT "dataset_cell_search_dataset_version_id_dataset_versions_id_fk" FOREIGN KEY ("dataset_version_id") REFERENCES "api"."dataset_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_cell_search" ADD CONSTRAINT "dataset_cell_search_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_cell_search" ADD CONSTRAINT "dataset_cell_search_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_cell_search_vector" ON "api"."dataset_cell_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_dataset_cell_search_workspace" ON "api"."dataset_cell_search" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_cell_search_dataset" ON "api"."dataset_cell_search" USING btree ("dataset_id");