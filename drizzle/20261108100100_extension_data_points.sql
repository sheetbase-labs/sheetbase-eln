-- Plugins that move, check, find and show data.
--
-- Ten more points join operations and analysis kinds: pipeline steps,
-- calculators, checks, search providers, connectors, importers, exporters,
-- file previews, same-thing rules and event reactions. The manifest declares
-- each one; an administrator can switch each on or off per plugin, as for the
-- first two. This migration teaches the database's own manifest check the new
-- shapes, so a direct-SQL install is held to what the TypeScript check holds it
-- to (src/lib/extensions/data-points.ts). tests/db/plugin-points.test.ts runs
-- the same cases through both.

-- Per-point switches ------------------------------------------------------------
ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points;
--> statement-breakpoint
ALTER TABLE api.extensions
  ADD CONSTRAINT chk_extensions_disabled_points CHECK (
    disabled_points <@ ARRAY[
      'operations', 'analysis-kinds', 'blocks', 'panels', 'table-cells',
      'columns', 'row-actions', 'field-types',
      'pipeline-steps', 'calculators', 'checks',
      'search-providers', 'connectors', 'importers', 'exporters', 'previews',
      'sameness-keys', 'event-hooks']::text[]);
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$p_point NOT IN ('operations', 'analysis-kinds', 'blocks', 'panels', 'table-cells', 'columns', 'row-actions', 'field-types')$q$;
  v_new constant text := $q$p_point NOT IN ('operations', 'analysis-kinds', 'blocks', 'panels', 'table-cells', 'columns', 'row-actions', 'field-types', 'pipeline-steps', 'calculators', 'checks', 'search-providers', 'connectors', 'importers', 'exporters', 'previews', 'sameness-keys', 'event-hooks')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Helpers -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.extension_fields_ok(p_fields jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) > 24 THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry->'name') IS DISTINCT FROM 'string'
       OR (v_entry->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
       OR jsonb_typeof(v_entry->'type') IS DISTINCT FROM 'string'
       OR (v_entry->>'type') NOT IN ('text', 'number', 'integer', 'boolean', 'date', 'json')
       OR jsonb_typeof(v_entry->'required') IS DISTINCT FROM 'boolean'
       OR ((v_entry ? 'description')
           AND (jsonb_typeof(v_entry->'description') IS DISTINCT FROM 'string'
                OR length(btrim(v_entry->>'description')) NOT BETWEEN 1 AND 300))
       OR ((v_entry ? 'label')
           AND (jsonb_typeof(v_entry->'label') IS DISTINCT FROM 'string'
                OR length(btrim(v_entry->>'label')) NOT BETWEEN 1 AND 80))
       OR ((v_entry ? 'unit')
           AND (jsonb_typeof(v_entry->'unit') IS DISTINCT FROM 'string'
                OR length(btrim(v_entry->>'unit')) NOT BETWEEN 1 AND 24))
       OR (v_entry->>'name') = ANY (v_seen) THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry->>'name');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint

