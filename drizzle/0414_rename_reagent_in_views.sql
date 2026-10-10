-- LAB-04.1 — the views follow the kind rename too.
--
-- The earlier pass patched every *function* that compared the kind, but api.my_work_items is
-- a view: its `material_expiring` branch filters on the kind, and a view is not in pg_proc.
-- So the inbox silently stopped listing an expiring material — the kind existed and the view
-- still asked for the old one.
--
-- The view keeps its security_invoker posture and is patched from its current definition, so
-- the other kinds it derives are untouched.

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_viewdef('api.my_work_items'::regclass, true) INTO def;
  IF position('''reagent''' in def) = 0 THEN RETURN; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW api.my_work_items WITH(security_invoker=true) AS '
    || replace(def, '''reagent''', '''material''');
END $$;
--> statement-breakpoint

-- Nothing left anywhere should compare the old kind.
DO $$
DECLARE
  remaining text;
BEGIN
  SELECT string_agg(where_it, ', ') INTO remaining FROM (
    SELECT 'api.my_work_items' AS where_it
     WHERE (SELECT pg_get_viewdef('api.my_work_items'::regclass, true)) LIKE '%''reagent''%'
    UNION ALL
    SELECT 'function ' || p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname IN ('api', 'internal') AND p.prosrc LIKE '%''reagent''%'
  ) leftovers;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION 'still comparing the old kind: %', remaining;
  END IF;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
