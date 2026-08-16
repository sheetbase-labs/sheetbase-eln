-- H4: close authenticated/api_client writes that create new scientific-table
-- or SCI-010 schema state. Reads, conversion and migrator/internal fixtures
-- remain. Existing generated tables are not dropped.

DO $h4$
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
         'upgrade_scientific_schema'
       )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticated, api_client',
      r.sig
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO migrator', r.sig);
  END LOOP;
END
$h4$;

NOTIFY pgrst, 'reload schema';
