-- Plugin hooks: notebook blocks, record panels, table cell displays, computed
-- columns, row actions and model field types.
--
-- A plugin declares each of these in its manifest (src/lib/extensions/hooks.ts)
-- and an administrator can switch each point off on its own. What is stored:
--
--   * the six points join operations and analysis kinds in the per-point
--     switches and in the manifest check (a structural check here; the full
--     rules, such as what a cell display may say, are the TypeScript ones and
--     run on every upload);
--   * a notebook block of type 'plugin' holds { plugin, block, state };
--   * a model field can be given a field type from a plugin: the plugin's
--     checks are copied into the field's own validation when it is applied, so
--     the database keeps enforcing them whatever the plugin does later; this
--     table only remembers which type the field was given, for its look.

-- Events ----------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('extension.field_type.applied'), ('extension.field_type.removed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Per-point switches ------------------------------------------------------------
ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points;
--> statement-breakpoint
ALTER TABLE api.extensions
  ADD CONSTRAINT chk_extensions_disabled_points CHECK (
    disabled_points <@ ARRAY['operations', 'analysis-kinds', 'blocks', 'panels',
      'table-cells', 'columns', 'row-actions', 'field-types']::text[]);
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$p_point NOT IN ('operations', 'analysis-kinds')$q$;
  v_new constant text := $q$p_point NOT IN ('operations', 'analysis-kinds', 'blocks', 'panels', 'table-cells', 'columns', 'row-actions', 'field-types')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Manifest validation ---------------------------------------------------------
CREATE FUNCTION internal.validate_extension_hook_points(p_manifest jsonb) RETURNS void
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_point text;
  v_list jsonb;
  v_entry jsonb;
  v_seen text[];
BEGIN
  FOREACH v_point IN ARRAY ARRAY['blocks', 'table-cells', 'columns', 'row-actions', 'field-types'] LOOP
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
         OR (v_point IN ('blocks', 'row-actions') AND (v_entry ? 'description') IS DISTINCT FROM true)
         OR (v_point IN ('columns', 'row-actions')
             AND NOT coalesce(internal.extension_runner_ok(v_entry->'runner'), false))
         OR (v_point = 'blocks'
             AND ((v_entry ? 'screen') = (v_entry ? 'ui')
                  OR ((v_entry ? 'screen') AND NOT coalesce(internal.extension_runner_ok(v_entry->'screen'), false))
                  OR ((v_entry ? 'ui')
                      AND (jsonb_typeof(v_entry->'ui') IS DISTINCT FROM 'string'
                           OR (v_entry->>'ui') !~ '^ui/[A-Za-z0-9._/-]{1,100}\.html$'))))
         OR (v_point = 'table-cells'
             AND (jsonb_typeof(v_entry->'appliesTo') IS DISTINCT FROM 'object'
                  OR jsonb_typeof(v_entry->'display') IS DISTINCT FROM 'object'))
         OR (v_point = 'columns'
             AND ((v_entry->>'value') IS NULL
                  OR (v_entry->>'value') NOT IN ('number', 'text', 'boolean', 'svg')))
         OR (v_point = 'row-actions'
             AND ((v_entry->>'selection') IS NULL
                  OR (v_entry->>'selection') NOT IN ('one', 'many')))
         OR (v_point = 'field-types'
             AND ((v_entry->>'base') IS NULL
                  OR (v_entry->>'base') NOT IN ('text', 'integer', 'decimal'))) THEN
        RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
      END IF;
      IF (v_entry->>'id') = ANY (v_seen) THEN
        RAISE EXCEPTION 'duplicate extension contribution id' USING ERRCODE = 'SB034';
      END IF;
      v_seen := v_seen || (v_entry->>'id');
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.validate_extension_hook_points(jsonb) OWNER TO migrator;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_points_old constant text := $q$'event-subscriptions', 'operations', 'analysis-kinds')$q$;
  v_points_new constant text := $q$'event-subscriptions', 'operations', 'analysis-kinds', 'blocks', 'table-cells', 'columns', 'row-actions', 'field-types')$q$;
  v_tail_old constant text := $q$  PERFORM internal.validate_extension_runner_points(p_manifest);$q$;
  v_tail_new constant text := $q$  PERFORM internal.validate_extension_runner_points(p_manifest);
  PERFORM internal.validate_extension_hook_points(p_manifest);$q$;
