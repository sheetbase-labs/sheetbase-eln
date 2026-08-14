CREATE TABLE "api"."dataset_row_values" (
	"row_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"text_value" text,
	"integer_value" bigint,
	"numeric_value" numeric,
	"boolean_value" boolean,
	"date_value" date,
	"timestamp_value" timestamp with time zone,
	"category_option_id" uuid,
	"reference_id" uuid,
	CONSTRAINT "dataset_row_values_row_id_field_id_pk" PRIMARY KEY("row_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "api"."dataset_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_dataset_rows_revision" CHECK ("api"."dataset_rows"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_row_values" ADD CONSTRAINT "dataset_row_values_row_id_dataset_rows_id_fk" FOREIGN KEY ("row_id") REFERENCES "api"."dataset_rows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_rows" ADD CONSTRAINT "dataset_rows_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "api"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."dataset_rows" ADD CONSTRAINT "dataset_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_row_values_field_numeric" ON "api"."dataset_row_values" USING btree ("field_id","numeric_value");--> statement-breakpoint
CREATE INDEX "idx_dataset_row_values_field_reference" ON "api"."dataset_row_values" USING btree ("field_id","reference_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_row_values_field_category" ON "api"."dataset_row_values" USING btree ("field_id","category_option_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_rows_dataset" ON "api"."dataset_rows" USING btree ("dataset_id");--> statement-breakpoint
CREATE INDEX "idx_dataset_rows_workspace" ON "api"."dataset_rows" USING btree ("workspace_id");
--> statement-breakpoint
ALTER TABLE api.dataset_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.dataset_row_values ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON api.dataset_rows, api.dataset_row_values TO authenticated;
CREATE POLICY dataset_rows_access ON api.dataset_rows FOR ALL TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)) WITH CHECK (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY dataset_row_values_access ON api.dataset_row_values FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM api.dataset_rows r WHERE r.id=row_id AND r.workspace_id=api.current_workspace_id() AND api.is_workspace_member(r.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM api.dataset_rows r WHERE r.id=row_id AND r.workspace_id=api.current_workspace_id() AND api.is_workspace_member(r.workspace_id)));
CREATE OR REPLACE FUNCTION internal.validate_dataset_row_value() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE field api.dataset_schema_version_fields; slots integer;
BEGIN
 SELECT f.* INTO field FROM api.dataset_rows r JOIN api.datasets d ON d.id=r.dataset_id JOIN api.dataset_schema_version_fields f ON f.schema_version_id=d.schema_version_id AND f.field_id=NEW.field_id WHERE r.id=NEW.row_id;
 IF field.id IS NULL OR field.lifecycle <> 'active' THEN RAISE EXCEPTION 'unknown active Dataset field' USING ERRCODE='22023'; END IF;
 slots := (NEW.text_value IS NOT NULL)::int+(NEW.integer_value IS NOT NULL)::int+(NEW.numeric_value IS NOT NULL)::int+(NEW.boolean_value IS NOT NULL)::int+(NEW.date_value IS NOT NULL)::int+(NEW.timestamp_value IS NOT NULL)::int+(NEW.category_option_id IS NOT NULL)::int+(NEW.reference_id IS NOT NULL)::int;
 IF slots <> 1 THEN RAISE EXCEPTION 'exactly one typed Dataset value is required' USING ERRCODE='22023'; END IF;
 IF (field.logical_type='text' AND NEW.text_value IS NULL) OR (field.logical_type='integer' AND NEW.integer_value IS NULL) OR (field.logical_type='decimal' AND NEW.numeric_value IS NULL) OR (field.logical_type='boolean' AND NEW.boolean_value IS NULL) OR (field.logical_type='date' AND NEW.date_value IS NULL) OR (field.logical_type='timestamp' AND NEW.timestamp_value IS NULL) OR (field.logical_type='category' AND NEW.category_option_id IS NULL) OR (field.logical_type='reference' AND NEW.reference_id IS NULL) THEN RAISE EXCEPTION 'Dataset value does not match field logical type' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_dataset_row_value BEFORE INSERT OR UPDATE ON api.dataset_row_values FOR EACH ROW EXECUTE FUNCTION internal.validate_dataset_row_value();
