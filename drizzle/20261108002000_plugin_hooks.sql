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
-- field types point switched on, and declare the type. The type's rules
-- (lengths, pattern, range) are checked by the record validator on every write
-- (see internal.check_plugin_field_type), without asking the plugin to run.
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text text := '';
  v_id uuid;
  v_ref text;
BEGIN
  CASE p_type
    WHEN 'rich_text' THEN
      v_text := internal.rich_text_plain(v_p -> 'doc');

    WHEN 'checklist' THEN
      v_text := internal.jsonb_path_text(v_p, '$.items[*].text');

    WHEN 'callout' THEN
      v_text := coalesce(v_p ->> 'text', '');

    WHEN 'conclusion' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'basis',
        replace(coalesce(v_p ->> 'verdict', ''), '_', ' '));

    WHEN 'metric' THEN
      v_text := concat_ws(' ', v_p ->> 'label', v_p ->> 'value', v_p ->> 'unit',
        v_p ->> 'provenance');

    WHEN 'table' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.columns[*]'),
        internal.jsonb_path_text(v_p, '$.rows[*][*]'));

    WHEN 'procedure_step' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'note');

    WHEN 'signature_request' THEN
      v_text := concat_ws(' ', v_p ->> 'requestedUserName',
        replace(coalesce(v_p ->> 'meaning', ''), '-', ' '), v_p ->> 'note');

    WHEN 'corrective_actions' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].action'),
        internal.jsonb_path_text(v_p, '$.items[*].ownerName'),
        replace(internal.jsonb_path_text(v_p, '$.items[*].status'), '-', ' '));

    WHEN 'materials' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].identifier'),
        internal.jsonb_path_text(v_p, '$.items[*].title'),
        internal.jsonb_path_text(v_p, '$.items[*].note'),
        internal.jsonb_path_text(v_p, '$.items[*].unit.symbol'));

    WHEN 'linked_record' THEN
      v_text := concat_ws(' ', v_p ->> 'targetIdentifier', v_p ->> 'label',
        replace(coalesce(v_p ->> 'linkType', ''), '_', ' '), v_p ->> 'targetKind');
      v_id := internal.search_uuid(v_p ->> 'targetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', r.identifier, r.title) INTO v_ref
          FROM api.records r
         WHERE r.id = v_id AND r.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, r.project_id);
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'protocol_reference' THEN
      v_text := concat_ws(' ', v_p ->> 'protocolIdentifier', v_p ->> 'protocolTitle',
        v_p ->> 'version', replace(coalesce(v_p ->> 'approvalStatus', ''), '_', ' '));

    WHEN 'file' THEN
      v_text := concat_ws(' ', v_p ->> 'displayName', v_p ->> 'fileIdentifier',
        v_p ->> 'mediaType');
      v_id := internal.search_uuid(v_p ->> 'fileRecordId');
      IF v_id IS NOT NULL THEN
        -- What is written inside the attached file, so a notebook is found by
        -- the report it attaches. Only the version the block shows (its
        -- fileVersion, else the newest), capped, and only from a file in the
        -- notebook's own project.
        SELECT left(fo.extracted_text, 100000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id)
         ORDER BY (fo.version = internal.search_int(v_p ->> 'fileVersion')) DESC NULLS LAST,
                  fo.version DESC
         LIMIT 1;
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'sheet' THEN
      v_id := internal.search_uuid(v_p ->> 'instanceId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', si.display_id, si.name,
                 internal.jsonb_path_text(si.state, '$.localFields[*].label'))
          INTO v_text
          FROM api.sheet_instances si
         WHERE si.id = v_id AND si.lifecycle IN ('active', 'archived')
           AND internal.search_scope_ok(p_record_id, si.project_id);
      END IF;

    WHEN 'chart' THEN
      v_text := concat_ws(' ', v_p ->> 'title',
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.label'),
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.unit'),
        internal.jsonb_path_text(v_p, '$.spec.display.series[*].label'),
        internal.jsonb_path_text(v_p, '$.spec.display.annotations[*].label'),
        v_p #>> '{spec,display,caption}');
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.datasets[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT f.label, ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.fields.*.fieldId') x
        JOIN api.dataset_schema_version_fields f ON f.field_id = internal.search_uuid(x #>> '{}');

    WHEN 'analysis' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        v_p #>> '{frozen,definitionName}',
        internal.jsonb_path_text(v_p, '$.frozen.columns[*].label'));
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.frozen.datasetProvenance[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      v_id := internal.search_uuid(v_p ->> 'definitionId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, ad.name) INTO v_text
          FROM api.analysis_definitions ad WHERE ad.id = v_id;
      END IF;

    WHEN 'plate_map' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        internal.jsonb_path_text(v_p, '$.spec.wells[*].wellCode'),
        replace(internal.jsonb_path_text(v_p, '$.spec.wells[*].role'), '_', ' '),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.identifier'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.title'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].notes'));

    WHEN 'pipeline_output' THEN
      v_text := coalesce(v_p ->> 'label', '');
      v_id := internal.search_uuid(v_p ->> 'runId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, pd.display_id, pd.name) INTO v_text
          FROM api.pipeline_runs pr
          JOIN api.pipeline_definition_versions pv ON pv.id = pr.definition_version_id
          JOIN api.pipeline_definitions pd ON pd.id = pv.definition_id
         WHERE pr.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'dataset_import' THEN
      v_text := coalesce(v_p ->> 'sheetName', '');
      v_id := internal.search_uuid(v_p ->> 'fileId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, f.filename) INTO v_text
          FROM api.dataset_import_files f WHERE f.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'structure' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'name',
        v_p ->> 'formula', v_p ->> 'smiles');

    WHEN 'reaction' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'smiles',
        internal.jsonb_path_text(v_p, '$.rows[*].name'),
        internal.jsonb_path_text(v_p, '$.rows[*].formula'),
        internal.jsonb_path_text(v_p, '$.rows[*].note'));

    WHEN 'code_cell' THEN
      -- The code and the names of what it reads; never the output rows.
      v_text := concat_ws(' ', v_p ->> 'source',
        internal.jsonb_path_text(v_p, '$.inputs[*].alias'),
        internal.jsonb_path_text(v_p, '$.inputs[*].label'));

    WHEN 'gate' THEN
      v_text := concat_ws(' ', v_p ->> 'label',
        internal.jsonb_path_text(v_p, '$.conditions[*].label'),
        internal.jsonb_path_text(v_p, '$.conditions[*].column'));

    WHEN 'sequence' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'name',
        v_p ->> 'registryIdentifier',
        internal.jsonb_path_text(v_p, '$.features[*].label'),
        internal.jsonb_path_text(v_p, '$.features[*].type'),
        internal.jsonb_path_text(v_p, '$.primers[*].name'),
        internal.jsonb_path_text(v_p, '$.primers[*].seq'),
        internal.jsonb_path_text(v_p, '$.plans[*].name'),
        internal.jsonb_path_text(v_p, '$.reads[*].name'),
        internal.jsonb_path_text(v_p, '$.products[*].identifier'),
        internal.jsonb_path_text(v_p, '$.products[*].title'));

    WHEN 'plugin' THEN
      -- A plugin block's state is the plugin's own; search does not read it.
      v_text := '';

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$$;
