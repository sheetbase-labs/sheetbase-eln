-- Plugin points for instruments and inventory: instrument parsers, label
-- formats, barcode formats and storage rules.
--
-- Like the earlier points, each has its own switch for an administrator and a
-- structural manifest check here; the full rules are the TypeScript ones in
-- src/lib/extensions/data-points.ts and run on every upload. The plugin's
-- Python is run by the app, never by the database.
--
-- Label templates can now name a layout and a code that come from a plugin:
-- `layout` is `standard` or `plugin.<plugin>.<format>`, and `barcode_type` is
-- `qr`, `code128` or `plugin.<plugin>.<format>`.

-- Per-point switches ------------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.extensions'::regclass AND conname = 'chk_extensions_disabled_points';
  IF v_def IS NULL OR position('''report-sections''::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_extensions_disabled_points';
  END IF;
  EXECUTE 'ALTER TABLE api.extensions DROP CONSTRAINT chk_extensions_disabled_points';
  EXECUTE 'ALTER TABLE api.extensions ADD CONSTRAINT chk_extensions_disabled_points '
    || replace(v_def, '''report-sections''::text]',
         '''report-sections''::text, ''instrument-parsers''::text, ''label-formats''::text, ''barcode-formats''::text, ''storage-rules''::text]');
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'api.set_extension_point_enabled(uuid, uuid, text, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'report-sections')$q$;
  v_new constant text := $q$'report-sections', 'instrument-parsers', 'label-formats', 'barcode-formats', 'storage-rules')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.set_extension_point_enabled';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_manifest(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$'report-sections')$q$;
  v_new constant text := $q$'report-sections', 'instrument-parsers', 'label-formats', 'barcode-formats', 'storage-rules')$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_manifest';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Manifest validation ---------------------------------------------------------
DO $$
DECLARE
  v_sig regprocedure := 'internal.validate_extension_runner_points(jsonb)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_loop_old constant text := $q$'event-hooks', 'record-hooks'] LOOP$q$;
  v_loop_new constant text := $q$'event-hooks', 'record-hooks', 'instrument-parsers', 'label-formats', 'barcode-formats', 'storage-rules'] LOOP$q$;
  v_anchor constant text := $a$          RAISE EXCEPTION 'invalid extension record hook' USING ERRCODE = 'SB034';
        END IF;
$a$;
  v_branch constant text := $b$
      ELSIF v_point = 'instrument-parsers' THEN
        IF NOT internal.extension_strings_ok(v_entry->'extensions', c_ext)
           OR COALESCE((v_entry->>'encoding') = ANY (ARRAY['text', 'base64']), false) = false
           OR ((v_entry ? 'instrument')
               AND (jsonb_typeof(v_entry->'instrument') IS DISTINCT FROM 'string'
                    OR length(btrim(v_entry->>'instrument')) NOT BETWEEN 1 AND 120))
           OR ((v_entry ? 'contains')
               AND (NOT internal.extension_unique_strings_ok(v_entry->'contains', '^.{1,80}$')
                    OR CASE WHEN jsonb_typeof(v_entry->'contains') = 'array'
                            THEN jsonb_array_length(v_entry->'contains') > 5
                            ELSE true END)) THEN
          RAISE EXCEPTION 'invalid extension instrument parser' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'label-formats' THEN
        IF NOT internal.extension_strings_ok(v_entry->'kinds', c_type) THEN
          RAISE EXCEPTION 'invalid extension label format' USING ERRCODE = 'SB034';
        END IF;
      ELSIF v_point = 'barcode-formats' THEN
        IF COALESCE((v_entry->>'shape') = ANY (ARRAY['1d', '2d']), false) = false
           OR ((v_entry ? 'parse') AND NOT internal.extension_runner_ok(v_entry->'parse')) THEN
          RAISE EXCEPTION 'invalid extension barcode format' USING ERRCODE = 'SB034';
        END IF;
$b$;
BEGIN
  IF position(v_loop_old IN v_def) = 0 OR position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.validate_extension_runner_points';
  END IF;
  v_def := replace(v_def, v_loop_old, v_loop_new);
  v_def := replace(v_def, v_anchor, v_anchor || v_branch);
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Label templates --------------------------------------------------------------
ALTER TABLE api.label_templates
  ADD COLUMN layout text NOT NULL DEFAULT 'standard';
--> statement-breakpoint
ALTER TABLE api.label_templates DROP CONSTRAINT chk_label_templates_barcode;
--> statement-breakpoint
ALTER TABLE api.label_templates
  ADD CONSTRAINT chk_label_templates_barcode
  CHECK (barcode_type IN ('qr', 'code128') OR barcode_type ~ '^plugin\.[a-z0-9_-]{1,64}\.[a-z][a-z0-9-]{0,48}$');
--> statement-breakpoint
ALTER TABLE api.label_templates
  ADD CONSTRAINT chk_label_templates_layout
  CHECK (layout = 'standard' OR layout ~ '^plugin\.[a-z0-9_-]{1,64}\.[a-z][a-z0-9-]{0,48}$');
--> statement-breakpoint

DROP FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean);
--> statement-breakpoint
CREATE FUNCTION api.save_label_template(
  p_workspace_id uuid,
  p_id uuid,
  p_name text,
  p_record_kind text,
  p_width_mm integer,
  p_height_mm integer,
  p_barcode_type text,
  p_show_lot boolean,
  p_show_sample_type boolean,
  p_show_condition boolean,
  p_show_use_by boolean,
  p_is_default boolean,
  p_layout text DEFAULT 'standard'
) RETURNS api.label_templates
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.label_templates;
BEGIN
  IF NOT api.has_capability(p_workspace_id, 'settings.storage.manage') THEN
    RAISE EXCEPTION 'managing label templates needs access to Storage and labels' USING ERRCODE = '42501';
  END IF;
  IF p_is_default THEN
    UPDATE api.label_templates
       SET is_default = false, updated_at = now()
     WHERE workspace_id = p_workspace_id
       AND record_kind = p_record_kind
       AND is_default
       AND id IS DISTINCT FROM p_id;
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO api.label_templates (
      workspace_id, name, record_kind, width_mm, height_mm, barcode_type, layout,
      show_lot, show_sample_type, show_condition, show_use_by, is_default,
      created_by_user_id
    ) VALUES (
      p_workspace_id, btrim(p_name), btrim(p_record_kind), p_width_mm, p_height_mm,
      p_barcode_type, COALESCE(p_layout, 'standard'), p_show_lot, p_show_sample_type,
      p_show_condition, p_show_use_by, p_is_default, api.current_user_id()
    ) RETURNING * INTO v_row;
  ELSE
    UPDATE api.label_templates
       SET name = btrim(p_name), record_kind = btrim(p_record_kind),
           width_mm = p_width_mm, height_mm = p_height_mm,
           barcode_type = p_barcode_type, layout = COALESCE(p_layout, 'standard'),
           show_lot = p_show_lot,
           show_sample_type = p_show_sample_type,
           show_condition = p_show_condition, show_use_by = p_show_use_by,
           is_default = p_is_default, updated_at = now()
     WHERE id = p_id AND workspace_id = p_workspace_id
    RETURNING * INTO v_row;
    IF v_row.id IS NULL THEN
      RAISE EXCEPTION 'label template not found' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.save_label_template(uuid, uuid, text, text, integer, integer, text, boolean, boolean, boolean, boolean, boolean, text) TO authenticated;
