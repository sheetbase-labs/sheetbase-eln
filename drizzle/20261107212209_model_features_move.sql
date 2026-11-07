-- Move the optional parts of a model onto the Features list.
--
-- Registry, incident log, result limits, legal hold and retention each had
-- their own flag: columns on api.record_models, a table of ticked models, or a
-- lab-wide switch. They are now features of a model, one row each in
-- api.model_capabilities, switched on from the model's Features list like
-- campaigns. Nothing changes for the people using them: every old flag value is
-- carried across below and the pages read the same data.
--
--   registry       key fields, sequence field, structure field and lot model
--                  live in the row's settings
--   incident_log   was api.model_incident_logs
--   result_limits  was the lab-wide switch workspace_settings.spec_limits_enabled
--   legal_hold     was half of the lab-wide switch workspace_settings.retention_enabled
--   retention      the other half of that switch, and any model with a rule
--
-- A lab-wide switch that was on becomes the feature on every model the lab had.
-- The limits and rules themselves (field_spec_limits, retention_rules) are
-- untouched. The database still refuses to archive a held record whether or not
-- the Legal hold feature is on, so a hold can never be bypassed by switching it
-- off.

-- Reads ------------------------------------------------------------------------
CREATE FUNCTION internal.model_has_feature(p_workspace_id uuid, p_kind text, p_feature text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT EXISTS (SELECT 1 FROM api.model_capabilities c
                  WHERE c.workspace_id = p_workspace_id AND c.model_key = p_kind
                    AND c.capability = p_feature);
$$;
--> statement-breakpoint
ALTER FUNCTION internal.model_has_feature(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.model_has_feature(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.model_has_feature(uuid, text, text) TO authenticated;
--> statement-breakpoint

-- What a registry model is set up to do. No row when the model is not a registry.
CREATE FUNCTION internal.registry_setup(p_workspace_id uuid, p_kind text)
RETURNS TABLE (key_fields text[], sequence_field text, structure_field text, lot_kind text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(c.settings -> 'keyFields', '[]'::jsonb))), '{}'::text[]),
         nullif(c.settings ->> 'sequenceField', ''),
         nullif(c.settings ->> 'structureField', ''),
         nullif(c.settings ->> 'lotKind', '')
    FROM api.model_capabilities c
   WHERE c.workspace_id = p_workspace_id AND c.model_key = p_kind AND c.capability = 'registry';
$$;
--> statement-breakpoint
ALTER FUNCTION internal.registry_setup(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.registry_setup(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.registry_setup(uuid, text) TO authenticated;
--> statement-breakpoint

-- Carry the old flags across ------------------------------------------------------
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, settings, created_at, created_by_user_id)
SELECT m.workspace_id, m.key, 'registry',
       jsonb_build_object('keyFields', to_jsonb(m.registry_key_fields),
                          'sequenceField', to_jsonb(m.registry_sequence_field),
                          'structureField', to_jsonb(m.registry_structure_field),
                          'lotKind', to_jsonb(m.registry_lot_kind)),
       m.updated_at, coalesce(m.updated_by_user_id, m.created_by_user_id)
  FROM api.record_models m
 WHERE m.is_registry
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT l.workspace_id, l.model_key, 'incident_log', l.created_at, l.created_by_user_id
  FROM api.model_incident_logs l
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT m.workspace_id, m.key, 'result_limits', now(), coalesce(m.updated_by_user_id, m.created_by_user_id)
  FROM api.record_models m
  JOIN api.workspace_settings s ON s.workspace_id = m.workspace_id AND s.spec_limits_enabled
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT m.workspace_id, m.key, f.capability, now(), coalesce(m.updated_by_user_id, m.created_by_user_id)
  FROM api.record_models m
  JOIN api.workspace_settings s ON s.workspace_id = m.workspace_id AND s.retention_enabled
 CROSS JOIN (VALUES ('retention'), ('legal_hold')) AS f(capability)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Rules and holds that were already in place keep working while the switch was
-- off (the database never checked it), so their models carry the feature too.
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT m.workspace_id, m.key, 'retention', now(), coalesce(m.updated_by_user_id, m.created_by_user_id)
  FROM api.record_models m
 WHERE EXISTS (SELECT 1 FROM api.retention_rules r WHERE r.workspace_id = m.workspace_id AND r.kind = m.key)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT m.workspace_id, m.key, 'legal_hold', now(), coalesce(m.updated_by_user_id, m.created_by_user_id)
  FROM api.record_models m
 WHERE EXISTS (SELECT 1 FROM api.legal_holds h
                WHERE h.workspace_id = m.workspace_id AND h.released_at IS NULL AND h.kind = m.key)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Settings a feature keeps ---------------------------------------------------------
-- Checks and tidies the settings of a feature before they are stored. Only the
-- registry has settings of its own today.
CREATE FUNCTION internal.feature_settings(
    p_workspace_id uuid, p_model_key text, p_capability text, p_settings jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_keys text[];
  v_name text;
  v_sequence text;
  v_structure text;
  v_lot text;
BEGIN
  IF p_capability <> 'registry' THEN
    RETURN p_settings;
  END IF;
  IF jsonb_typeof(coalesce(p_settings -> 'keyFields', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'choose the duplicate-check fields as a list' USING ERRCODE = '22023';
  END IF;
  v_keys := coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_settings -> 'keyFields', '[]'::jsonb))), '{}'::text[]);
  v_sequence := nullif(p_settings ->> 'sequenceField', '');
  v_structure := nullif(p_settings ->> 'structureField', '');
  v_lot := nullif(p_settings ->> 'lotKind', '');
  IF cardinality(v_keys) > 4 THEN
    RAISE EXCEPTION 'choose at most four fields for the duplicate check' USING ERRCODE = '22023';
  END IF;
  FOREACH v_name IN ARRAY v_keys
      || CASE WHEN v_sequence IS NULL THEN '{}'::text[] ELSE ARRAY[v_sequence] END
      || CASE WHEN v_structure IS NULL THEN '{}'::text[] ELSE ARRAY[v_structure] END LOOP
    IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions d
                    WHERE d.workspace_id = p_workspace_id AND d.kind = p_model_key
                      AND d.field_name = v_name AND d.lifecycle = 'active') THEN
      RAISE EXCEPTION 'the model has no active field called %', v_name USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF v_lot IS NOT NULL THEN
    IF v_structure IS NULL THEN
      RAISE EXCEPTION 'choose the structure field before the lot model' USING ERRCODE = '22023';
    END IF;
    IF v_lot = p_model_key OR NOT EXISTS (
         SELECT 1 FROM api.record_models m WHERE m.workspace_id = p_workspace_id AND m.key = v_lot) THEN
      RAISE EXCEPTION 'choose another model for lots' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN jsonb_build_object('keyFields', to_jsonb(v_keys), 'sequenceField', to_jsonb(v_sequence),
                            'structureField', to_jsonb(v_structure), 'lotKind', to_jsonb(v_lot));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.feature_settings(uuid, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.feature_settings(uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_model_capability(
    p_model_key text, p_capability text, p_enabled boolean,
    p_settings jsonb DEFAULT NULL) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_changed boolean := false;
  v_rows integer;
  v_settings jsonb;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF p_capability IS NULL OR p_capability !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'unknown feature' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'settings are a JSON object' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    v_settings := internal.feature_settings(v_workspace_id, p_model_key, p_capability,
      coalesce(p_settings,
               (SELECT c.settings FROM api.model_capabilities c
                 WHERE c.workspace_id = v_workspace_id AND c.model_key = p_model_key
                   AND c.capability = p_capability),
               '{}'::jsonb));
    INSERT INTO api.model_capabilities (workspace_id, model_key, capability, settings, created_by_user_id)
    VALUES (v_workspace_id, p_model_key, p_capability, v_settings, api.current_user_id())
    ON CONFLICT (workspace_id, model_key, capability) DO UPDATE
       SET settings = EXCLUDED.settings
    RETURNING (xmax = 0) INTO v_changed;
  ELSE
    DELETE FROM api.model_capabilities
     WHERE workspace_id = v_workspace_id AND model_key = p_model_key AND capability = p_capability;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_changed := v_rows > 0;
  END IF;
  IF v_changed THEN
    PERFORM internal.emit_change_event(v_workspace_id, 'model_capability',
      md5(v_workspace_id::text || ':' || p_model_key || ':' || p_capability)::uuid,
      'update', NULL, NULL,
      jsonb_build_object('change', CASE WHEN coalesce(p_enabled, false) THEN 'enabled' ELSE 'disabled' END,
                         'modelKey', p_model_key, 'feature', p_capability));
  END IF;
  RETURN coalesce(p_enabled, false);
END $$;
--> statement-breakpoint

-- Registry -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.registry_matches(
    p_workspace_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid)
RETURNS TABLE(id uuid, identifier text, title text, archived boolean, match text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_keys text[];
  v_key text;
  v_values text[] := '{}';
  v_complete boolean := true;
  v_value text;
BEGIN
  SELECT s.key_fields INTO v_keys FROM internal.registry_setup(p_workspace_id, p_kind) s;
  IF NOT FOUND THEN RETURN; END IF;
  IF cardinality(v_keys) = 0 THEN
    v_complete := false;
  ELSE
    FOREACH v_key IN ARRAY v_keys LOOP
      v_value := lower(btrim(coalesce(p_custom_fields ->> v_key, '')));
      IF v_value = '' THEN v_complete := false; END IF;
      v_values := v_values || v_value;
    END LOOP;
  END IF;
  RETURN QUERY
  SELECT r.id, r.identifier, r.title, r.archived_at IS NOT NULL,
         CASE WHEN v_complete AND (
                SELECT bool_and(lower(btrim(coalesce(r.custom_fields ->> k.name, ''))) = v_values[k.ord])
                  FROM unnest(v_keys) WITH ORDINALITY AS k(name, ord))
              THEN 'exact' ELSE 'name' END
    FROM api.records r
   WHERE r.workspace_id = p_workspace_id AND r.kind = p_kind AND r.deleted_at IS NULL
     AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
     AND (lower(btrim(r.title)) = lower(btrim(coalesce(p_title, '')))
          OR (v_complete AND (
                SELECT bool_and(lower(btrim(coalesce(r.custom_fields ->> k.name, ''))) = v_values[k.ord])
                  FROM unnest(v_keys) WITH ORDINALITY AS k(name, ord))))
   ORDER BY 5, r.identifier;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.registry_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dup text;
BEGIN
  IF coalesce(current_setting('sheetbase.registry_allow_duplicate', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NOT internal.model_has_feature(NEW.workspace_id, NEW.kind, 'registry') THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(d.identifier, ', ') INTO v_dup
    FROM internal.registry_matches(NEW.workspace_id, NEW.kind, NEW.title, NEW.custom_fields, NEW.id) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_registry_entry(
    p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_allow_duplicate boolean DEFAULT false) RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_result api.records;
BEGIN
  IF NOT internal.model_has_feature(api.current_workspace_id(), p_kind, 'registry') THEN
    RAISE EXCEPTION 'that model is not a registry' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  SELECT * INTO v_result FROM api.create_model_record(p_project_id, p_kind, p_title, 'draft', '{}'::text[], '{}'::jsonb, p_custom_fields);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text DEFAULT 'parent')
RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_entry api.records;
  v_parent api.records;
BEGIN
  IF p_entry_id = p_parent_id THEN
    RAISE EXCEPTION 'an entry cannot come from itself' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_entry FROM api.records WHERE id = p_entry_id;
  SELECT * INTO v_parent FROM api.records WHERE id = p_parent_id;
  IF v_entry.id IS NULL OR v_parent.id IS NULL
     OR v_entry.workspace_id <> api.current_workspace_id()
     OR v_parent.workspace_id <> api.current_workspace_id() THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  IF NOT internal.model_has_feature(v_entry.workspace_id, v_entry.kind, 'registry')
     OR NOT internal.model_has_feature(v_parent.workspace_id, v_parent.kind, 'registry') THEN
    RAISE EXCEPTION 'lineage links registry entries to registry entries' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT source_record_id AS rid FROM api.record_links
       WHERE link_type = 'upstream' AND target_record_id = p_entry_id
      UNION
      SELECT l.source_record_id FROM api.record_links l JOIN down d ON l.target_record_id = d.rid
       WHERE l.link_type = 'upstream'
    ) SELECT 1 FROM down WHERE rid = p_parent_id
  ) THEN
    RAISE EXCEPTION 'that would make the entry come from its own descendant' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.record_links (source_record_id, target_record_id, target_kind, target_identifier,
                               link_type, created_by_user_id, link_metadata)
  VALUES (p_entry_id, p_parent_id, v_parent.kind, v_parent.identifier, 'upstream',
          api.current_user_id(), jsonb_build_object('role', coalesce(nullif(p_role, ''), 'parent')))
  ON CONFLICT (source_record_id, target_identifier, link_type)
  DO UPDATE SET link_metadata = jsonb_build_object('role', coalesce(nullif(p_role, ''), 'parent')), updated_at = now();
END $$;
--> statement-breakpoint

-- Tick or untick a model as a registry and choose its duplicate-check fields.
-- The structure field and lot model are kept when the model stays a registry.
CREATE OR REPLACE FUNCTION api.set_model_registry(
    p_model_key text, p_is_registry boolean, p_key_fields text[] DEFAULT '{}'::text[],
    p_sequence_field text DEFAULT NULL::text) RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_old jsonb;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  p_key_fields := coalesce(p_key_fields, '{}');
  IF cardinality(p_key_fields) > 4 THEN
    RAISE EXCEPTION 'choose at most four fields for the duplicate check' USING ERRCODE = '22023';
  END IF;
  SELECT c.settings INTO v_old FROM api.model_capabilities c
   WHERE c.workspace_id = v_workspace_id AND c.model_key = p_model_key AND c.capability = 'registry';
  PERFORM api.set_model_capability(p_model_key, 'registry', coalesce(p_is_registry, false),
    coalesce(v_old, '{}'::jsonb) || jsonb_build_object(
      'keyFields', to_jsonb(p_key_fields), 'sequenceField', to_jsonb(nullif(p_sequence_field, ''))));
  UPDATE api.record_models SET updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_model.id
  RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint

-- Choose the field that holds the drawn structure, and the model that lots are
-- made from. Either can be cleared. The model must already be a registry.
CREATE OR REPLACE FUNCTION api.set_model_chemistry(
    p_model_key text, p_structure_field text DEFAULT NULL, p_lot_kind text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_old jsonb;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT c.settings INTO v_old FROM api.model_capabilities c
   WHERE c.workspace_id = v_workspace_id AND c.model_key = p_model_key AND c.capability = 'registry';
  IF v_old IS NULL THEN
    IF nullif(p_structure_field, '') IS NOT NULL THEN
      RAISE EXCEPTION 'tick the model as a registry first' USING ERRCODE = '22023';
    END IF;
    RETURN v_model;
  END IF;
  IF nullif(p_lot_kind, '') IS NOT NULL AND nullif(p_structure_field, '') IS NULL THEN
    RAISE EXCEPTION 'choose the structure field before the lot model' USING ERRCODE = '22023';
  END IF;
  PERFORM api.set_model_capability(p_model_key, 'registry', true,
    v_old || jsonb_build_object(
      'structureField', to_jsonb(nullif(p_structure_field, '')),
      'lotKind', CASE WHEN nullif(p_structure_field, '') IS NOT NULL
                      THEN to_jsonb(nullif(p_lot_kind, '')) ELSE 'null'::jsonb END));
  UPDATE api.record_models SET updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_model.id
  RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint

-- The shared look at a registry model that takes structures.
DROP FUNCTION internal.chemistry_model(uuid, text);
--> statement-breakpoint
CREATE FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text)
RETURNS TABLE (structure_field text, lot_kind text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  RETURN QUERY
  SELECT s.structure_field, s.lot_kind FROM internal.registry_setup(p_workspace_id, p_kind) s
   WHERE s.structure_field IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'that model does not register structures' USING ERRCODE = '22023';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.chemistry_model(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.chemistry_model(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.chemistry_model(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.register_compound(
    p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_structure jsonb,
    p_allow_duplicate boolean DEFAULT false) RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_structure_field text;
  v_result api.records;
BEGIN
  SELECT m.structure_field INTO v_structure_field FROM internal.chemistry_model(v_workspace_id, p_kind) m;
  IF nullif(p_structure ->> 'molfile', '') IS NULL THEN
    RAISE EXCEPTION 'draw a structure first' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  SELECT * INTO v_result FROM api.create_model_record(
    p_project_id, p_kind, p_title, 'draft', '{}'::text[], '{}'::jsonb,
    coalesce(p_custom_fields, '{}'::jsonb) || jsonb_build_object(v_structure_field, p_structure ->> 'molfile'));
  PERFORM internal.write_record_structure_checked(v_result.id, p_kind, p_structure);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_compound_lot(
    p_compound_id uuid, p_project_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text,
    p_custom_fields jsonb DEFAULT '{}'::jsonb) RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_compound api.records;
  v_lot_kind text;
  v_lot api.records;
BEGIN
  SELECT * INTO v_compound FROM api.records WHERE id = p_compound_id;
  IF v_compound.id IS NULL OR v_compound.workspace_id <> api.current_workspace_id() THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT m.lot_kind INTO v_lot_kind FROM internal.chemistry_model(v_compound.workspace_id, v_compound.kind) m;
  IF v_lot_kind IS NULL THEN
    RAISE EXCEPTION 'this registry has no lot model' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_lot FROM api.create_model_record(
    coalesce(p_project_id, v_compound.project_id), v_lot_kind,
    coalesce(nullif(btrim(p_title), ''), v_compound.identifier || ' lot'),
    'draft', '{}'::text[], '{}'::jsonb, coalesce(p_custom_fields, '{}'::jsonb));
  INSERT INTO api.record_links (source_record_id, target_record_id, target_kind, target_identifier,
                               link_type, created_by_user_id, link_metadata)
  VALUES (v_lot.id, v_compound.id, v_compound.kind, v_compound.identifier, 'general',
          api.current_user_id(), jsonb_build_object('role', 'lot_of'));
  RETURN v_lot;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.set_record_structure(
    p_record_id uuid, p_expected_metadata_version integer, p_structure jsonb,
    p_allow_duplicate boolean DEFAULT false) RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_structure_field text;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id;
  IF v_record.id IS NULL OR v_record.workspace_id <> api.current_workspace_id() THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT m.structure_field INTO v_structure_field FROM internal.chemistry_model(v_record.workspace_id, v_record.kind) m;
  IF nullif(p_structure ->> 'molfile', '') IS NULL THEN
    RAISE EXCEPTION 'draw a structure first' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  SELECT * INTO v_record FROM api.update_record_custom_fields(
    p_record_id, p_expected_metadata_version,
    jsonb_build_object(v_structure_field, p_structure ->> 'molfile'));
  PERFORM internal.write_record_structure_checked(p_record_id, v_record.kind, p_structure);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_record;
END $$;
--> statement-breakpoint

-- Incident log ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.trg_change_event_record_created_kinds() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF internal.model_has_feature(NEW.workspace_id, NEW.kind, 'incident_log') THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'incident', NEW.id, 'create', NEW.id, NEW.project_id,
      jsonb_build_object('recordId', NEW.id, 'identifier', NEW.identifier, 'title', NEW.title,
                         'model', NEW.kind, 'status', NEW.status));
  END IF;
  IF internal.model_has_feature(NEW.workspace_id, NEW.kind, 'registry') THEN
    PERFORM internal.emit_change_event(NEW.workspace_id, 'registry_entry', NEW.id, 'create', NEW.id, NEW.project_id,
      jsonb_build_object('recordId', NEW.id, 'identifier', NEW.identifier, 'title', NEW.title,
                         'registry', NEW.kind));
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- A starter model that is an incident log switches the feature on.
DO $$
DECLARE
  v_sig regprocedure := 'api.create_starter_model(text, text, text, text, jsonb, boolean)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := 'PERFORM api.set_model_incident_log(p_key, true);';
  v_new constant text := 'PERFORM api.set_model_capability(p_key, ''incident_log'', true);';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.create_starter_model';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint
DROP FUNCTION api.set_model_incident_log(text, boolean);
--> statement-breakpoint

-- Result limits ----------------------------------------------------------------------
CREATE OR REPLACE VIEW api.record_spec_results WITH (security_invoker = 'true') AS
 SELECT r.id AS record_id,
    r.workspace_id,
    r.kind,
    r.identifier,
    r.title,
    r.project_id,
    r.archived_at,
    s.field_name,
    v.value,
    s.lower_limit,
    s.upper_limit,
    s.alert_lower,
    s.alert_upper,
    internal.spec_verdict(v.value, s.lower_limit, s.upper_limit, s.alert_lower, s.alert_upper) AS verdict
   FROM ((api.records r
     JOIN api.field_spec_limits s ON (((s.workspace_id = r.workspace_id) AND (s.kind = r.kind))))
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN (jsonb_typeof((r.custom_fields -> s.field_name)) = 'number'::text) THEN ((r.custom_fields ->> s.field_name))::numeric
                    WHEN ((jsonb_typeof((r.custom_fields -> s.field_name)) = 'string'::text) AND (btrim((r.custom_fields ->> s.field_name)) ~ '^-?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$'::text)) THEN (btrim((r.custom_fields ->> s.field_name)))::numeric
                    ELSE NULL::numeric
                END AS value) v)
  WHERE ((r.deleted_at IS NULL) AND (v.value IS NOT NULL)
         AND internal.model_has_feature(r.workspace_id, r.kind, 'result_limits'));
--> statement-breakpoint

-- Retention --------------------------------------------------------------------------
-- A rule only applies to a model that has the Retention feature.
DO $$
DECLARE
  v_sig regprocedure := 'api.retention_due(text)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := 'AND internal.record_hold_name(r.workspace_id, r.id, r.project_id, r.kind) IS NULL';
  v_new constant text := 'AND internal.model_has_feature(r.workspace_id, r.kind, ''retention'')
     AND internal.record_hold_name(r.workspace_id, r.id, r.project_id, r.kind) IS NULL';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.retention_due';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- Drop the old flags -------------------------------------------------------------------
DROP FUNCTION api.set_spec_limits_enabled(uuid, boolean);
--> statement-breakpoint
DROP FUNCTION api.set_retention_enabled(uuid, boolean);
--> statement-breakpoint
DROP FUNCTION internal.spec_limits_on(uuid);
--> statement-breakpoint
ALTER TABLE api.workspace_settings DROP COLUMN spec_limits_enabled, DROP COLUMN retention_enabled;
--> statement-breakpoint
DROP TABLE api.model_incident_logs;
--> statement-breakpoint
ALTER TABLE api.record_models DROP CONSTRAINT chk_record_models_registry_keys;
--> statement-breakpoint
ALTER TABLE api.record_models
    DROP COLUMN is_registry, DROP COLUMN registry_key_fields, DROP COLUMN registry_sequence_field,
    DROP COLUMN registry_structure_field, DROP COLUMN registry_lot_kind;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.model_descendants(p_workspace uuid, p_key text) RETURNS SETOF api.record_models
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH RECURSIVE below AS (
    SELECT m.*, 1 AS depth FROM api.record_models m WHERE m.workspace_id = p_workspace AND m.parent_key = p_key
    UNION ALL
    SELECT m.*, below.depth + 1 FROM api.record_models m
      JOIN below ON m.workspace_id = p_workspace AND m.parent_key = below.key
     WHERE below.depth < 64
  )
  SELECT id, workspace_id, key, name, description, identifier_prefix, lifecycle, current_version,
         created_at, updated_at, created_by_user_id, updated_by_user_id, parent_key
    FROM below
$$;
--> statement-breakpoint

-- A feature row belongs to its model: it follows a renamed key and goes with a
-- deleted model, and the API can read a model together with its features.
ALTER TABLE api.model_capabilities
    ADD CONSTRAINT model_capabilities_model_fkey FOREIGN KEY (workspace_id, model_key)
    REFERENCES api.record_models (workspace_id, key) ON UPDATE CASCADE ON DELETE CASCADE;