BEGIN
  IF position(v_points_old IN v_def) = 0 OR position(v_tail_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  v_def := replace(v_def, v_points_old, v_points_new);
  v_def := replace(v_def, v_tail_old, v_tail_new);
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Notebook blocks ----------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.blocks'::regclass AND conname = 'chk_blocks_type';
  IF v_def IS NULL OR position('::text])' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_blocks_type';
  END IF;
  IF position('''plugin''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text])', '::text, ''plugin''::text])');
    EXECUTE 'ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type';
    EXECUTE 'ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

-- Field types ----------------------------------------------------------------------
CREATE TABLE api.field_plugin_types (
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    field_name text NOT NULL,
    plugin_key text NOT NULL,
    type_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT field_plugin_types_pkey PRIMARY KEY (workspace_id, kind, field_name),
    CONSTRAINT chk_field_plugin_types_plugin CHECK (plugin_key ~ '^[a-z][a-z0-9-]{0,48}$'),
    CONSTRAINT chk_field_plugin_types_type CHECK (type_id ~ '^[a-z][a-z0-9-]{0,48}$')
);
--> statement-breakpoint
ALTER TABLE api.field_plugin_types OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.field_plugin_types
    ADD CONSTRAINT field_plugin_types_workspace_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE api.field_plugin_types ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY field_plugin_types_select ON api.field_plugin_types FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY field_plugin_types_client_select ON api.field_plugin_types FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.field_plugin_types TO authenticated, api_client;
--> statement-breakpoint

-- Give a model field a plugin's field type, or take it away (p_plugin_key null).
-- Needs permission to edit models. The plugin must be installed, on, with the
-- field types point switched on, and declare the type. The field's own checks
-- (pattern, lengths, range) are written by the app through the normal field
-- update, so the database enforces them without asking the plugin.
CREATE FUNCTION api.set_field_plugin_type(
    p_kind text, p_field_name text, p_plugin_key text, p_type_id text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_ext api.extensions;
  v_rows integer;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions d
                  WHERE d.workspace_id = v_workspace_id AND d.kind = p_kind
                    AND d.field_name = p_field_name) THEN
    RAISE EXCEPTION 'field not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_plugin_key IS NULL THEN
    DELETE FROM api.field_plugin_types
     WHERE workspace_id = v_workspace_id AND kind = p_kind AND field_name = p_field_name;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      PERFORM internal.emit_change_event(v_workspace_id, 'extension',
        md5(v_workspace_id::text || ':' || p_kind || ':' || p_field_name)::uuid,
        'update', NULL, NULL,
        jsonb_build_object('change', 'field_type_removed', 'modelKey', p_kind, 'fieldName', p_field_name));
    END IF;
    RETURN false;
  END IF;
  SELECT * INTO v_ext FROM api.extensions
   WHERE workspace_id = v_workspace_id AND key = p_plugin_key;
  IF v_ext IS NULL OR v_ext.status <> 'enabled'
     OR 'field-types' = ANY (v_ext.disabled_points)
     OR NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(v_ext.manifest->'contributions'->'field-types', '[]'::jsonb)) t
        WHERE t->>'id' = p_type_id) THEN
    RAISE EXCEPTION 'that plugin does not offer this field type' USING ERRCODE = 'SB036';
  END IF;
  INSERT INTO api.field_plugin_types (workspace_id, kind, field_name, plugin_key, type_id, created_by_user_id)
  VALUES (v_workspace_id, p_kind, p_field_name, p_plugin_key, p_type_id, api.current_user_id())
  ON CONFLICT (workspace_id, kind, field_name) DO UPDATE
     SET plugin_key = excluded.plugin_key, type_id = excluded.type_id;
  PERFORM internal.emit_change_event(v_workspace_id, 'extension', v_ext.id,
    'update', NULL, NULL,
    jsonb_build_object('change', 'field_type_applied', 'extensionKey', p_plugin_key, 'typeId', p_type_id,
                       'modelKey', p_kind, 'fieldName', p_field_name));
  RETURN true;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_field_plugin_type(text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_field_plugin_type(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_field_plugin_type(text, text, text, text) TO authenticated;
