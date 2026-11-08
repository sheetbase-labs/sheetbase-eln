-- Plugin UI points: pages, settings pages, Home widgets and report sections,
-- plus the two new ways a plugin's own code reaches existing points: a field
-- type's `input` (a UI bundle that is the field's input in forms) and a table
-- cell's `render` (a UI bundle that draws the cells).
--
-- Like the earlier hook points, each new point has its own switch for an
-- administrator, and the manifest check here is structural; the full rules are
-- the TypeScript ones in src/lib/extensions/ui-points.ts and hooks.ts and run
-- on every upload. The bundles themselves are never run by the database or the
-- server: they only ever run in the browser's sandboxed frame.

-- Per-point switches ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.extensions'::regclass AND conname = 'chk_extensions_disabled_points';
  IF v_def IS NULL OR position('''field-types''::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_extensions_disabled_points';
  END IF;
  EXECUTE 'ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points';
  EXECUTE 'ALTER TABLE api.extensions ADD CONSTRAINT chk_extensions_disabled_points '
    || replace(v_def, '''field-types''::text]',
         '''field-types''::text, ''pages''::text, ''settings-pages''::text, ''dashboard-widgets''::text, ''report-sections''::text]');
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'row-actions', 'field-types')$q$;
  v_new constant text := $q$'row-actions', 'field-types', 'pages', 'settings-pages', 'dashboard-widgets', 'report-sections')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Manifest validation ---------------------------------------------------------
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_hook_points(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_loop_old constant text := $q$ARRAY['blocks', 'table-cells', 'columns', 'row-actions', 'field-types'] LOOP$q$;
  v_loop_new constant text := $q$ARRAY['blocks', 'table-cells', 'columns', 'row-actions', 'field-types', 'pages', 'settings-pages', 'dashboard-widgets', 'report-sections'] LOOP$q$;
  v_cell_old constant text := $q$                  OR jsonb_typeof(v_entry->'display') IS DISTINCT FROM 'object'))$q$;
  v_cell_new constant text := $q$                  OR (v_entry ? 'display') = (v_entry ? 'render')
                  OR ((v_entry ? 'display') AND jsonb_typeof(v_entry->'display') IS DISTINCT FROM 'object')
                  OR ((v_entry ? 'render')
                      AND (jsonb_typeof(v_entry->'render') IS DISTINCT FROM 'string'
                           OR (v_entry->>'render') !~ '^ui/[A-Za-z0-9._/-]{1,100}\.html$'))))$q$;
  v_type_old constant text := $q$                  OR (v_entry->>'base') NOT IN ('text', 'integer', 'decimal'))) THEN$q$;
  v_type_new constant text := $q$                  OR (v_entry->>'base') NOT IN ('text', 'integer', 'decimal')
                  OR ((v_entry ? 'input')
                      AND (jsonb_typeof(v_entry->'input') IS DISTINCT FROM 'string'
                           OR (v_entry->>'input') !~ '^ui/[A-Za-z0-9._/-]{1,100}\.html$'))))
         OR (v_point IN ('pages', 'settings-pages', 'dashboard-widgets', 'report-sections')
             AND (jsonb_typeof(v_entry->'ui') IS DISTINCT FROM 'string'
                  OR (v_entry->>'ui') !~ '^ui/[A-Za-z0-9._/-]{1,100}\.html$'
                  OR ((v_entry ? 'icon')
                      AND (jsonb_typeof(v_entry->'icon') IS DISTINCT FROM 'string'
                           OR (v_entry->>'icon') !~ '^[a-z][a-z0-9-]{0,39}$'))
                  OR ((v_entry ? 'size')
                      AND (v_point <> 'dashboard-widgets'
                           OR (v_entry->>'size') IS NULL
                           OR (v_entry->>'size') NOT IN ('normal', 'wide'))))) THEN$q$;
BEGIN
  IF position(v_loop_old IN v_def) = 0 OR position(v_cell_old IN v_def) = 0
     OR position(v_type_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_hook_points';
  END IF;
  EXECUTE replace(replace(replace(v_def, v_loop_old, v_loop_new), v_cell_old, v_cell_new), v_type_old, v_type_new);
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'row-actions', 'field-types')$q$;
  v_new constant text := $q$'row-actions', 'field-types', 'pages', 'settings-pages', 'dashboard-widgets', 'report-sections')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
