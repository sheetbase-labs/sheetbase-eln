-- Remove SCI-010 / scientific-table / legacy notebook-template product
-- compatibility. Canonical CORE-02/03/06 RPCs are unchanged. Protocol
-- templates are unchanged.

CREATE OR REPLACE FUNCTION internal.reject_new_legacy_notebook_template(p_kind text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_kind = 'notebook_template' THEN
    RAISE EXCEPTION 'Notebook Templates use api.create_notebook_template. records.kind = notebook_template is removed.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION internal.require_migrator_legacy_sheet_write()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Scientific-table and SCI-010 schema writes are removed. Use CORE-02 Dataset Schemas and CORE-03 Sheet Instances.'
    USING ERRCODE = '42501';
END;
$$;

DO $drop$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname IN (
         'convert_legacy_sheet_block',
         'bind_legacy_sheet'
       )
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
  END LOOP;
END
$drop$;

DO $revoke$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname IN (
         'insert_sheet_block',
         'create_scientific_table',
         'add_scientific_column',
         'create_dataset_schema',
         'add_dataset_schema_field',
         'retire_dataset_schema_field',
         'publish_dataset_schema',
         'instantiate_dataset_schema',
         'upgrade_scientific_schema',
         'query_dataset',
         'apply_scientific_row_edits',
         'apply_scientific_row_changes',
         'import_scientific_rows',
         'record_scientific_export',
         'scientific_table_metadata',
         'update_scientific_table_display',
         'update_scientific_column_display',
         'retire_scientific_column',
         'convert_scientific_column',
         'create_schema_relationship',
         'delete_schema_relationship',
         'preflight_scientific_conversion',
         'preflight_scientific_retirement'
       )
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, authenticated, api_client, migrator',
      r.sig
    );
  END LOOP;
END
$revoke$;

DO $inst$
DECLARE
  def text;
BEGIN
  def := pg_get_functiondef('api.instantiate_template(uuid,uuid,text,text)'::regprocedure);
  def := replace(
    def,
    'IF v_template.kind = ''notebook_template'' AND session_user IS DISTINCT FROM ''migrator'' THEN',
    'IF v_template.kind = ''notebook_template'' THEN'
  );
  EXECUTE def;
END
$inst$;

DELETE FROM api.record_links
 WHERE target_kind = 'notebook_template'
    OR source_record_id IN (
         SELECT id FROM api.records WHERE kind = 'notebook_template'
       )
    OR target_record_id IN (
         SELECT id FROM api.records WHERE kind = 'notebook_template'
       );

DELETE FROM api.blocks
 WHERE record_id IN (SELECT id FROM api.records WHERE kind = 'notebook_template');

DELETE FROM api.revisions
 WHERE record_id IN (SELECT id FROM api.records WHERE kind = 'notebook_template');

DELETE FROM api.records WHERE kind = 'notebook_template';

NOTIFY pgrst, 'reload schema';
