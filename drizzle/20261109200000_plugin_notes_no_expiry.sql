-- A note a plugin leaves in someone's Inbox stays until they deal with it.
-- It used to drop out of the Inbox after 14 days, a limit nobody asked for.
DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_viewdef('internal.my_work_items_all'::regclass);
  IF position('interval ''14 days''' IN v_def) > 0 THEN
    v_def := regexp_replace(
      v_def,
      '\s+AND\s+\(?n\.created_at\s*>\s*\(now\(\)\s*-\s*''14 days''::interval\)\)?',
      '',
      'g'
    );
    IF position('''14 days''' IN v_def) > 0 THEN
      RAISE EXCEPTION 'could not remove the 14 day limit from internal.my_work_items_all';
    END IF;
    EXECUTE 'CREATE OR REPLACE VIEW internal.my_work_items_all AS ' || rtrim(v_def, ';');
  END IF;
END $$;
