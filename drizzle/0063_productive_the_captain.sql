CREATE TABLE "api"."dataset_schema_version_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schema_version_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"logical_type" text NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"default_value" jsonb,
	"quantity" jsonb,
	"validation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"category" jsonb,
	"relationship" jsonb,
	"cardinality" text DEFAULT 'one' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "uq_dataset_schema_version_fields_version_key" UNIQUE("schema_version_id","key"),
	CONSTRAINT "uq_dataset_schema_version_fields_version_field" UNIQUE("schema_version_id","field_id"),
	CONSTRAINT "chk_dataset_schema_version_fields_type" CHECK ("api"."dataset_schema_version_fields"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category','reference')),
	CONSTRAINT "chk_dataset_schema_version_fields_cardinality" CHECK ("api"."dataset_schema_version_fields"."cardinality" IN ('one','many')),
	CONSTRAINT "chk_dataset_schema_version_fields_lifecycle" CHECK ("api"."dataset_schema_version_fields"."lifecycle" IN ('active','retired'))
);
--> statement-breakpoint
ALTER TABLE "api"."dataset_schema_version_fields" ADD CONSTRAINT "dataset_schema_version_fields_schema_version_id_dataset_schema_versions_id_fk" FOREIGN KEY ("schema_version_id") REFERENCES "api"."dataset_schema_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dataset_schema_version_fields_version" ON "api"."dataset_schema_version_fields" USING btree ("schema_version_id");
--> statement-breakpoint
ALTER TABLE api.dataset_schema_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.dataset_schema_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.dataset_schema_version_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.datasets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON api.dataset_schema_definitions, api.dataset_schema_versions, api.dataset_schema_version_fields, api.datasets TO authenticated;
CREATE POLICY dataset_schema_definitions_read ON api.dataset_schema_definitions FOR SELECT TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY dataset_schema_definitions_write ON api.dataset_schema_definitions FOR ALL TO authenticated USING (api.has_schema_capability(workspace_id,'dataset_schema.publish')) WITH CHECK (api.has_schema_capability(workspace_id,'dataset_schema.publish'));
CREATE POLICY dataset_schema_versions_read ON api.dataset_schema_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM api.dataset_schema_definitions s WHERE s.id=schema_id AND s.workspace_id=api.current_workspace_id() AND api.is_workspace_member(s.workspace_id)));
CREATE POLICY dataset_schema_versions_write ON api.dataset_schema_versions FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM api.dataset_schema_definitions s WHERE s.id=schema_id AND api.has_schema_capability(s.workspace_id,'dataset_schema.publish'))) WITH CHECK (EXISTS (SELECT 1 FROM api.dataset_schema_definitions s WHERE s.id=schema_id AND api.has_schema_capability(s.workspace_id,'dataset_schema.publish')));
CREATE POLICY dataset_schema_version_fields_read ON api.dataset_schema_version_fields FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions s ON s.id=v.schema_id WHERE v.id=schema_version_id AND s.workspace_id=api.current_workspace_id() AND api.is_workspace_member(s.workspace_id)));
CREATE POLICY dataset_schema_version_fields_write ON api.dataset_schema_version_fields FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions s ON s.id=v.schema_id WHERE v.id=schema_version_id AND api.has_schema_capability(s.workspace_id,'dataset_schema.publish'))) WITH CHECK (EXISTS (SELECT 1 FROM api.dataset_schema_versions v JOIN api.dataset_schema_definitions s ON s.id=v.schema_id WHERE v.id=schema_version_id AND api.has_schema_capability(s.workspace_id,'dataset_schema.publish')));
CREATE POLICY datasets_read ON api.datasets FOR SELECT TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY datasets_write ON api.datasets FOR ALL TO authenticated USING (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id)) WITH CHECK (workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