-- A missing runner is not a valid one (the first version answered NULL for it).
CREATE OR REPLACE FUNCTION internal.extension_runner_ok(p_runner jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  RETURN COALESCE(
    jsonb_typeof(p_runner) = 'object'
      AND p_runner->>'kind' = 'python'
      AND jsonb_typeof(p_runner->'entry') = 'string'
      AND (p_runner->>'entry') ~ '^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*:[a-z_][a-z0-9_]*$',
    false);
END $$;
--> statement-breakpoint

-- A list of 1-10 distinct strings that each match a pattern.
CREATE FUNCTION internal.extension_strings_ok(p_list jsonb, p_pattern text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_list) NOT BETWEEN 1 AND 10 THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_list) LOOP
    IF jsonb_typeof(v_entry) <> 'string'
       OR (v_entry #>> '{}') !~ p_pattern
       OR (v_entry #>> '{}') = ANY (v_seen) THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry #>> '{}');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_strings_ok(jsonb, text) OWNER TO migrator;
--> statement-breakpoint

-- Result columns: 1-24, unique names, number or text.
CREATE FUNCTION internal.extension_columns_ok(p_columns jsonb) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_columns) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_columns) NOT BETWEEN 1 AND 24 THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_columns) LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry->'name') IS DISTINCT FROM 'string'
       OR (v_entry->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
       OR (v_entry->>'name') = ANY (v_seen)
       OR jsonb_typeof(v_entry->'type') IS DISTINCT FROM 'string'
       OR (v_entry->>'type') NOT IN ('number', 'text') THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry->>'name');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_columns_ok(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- Named, labelled entries: `table` (a table a step reads), `check` (a column a
-- check reads: number or category) and `setting` (a connector setting: secret or not).
CREATE FUNCTION internal.extension_labelled_ok(p_list jsonb, p_kind text, p_max integer, p_min integer)
    RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_list) NOT BETWEEN p_min AND p_max THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_list) LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR jsonb_typeof(v_entry->'name') IS DISTINCT FROM 'string'
       OR (v_entry->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
       OR (v_entry->>'name') = ANY (v_seen)
       OR jsonb_typeof(v_entry->'label') IS DISTINCT FROM 'string'
       OR length(btrim(v_entry->>'label')) NOT BETWEEN 1 AND 80
       OR jsonb_typeof(v_entry->'required') IS DISTINCT FROM 'boolean'
       OR (p_kind = 'check'
           AND (jsonb_typeof(v_entry->'type') IS DISTINCT FROM 'string'
                OR (v_entry->>'type') NOT IN ('number', 'category')))
       OR (p_kind = 'setting'
           AND jsonb_typeof(v_entry->'secret') IS DISTINCT FROM 'boolean') THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry->>'name');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_labelled_ok(jsonb, text, integer, integer) OWNER TO migrator;
--> statement-breakpoint

-- Event names are the ones webhooks can be sent. Reads a table, so STABLE.
CREATE FUNCTION internal.extension_events_ok(p_list jsonb) RETURNS boolean
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_entry jsonb;
  v_seen text[] := '{}';
