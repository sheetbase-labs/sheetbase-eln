CREATE TABLE "api"."sheet_cell_search" (
	"instance_id" uuid NOT NULL,
	"row_key" text NOT NULL,
	"field_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"field_label" text NOT NULL,
	"value_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(value_text, '') || ' ' || coalesce(field_label, ''))) STORED,
	CONSTRAINT "sheet_cell_search_instance_id_row_key_field_id_pk" PRIMARY KEY("instance_id","row_key","field_id")
);
--> statement-breakpoint
ALTER TABLE "api"."sheet_cell_search" ADD CONSTRAINT "sheet_cell_search_instance_id_sheet_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "api"."sheet_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_cell_search" ADD CONSTRAINT "sheet_cell_search_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."sheet_cell_search" ADD CONSTRAINT "sheet_cell_search_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sheet_cell_search_vector" ON "api"."sheet_cell_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_sheet_cell_search_workspace" ON "api"."sheet_cell_search" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_sheet_cell_search_instance" ON "api"."sheet_cell_search" USING btree ("instance_id");