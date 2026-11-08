-- A model with a plugin same-thing rule only takes new entries that come with
-- the key the rule gave, so an import, an API call or the assistant cannot add
-- a repeat either. create_registry_entry takes the key; adding an entry any
-- other way is refused with a message that says how.
DROP FUNCTION api.create_registry_entry(uuid, text, text, jsonb, boolean);
--> statement-breakpoint
CREATE FUNCTION internal.store_sameness_value(p_record_id uuid, p_workspace_id uuid, p_model_key text, p_value text)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.registry_sameness_rules s
                  WHERE s.workspace_id = p_workspace_id AND s.model_key = p_model_key) THEN
    RETURN;
  END IF;
  INSERT INTO api.registry_sameness_values (record_id, workspace_id, model_key, value)
  VALUES (p_record_id, p_workspace_id, p_model_key, btrim(p_value))
  ON CONFLICT (record_id) DO UPDATE SET value = EXCLUDED.value, computed_at = now();
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.store_sameness_value(uuid, uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.store_sameness_value(uuid, uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.store_sameness_value(uuid, uuid, text, text) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.create_registry_entry(
    p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_allow_duplicate boolean DEFAULT false, p_sameness_value text DEFAULT NULL)
RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.records;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = api.current_workspace_id() AND m.key = p_kind AND m.is_registry) THEN
    RAISE EXCEPTION 'that model is not a registry' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  PERFORM set_config('sheetbase.sameness_value', coalesce(btrim(p_sameness_value), ''), true);
  SELECT * INTO v_result FROM api.create_model_record(p_project_id, p_kind, p_title, 'draft', '{}'::text[], '{}'::jsonb, p_custom_fields);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  PERFORM set_config('sheetbase.sameness_value', '', true);
  IF nullif(btrim(coalesce(p_sameness_value, '')), '') IS NOT NULL THEN
    PERFORM internal.store_sameness_value(v_result.id, v_result.workspace_id, p_kind, p_sameness_value);
  END IF;
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_registry_entry(uuid, text, text, jsonb, boolean, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_registry_entry(uuid, text, text, jsonb, boolean, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_registry_entry(uuid, text, text, jsonb, boolean, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.registry_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dup text;
  v_key text;
BEGIN
  IF coalesce(current_setting('sheetbase.registry_allow_duplicate', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = NEW.workspace_id AND m.key = NEW.kind AND m.is_registry) THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(d.identifier, ', ') INTO v_dup
    FROM internal.registry_matches(NEW.workspace_id, NEW.kind, NEW.title, NEW.custom_fields, NEW.id) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM api.registry_sameness_rules s
                                   WHERE s.workspace_id = NEW.workspace_id AND s.model_key = NEW.kind) THEN
    v_key := nullif(coalesce(current_setting('sheetbase.sameness_value', true), ''), '');
    IF v_key IS NULL THEN
      RAISE EXCEPTION 'this registry has a same-thing rule from a plugin: add entries with create_registry_entry and the key the rule gives (POST /api/plugins/data, kind sameness-key)'
        USING ERRCODE = 'SB013';
    END IF;
    SELECT string_agg(r.identifier, ', ') INTO v_dup
      FROM api.registry_sameness_values v
      JOIN api.records r ON r.id = v.record_id AND r.deleted_at IS NULL
     WHERE v.workspace_id = NEW.workspace_id AND v.model_key = NEW.kind AND v.value = v_key;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
    END IF;
  END IF;
  RETURN NEW;
END $$;
