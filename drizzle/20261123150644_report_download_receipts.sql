-- A downloaded report (Word, PDF or HTML) leaves a receipt like any other export.
ALTER TABLE api.data_exports DROP CONSTRAINT data_exports_object_type_check;
--> statement-breakpoint
ALTER TABLE api.data_exports ADD CONSTRAINT data_exports_object_type_check
  CHECK (object_type = ANY (ARRAY['dataset'::text, 'dataset_version'::text, 'sheet_instance'::text, 'record'::text, 'revision'::text, 'workspace'::text, 'report_generation'::text]));
