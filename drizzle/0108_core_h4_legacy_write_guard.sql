-- H4 follow-up: GRANT revoke is not sufficient if PUBLIC/default privileges
-- remain. Fail closed inside the write functions unless the login role is
-- migrator.

CREATE OR REPLACE FUNCTION internal.require_migrator_legacy_sheet_write()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF session_user IS DISTINCT FROM 'migrator' THEN
    RAISE EXCEPTION 'Legacy scientific-table and SCI-010 schema writes are closed for application roles.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION internal.require_migrator_legacy_sheet_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.require_migrator_legacy_sheet_write() TO PUBLIC;

DO $h4$
DECLARE
  r record;
  def text;
BEGIN
  FOR r IN
    SELECT p.oid
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
    def := pg_get_functiondef(r.oid);
    IF def LIKE '%require_migrator_legacy_sheet_write%' THEN
      CONTINUE;
    END IF;
    def := regexp_replace(
      def,
      E'\nBEGIN\n',
      E'\nBEGIN\n  PERFORM "internal"."require_migrator_legacy_sheet_write"();\n',
      1
    );
    IF def NOT LIKE '%require_migrator_legacy_sheet_write%' THEN
      RAISE EXCEPTION 'H4 could not patch %', r.oid::regprocedure;
    END IF;
    EXECUTE def;
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, authenticated, api_client',
      r.oid::regprocedure
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO migrator', r.oid::regprocedure);
  END LOOP;
END
$h4$;

NOTIFY pgrst, 'reload schema';