BEGIN
  IF jsonb_typeof(p_list) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_list) NOT BETWEEN 1 AND 10 THEN
    RETURN false;
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_list) LOOP
    IF jsonb_typeof(v_entry) <> 'string'
       OR (v_entry #>> '{}') = ANY (v_seen)
       OR NOT EXISTS (SELECT 1 FROM internal.webhook_event_names n WHERE n.name = (v_entry #>> '{}')) THEN
      RETURN false;
    END IF;
    v_seen := v_seen || (v_entry #>> '{}');
  END LOOP;
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.extension_events_ok(jsonb) OWNER TO migrator;
--> statement-breakpoint

-- The point check -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.validate_extension_runner_points(p_manifest jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_point text;
  v_list jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_seen text[];
  v_called text[] := '{}';
  v_names text[];
  v_columns text[];
  v_numeric text[];
  v_chart jsonb;
  v_result jsonb;
  c_host constant text :=
    '^(?!\d+(\.\d+){3}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$';
  c_ext constant text := '^\.[a-z0-9]{1,12}$';
  c_type constant text := '^[a-z][a-z0-9_-]{0,40}$';
  c_mime constant text :=
    '^[a-z0-9][a-z0-9!#$&^_.+-]{0,60}/[a-z0-9][a-z0-9!#$&^_.+-]{0,100}$';
BEGIN
  IF (p_manifest ? 'description')
     AND (jsonb_typeof(p_manifest->'description') IS DISTINCT FROM 'string'
          OR length(btrim(p_manifest->>'description')) NOT BETWEEN 1 AND 600) THEN
    RAISE EXCEPTION 'invalid extension description' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest ? 'author')
     AND (jsonb_typeof(p_manifest->'author') IS DISTINCT FROM 'string'
          OR length(btrim(p_manifest->>'author')) NOT BETWEEN 1 AND 200) THEN
    RAISE EXCEPTION 'invalid extension author' USING ERRCODE = 'SB034';
  END IF;
  FOREACH v_point IN ARRAY ARRAY[
    'operations', 'analysis-kinds', 'pipeline-steps', 'calculators', 'checks',
    'search-providers', 'connectors', 'importers', 'exporters', 'previews',
    'sameness-keys', 'event-hooks'] LOOP
    IF (p_manifest->'contributions' ? v_point) IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;
    v_list := p_manifest->'contributions'->v_point;
    IF jsonb_typeof(v_list) <> 'array' OR jsonb_array_length(v_list) > 25 THEN
      RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
    END IF;
    v_seen := '{}';
    FOR v_entry IN SELECT * FROM jsonb_array_elements(v_list) LOOP
      IF jsonb_typeof(v_entry) <> 'object'
         OR jsonb_typeof(v_entry->'id') IS DISTINCT FROM 'string'
         OR (v_entry->>'id') !~ '^[a-z][a-z0-9-]{0,48}$'
         OR jsonb_typeof(v_entry->'title') IS DISTINCT FROM 'string'
         OR length(btrim(v_entry->>'title')) NOT BETWEEN 1 AND 120
         OR ((v_entry ? 'description')
             AND (jsonb_typeof(v_entry->'description') IS DISTINCT FROM 'string'
                  OR length(btrim(v_entry->>'description')) NOT BETWEEN 1 AND 600))
         OR (v_point NOT IN ('analysis-kinds', 'pipeline-steps')
             AND (v_entry ? 'description') IS DISTINCT FROM true) THEN
        RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
      END IF;
      IF (v_entry->>'id') = ANY (v_seen) THEN
        RAISE EXCEPTION 'duplicate extension contribution id' USING ERRCODE = 'SB034';
      END IF;
      v_seen := v_seen || (v_entry->>'id');
      -- Operations, calculators and pipeline steps share one name.
      IF v_point IN ('operations', 'calculators', 'pipeline-steps') THEN
        IF (v_entry->>'id') = ANY (v_called) THEN
          RAISE EXCEPTION 'duplicate extension contribution id' USING ERRCODE = 'SB034';
        END IF;
        v_called := v_called || (v_entry->>'id');
      END IF;
      IF NOT internal.extension_runner_ok(v_entry->'runner') THEN
        RAISE EXCEPTION 'invalid extension runner' USING ERRCODE = 'SB034';
      END IF;

      IF v_point = 'operations' THEN
        IF jsonb_typeof(v_entry->'access') IS DISTINCT FROM 'string'
           OR (v_entry->>'access') NOT IN ('read', 'write')
           OR NOT internal.extension_fields_ok(v_entry->'inputs')
           OR NOT internal.extension_fields_ok(v_entry->'outputs') THEN
          RAISE EXCEPTION 'invalid extension operation' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'analysis-kinds' THEN
        IF jsonb_typeof(v_entry->'inputs') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_entry->'inputs') NOT BETWEEN 1 AND 24
           OR jsonb_typeof(v_entry->'result') IS DISTINCT FROM 'object'
           OR jsonb_typeof(v_entry->'result'->'columns') IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_entry->'result'->'columns') NOT BETWEEN 1 AND 24 THEN
          RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
        END IF;
        v_names := '{}';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_entry->'inputs') LOOP
          IF jsonb_typeof(v_item) <> 'object'
             OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
             OR (v_item->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
             OR (v_item->>'name') = ANY (v_names)
             OR jsonb_typeof(v_item->'label') IS DISTINCT FROM 'string'
             OR length(btrim(v_item->>'label')) NOT BETWEEN 1 AND 80
             OR jsonb_typeof(v_item->'type') IS DISTINCT FROM 'string'
             OR (v_item->>'type') NOT IN ('number', 'category')
             OR jsonb_typeof(v_item->'required') IS DISTINCT FROM 'boolean' THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
          v_names := v_names || (v_item->>'name');
        END LOOP;
        v_result := v_entry->'result';
        v_columns := '{}';
        v_numeric := '{}';
        FOR v_item IN SELECT * FROM jsonb_array_elements(v_result->'columns') LOOP
          IF jsonb_typeof(v_item) <> 'object'
             OR jsonb_typeof(v_item->'name') IS DISTINCT FROM 'string'
             OR (v_item->>'name') !~ '^[a-z][a-z0-9_]{0,47}$'
             OR (v_item->>'name') = ANY (v_columns)
             OR jsonb_typeof(v_item->'type') IS DISTINCT FROM 'string'
             OR (v_item->>'type') NOT IN ('number', 'text') THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
          v_columns := v_columns || (v_item->>'name');
          IF (v_item->>'type') = 'number' THEN
            v_numeric := v_numeric || (v_item->>'name');
          END IF;
        END LOOP;
        IF v_result ? 'chart' THEN
          v_chart := v_result->'chart';
          IF jsonb_typeof(v_chart) <> 'object'
             OR jsonb_typeof(v_chart->'type') IS DISTINCT FROM 'string'
             OR (v_chart->>'type') NOT IN ('line', 'scatter', 'bar')
             OR jsonb_typeof(v_chart->'x') IS DISTINCT FROM 'string'
             OR NOT ((v_chart->>'x') = ANY (v_columns))
             OR jsonb_typeof(v_chart->'y') IS DISTINCT FROM 'string'
             OR NOT ((v_chart->>'y') = ANY (v_numeric))
             OR ((v_chart ? 'group')
                 AND (jsonb_typeof(v_chart->'group') IS DISTINCT FROM 'string'
                      OR NOT ((v_chart->>'group') = ANY (v_columns)))) THEN
            RAISE EXCEPTION 'invalid extension analysis kind' USING ERRCODE = 'SB034';
          END IF;
        END IF;
      ELSIF v_point = 'pipeline-steps' THEN
        IF NOT internal.extension_labelled_ok(v_entry->'tables', 'table', 6, 1)
           OR NOT internal.extension_fields_ok(v_entry->'parameters')
           OR jsonb_typeof(v_entry->'result') IS DISTINCT FROM 'object'
           OR NOT internal.extension_columns_ok(v_entry->'result'->'columns') THEN
          RAISE EXCEPTION 'invalid extension pipeline step' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'calculators' THEN
        IF NOT internal.extension_fields_ok(v_entry->'inputs')
           OR NOT internal.extension_fields_ok(v_entry->'outputs')
           OR jsonb_array_length(v_entry->'inputs') < 1
           OR jsonb_array_length(v_entry->'outputs') < 1 THEN
          RAISE EXCEPTION 'invalid extension calculator' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'checks' THEN
        IF NOT internal.extension_labelled_ok(v_entry->'inputs', 'check', 24, 1) THEN
          RAISE EXCEPTION 'invalid extension check' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'search-providers' THEN
        IF NOT internal.extension_strings_ok(v_entry->'types', c_type) THEN
          RAISE EXCEPTION 'invalid extension search provider' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'connectors' THEN
        IF NOT internal.extension_strings_ok(v_entry->'hosts', c_host)
           OR NOT internal.extension_labelled_ok(v_entry->'settings', 'setting', 8, 0)
           OR NOT internal.extension_fields_ok(v_entry->'parameters')
           OR NOT internal.extension_runner_ok(v_entry->'parse') THEN
          RAISE EXCEPTION 'invalid extension connector' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'importers' THEN
        IF NOT internal.extension_strings_ok(v_entry->'extensions', c_ext)
           OR COALESCE((v_entry->>'encoding') = ANY (ARRAY['text', 'base64']), false) = false THEN
          RAISE EXCEPTION 'invalid extension importer' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'exporters' THEN
        IF jsonb_typeof(v_entry->'extension') IS DISTINCT FROM 'string'
           OR (v_entry->>'extension') !~ c_ext
           OR jsonb_typeof(v_entry->'mime') IS DISTINCT FROM 'string'
           OR (v_entry->>'mime') !~ c_mime
           OR COALESCE((v_entry->>'encoding') = ANY (ARRAY['text', 'base64']), false) = false
           OR NOT internal.extension_fields_ok(v_entry->'parameters') THEN
          RAISE EXCEPTION 'invalid extension exporter' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'previews' THEN
        IF NOT internal.extension_strings_ok(v_entry->'extensions', c_ext)
           OR COALESCE((v_entry->>'encoding') = ANY (ARRAY['text', 'base64']), false) = false THEN
          RAISE EXCEPTION 'invalid extension preview' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'sameness-keys' THEN
        IF NOT internal.extension_fields_ok(v_entry->'fields')
           OR jsonb_array_length(v_entry->'fields') < 1 THEN
          RAISE EXCEPTION 'invalid extension same-thing rule' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'event-hooks' THEN
        IF NOT internal.extension_events_ok(v_entry->'events') THEN
          RAISE EXCEPTION 'invalid extension event reaction' USING ERRCODE = 'SB034';
        END IF;
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint

-- The main validator knows the new point names.
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'event-subscriptions', 'operations', 'analysis-kinds', 'blocks', 'table-cells', 'columns', 'row-actions', 'field-types')$q$;
  v_new constant text := $q$'event-subscriptions', 'operations', 'analysis-kinds', 'blocks', 'table-cells', 'columns', 'row-actions', 'field-types', 'pipeline-steps', 'calculators', 'checks', 'search-providers', 'connectors', 'importers', 'exporters', 'previews', 'sameness-keys', 'event-hooks')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
