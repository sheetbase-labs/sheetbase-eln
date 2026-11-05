-- Registries. A record model can be ticked as a registry: a governed list of
-- the things a lab makes and keeps using (constructs, cell lines, antibodies,
-- strains, anything the lab models). Its records are the entries.
--
-- A registry adds three things to an ordinary record model:
--   * a duplicate check: before an entry is added or changed, the app and the
--     database look for another entry with the same name or with the same
--     values in the model's "key" fields (say vendor and catalogue number);
--     a repeat is refused unless the person registers it again on purpose;
--   * lineage: an entry can name the entries it came from (a plasmid's vector
--     and insert, a cell line's parent line) with the part each one played,
--     and loops are refused;
--   * retiring: an entry is archived, never deleted, and keeps its number.
-- The number is the model's own identifier (CON-0001) and is never reused.
--
-- Lineage reuses record links (type 'upstream', the part played in the link
-- metadata) and "used by" reuses the ordinary incoming links, so the lineage
-- views already in the app show registry entries without any new plumbing.

ALTER TABLE api.record_models
    ADD COLUMN is_registry boolean DEFAULT false NOT NULL,
    ADD COLUMN registry_key_fields text[] DEFAULT '{}'::text[] NOT NULL,
    ADD COLUMN registry_sequence_field text;
--> statement-breakpoint
ALTER TABLE api.record_models
    ADD CONSTRAINT chk_record_models_registry_keys CHECK (
      NOT is_registry OR (cardinality(registry_key_fields) <= 4));
--> statement-breakpoint

-- Subtype lookups list the model's columns by name, so they have to learn the
-- new ones.
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
         created_at, updated_at, created_by_user_id, updated_by_user_id, parent_key,
         is_registry, registry_key_fields, registry_sequence_field
    FROM below
$$;
--> statement-breakpoint

-- Entries that look like the one being added or changed, best match first.
-- "exact": every key field matches another entry's (and none is empty).
-- "name": the same name once case and spacing are ignored.
CREATE FUNCTION internal.registry_matches(
    p_workspace_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid)
RETURNS TABLE (id uuid, identifier text, title text, archived boolean, match text)
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
  SELECT registry_key_fields INTO v_keys
    FROM api.record_models
   WHERE workspace_id = p_workspace_id AND key = p_kind AND is_registry;
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
ALTER FUNCTION internal.registry_matches(p_workspace_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.registry_matches(p_workspace_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.registry_find_duplicates(p_kind text, p_title text, p_custom_fields jsonb DEFAULT '{}'::jsonb, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, identifier text, title text, archived boolean, match text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.registry_matches(v_workspace_id, p_kind, p_title, p_custom_fields, p_exclude_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.registry_find_duplicates(p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.registry_find_duplicates(p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.registry_find_duplicates(p_kind text, p_title text, p_custom_fields jsonb, p_exclude_id uuid) TO authenticated;
--> statement-breakpoint

-- The database enforces the check, so an import or an API call cannot add a
-- repeat either. `register anyway` sets a flag for the one transaction.
CREATE FUNCTION internal.registry_guard() RETURNS trigger
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
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = NEW.workspace_id AND m.key = NEW.kind AND m.is_registry) THEN
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
ALTER FUNCTION internal.registry_guard() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.registry_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER records_registry_guard BEFORE INSERT OR UPDATE OF title, custom_fields ON api.records
    FOR EACH ROW EXECUTE FUNCTION internal.registry_guard();
--> statement-breakpoint

-- Tick or untick a model as a registry and choose its duplicate-check fields.
CREATE FUNCTION api.set_model_registry(
    p_model_key text, p_is_registry boolean, p_key_fields text[] DEFAULT '{}'::text[],
    p_sequence_field text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_field text;
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
  FOREACH v_field IN ARRAY p_key_fields || CASE WHEN nullif(p_sequence_field, '') IS NULL THEN '{}'::text[] ELSE ARRAY[p_sequence_field] END LOOP
    IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions d
                    WHERE d.workspace_id = v_workspace_id AND d.kind = p_model_key
                      AND d.field_name = v_field AND d.lifecycle = 'active') THEN
      RAISE EXCEPTION 'the model has no active field called %', v_field USING ERRCODE = '22023';
    END IF;
  END LOOP;
  UPDATE api.record_models
     SET is_registry = coalesce(p_is_registry, false),
         registry_key_fields = CASE WHEN coalesce(p_is_registry, false) THEN p_key_fields ELSE '{}' END,
         registry_sequence_field = CASE WHEN coalesce(p_is_registry, false) THEN nullif(p_sequence_field, '') END,
         updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_model.id
  RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_registry(p_model_key text, p_is_registry boolean, p_key_fields text[], p_sequence_field text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_registry(p_model_key text, p_is_registry boolean, p_key_fields text[], p_sequence_field text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_registry(p_model_key text, p_is_registry boolean, p_key_fields text[], p_sequence_field text) TO authenticated;
--> statement-breakpoint

-- Add an entry. Same as create_model_record, but a person who has seen the
-- duplicate warning can register it anyway.
CREATE FUNCTION api.create_registry_entry(
    p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb DEFAULT '{}'::jsonb,
    p_allow_duplicate boolean DEFAULT false)
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
  SELECT * INTO v_result FROM api.create_model_record(p_project_id, p_kind, p_title, 'draft', '{}'::text[], '{}'::jsonb, p_custom_fields);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_registry_entry(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_allow_duplicate boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_registry_entry(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_allow_duplicate boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_registry_entry(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_allow_duplicate boolean) TO authenticated;
--> statement-breakpoint

-- Name where an entry came from. Both must be registry entries; a loop (an
-- entry coming from its own descendant) is refused.
CREATE FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text DEFAULT 'parent')
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
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_entry.workspace_id AND m.key = v_entry.kind AND m.is_registry)
     OR NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_parent.workspace_id AND m.key = v_parent.kind AND m.is_registry) THEN
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
ALTER FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) RETURNS void
    LANGUAGE sql
    SET search_path TO ''
    AS $$
  DELETE FROM api.record_links
   WHERE source_record_id = p_entry_id AND target_record_id = p_parent_id AND link_type = 'upstream'
$$;
--> statement-breakpoint
ALTER FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) TO authenticated;
--> statement-breakpoint

-- Set up a ready-made registry: a published model with its fields, already
-- ticked as a registry. The person can add fields to it afterwards like any
-- other model. `p_fields` is a list of {field_name, label, logical_type}.
CREATE FUNCTION api.create_registry_model(
    p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb,
    p_key_fields text[], p_sequence_field text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_field jsonb;
  v_order integer := 0;
  v_fields jsonb := '[]'::jsonb;
  v_def api.record_field_definitions;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  PERFORM api.require_capability(v_workspace_id, 'schema.publish');
  v_model := api.create_workspace_model(v_workspace_id, p_key, p_name, p_prefix, p_description);
  FOR v_field IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    v_order := v_order + 1;
    INSERT INTO api.record_field_definitions
      (workspace_id, kind, field_name, label, display_order, logical_type, nullable,
       validation, lifecycle, created_by_user_id, section, show_in_list, ask_on_create)
    VALUES (v_workspace_id, p_key, v_field ->> 'field_name', v_field ->> 'label', v_order,
            coalesce(v_field ->> 'logical_type', 'text'), true, '{}'::jsonb, 'active',
            api.current_user_id(), nullif(v_field ->> 'section', ''),
            coalesce((v_field ->> 'show_in_list')::boolean, false), true)
    RETURNING * INTO v_def;
    v_fields := v_fields || (to_jsonb(v_def) || '{"options":[]}'::jsonb);
  END LOOP;
  INSERT INTO api.record_model_versions
    (workspace_id, model_id, version, revision, lifecycle, definition, published_at,
     created_by_user_id, updated_by_user_id)
  VALUES (v_workspace_id, v_model.id, 1, 1, 'published', jsonb_build_object('fields', v_fields), now(),
          api.current_user_id(), api.current_user_id());
  UPDATE api.record_models SET lifecycle = 'published' WHERE id = v_model.id;
  SELECT * INTO v_model FROM api.set_model_registry(p_key, true, p_key_fields, p_sequence_field);
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_registry_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_key_fields text[], p_sequence_field text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_registry_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_key_fields text[], p_sequence_field text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_registry_model(p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb, p_key_fields text[], p_sequence_field text) TO authenticated;
