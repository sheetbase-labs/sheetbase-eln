-- Measurement tables can have subtypes too, to any depth. A subtype is a
-- Dataset Schema Definition whose parent_id names the measurement table it
-- extends. It carries every column of the tables above it plus its own.
--
-- Datasets pin one schema version and are checked against that version's
-- columns, so a subtype's versions hold the inherited columns themselves: a
-- new subtype starts with its parent's published columns, each new version
-- picks up columns its parents have published since, and a version can only
-- be published while it still has every inherited column with the same type.
-- Data already recorded keeps the version it was recorded against.
--
-- A table can move under another parent, or out on its own
-- (api.reparent_dataset_schema). Its open draft takes the new parent's
-- columns; datasets keep their versions.

ALTER TABLE api.dataset_schema_definitions
  ADD COLUMN parent_id uuid REFERENCES api.dataset_schema_definitions(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE api.dataset_schema_definitions
  ADD CONSTRAINT chk_dataset_schema_definitions_parent CHECK (parent_id IS NULL OR parent_id <> id);
--> statement-breakpoint
CREATE INDEX idx_dataset_schema_definitions_parent ON api.dataset_schema_definitions USING btree (parent_id) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
-- The tables above a measurement table, nearest first.
CREATE FUNCTION internal.dataset_schema_ancestors(p_definition_id uuid)
  RETURNS TABLE(id uuid, depth integer)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
  WITH RECURSIVE chain(id, parent_id, depth, path) AS (
    SELECT d.parent_id, p.parent_id, 1, ARRAY[d.id, d.parent_id]
      FROM api.dataset_schema_definitions d
      JOIN api.dataset_schema_definitions p ON p.id = d.parent_id
     WHERE d.id = p_definition_id
    UNION ALL
    SELECT c.parent_id, p.parent_id, c.depth + 1, c.path || c.parent_id
      FROM chain c
      JOIN api.dataset_schema_definitions p ON p.id = c.parent_id
     WHERE c.parent_id IS NOT NULL AND NOT c.parent_id = ANY(c.path) AND c.depth < 64
  )
  SELECT id, depth FROM chain
$$;
--> statement-breakpoint
ALTER FUNCTION internal.dataset_schema_ancestors(uuid) OWNER TO migrator;
--> statement-breakpoint
-- The columns a measurement table inherits: the active columns of each
-- ancestor's newest published version, from the top of the chain down. A key
-- appears once, from the highest table that has it.
CREATE FUNCTION internal.dataset_schema_inherited_fields(p_definition_id uuid)
  RETURNS SETOF api.dataset_schema_version_fields
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT DISTINCT ON (f.key) f.*
    FROM internal.dataset_schema_ancestors(p_definition_id) a
    CROSS JOIN LATERAL (
      SELECT v.id FROM api.dataset_schema_versions v
       WHERE v.schema_id = a.id AND v.lifecycle = 'active'
       ORDER BY v.version DESC LIMIT 1
    ) published
    JOIN api.dataset_schema_version_fields f
      ON f.schema_version_id = published.id AND f.lifecycle = 'active'
   ORDER BY f.key, a.depth DESC
$$;
--> statement-breakpoint
ALTER FUNCTION internal.dataset_schema_inherited_fields(uuid) OWNER TO migrator;
--> statement-breakpoint
-- Add the inherited columns a draft lacks, ahead of its own columns.
CREATE FUNCTION internal.merge_inherited_dataset_fields(p_schema_version_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_schema uuid;
BEGIN
  SELECT schema_id INTO v_schema FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
  INSERT INTO api.dataset_schema_version_fields(
    schema_version_id, field_id, key, label, description, logical_type, nullable,
    default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
  )
  SELECT p_schema_version_id, f.field_id, f.key, f.label, f.description, f.logical_type, f.nullable,
         f.default_value, f.quantity, f.validation, f.category, f.relationship, f.cardinality, 'active',
         f.display_order
    FROM internal.dataset_schema_inherited_fields(v_schema) f
   WHERE NOT EXISTS (
     SELECT 1 FROM api.dataset_schema_version_fields own
      WHERE own.schema_version_id = p_schema_version_id
        AND (own.key = f.key OR own.field_id = f.field_id)
   );
  -- Inherited columns may have been revived after a retire.
  UPDATE api.dataset_schema_version_fields own SET lifecycle = 'active'
    FROM internal.dataset_schema_inherited_fields(v_schema) f
   WHERE own.schema_version_id = p_schema_version_id AND own.key = f.key AND own.lifecycle <> 'active';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.merge_inherited_dataset_fields(uuid) OWNER TO migrator;
--> statement-breakpoint
-- A subtype version is published only with every inherited column, same type.
CREATE FUNCTION internal.guard_dataset_schema_inheritance() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_missing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions WHERE id = NEW.schema_id AND parent_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(f.label, ', ' ORDER BY f.display_order) INTO v_missing
    FROM internal.dataset_schema_inherited_fields(NEW.schema_id) f
   WHERE NOT EXISTS (
     SELECT 1 FROM api.dataset_schema_version_fields own
      WHERE own.schema_version_id = NEW.id AND own.key = f.key
        AND own.logical_type = f.logical_type AND own.lifecycle = 'active'
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'inherited columns are missing or changed: %', v_missing USING ERRCODE = 'SB070';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_dataset_schema_inheritance() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER a_dataset_schema_inheritance
  BEFORE UPDATE OF lifecycle ON api.dataset_schema_versions
  FOR EACH ROW WHEN (OLD.lifecycle = 'draft' AND NEW.lifecycle = 'active')
  EXECUTE FUNCTION internal.guard_dataset_schema_inheritance();
--> statement-breakpoint
-- parent_id changes only through api.reparent_dataset_schema.
CREATE FUNCTION internal.guard_dataset_schema_parent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN RETURN NEW; END IF;
  IF current_setting('sheetbase.dataset_schema_reparent', true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'use api.reparent_dataset_schema to move a measurement table' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.guard_dataset_schema_parent() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER a_dataset_schema_parent
  BEFORE UPDATE OF parent_id ON api.dataset_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.guard_dataset_schema_parent();
--> statement-breakpoint
CREATE FUNCTION internal.check_dataset_schema_parent(p_definition api.dataset_schema_definitions, p_parent_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_parent api.dataset_schema_definitions;
BEGIN
  IF p_parent_id IS NULL THEN RETURN; END IF;
  SELECT * INTO v_parent FROM api.dataset_schema_definitions WHERE id = p_parent_id;
  IF v_parent.id IS NULL OR v_parent.workspace_id IS DISTINCT FROM p_definition.workspace_id THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  IF v_parent.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'a retired measurement table cannot have subtypes' USING ERRCODE = 'SB071';
  END IF;
  IF p_parent_id = p_definition.id OR EXISTS (
    SELECT 1 FROM internal.dataset_schema_ancestors(p_parent_id) a WHERE a.id = p_definition.id
  ) THEN
    RAISE EXCEPTION 'a measurement table cannot sit under its own subtype' USING ERRCODE = 'SB071';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_dataset_schema_parent(api.dataset_schema_definitions, uuid) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION api.create_dataset_schema_subtype(p_parent_id uuid, p_key text, p_name text, p_description text DEFAULT NULL) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_parent api.dataset_schema_definitions;
  v_created jsonb;
  v_definition api.dataset_schema_definitions;
BEGIN
  SELECT * INTO v_parent FROM api.dataset_schema_definitions WHERE id = p_parent_id;
  IF v_parent.id IS NULL OR v_parent.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  v_created := api.create_dataset_schema_definition(v_parent.workspace_id, p_key, p_name, p_description, '[]'::jsonb);
  SELECT * INTO v_definition FROM api.dataset_schema_definitions
   WHERE id = (v_created->>'schema_definition_id')::uuid;
  PERFORM internal.check_dataset_schema_parent(v_definition, p_parent_id);
  PERFORM set_config('sheetbase.dataset_schema_reparent', v_definition.id::text, true);
  UPDATE api.dataset_schema_definitions SET parent_id = p_parent_id WHERE id = v_definition.id;
  PERFORM set_config('sheetbase.dataset_schema_reparent', '', true);
  PERFORM internal.merge_inherited_dataset_fields((v_created->>'schema_version_id')::uuid);
  RETURN v_created;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_dataset_schema_subtype(uuid, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_dataset_schema_subtype(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_dataset_schema_subtype(uuid, text, text, text) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.reparent_dataset_schema(p_definition_id uuid, p_parent_id uuid) RETURNS api.dataset_schema_definitions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_definition api.dataset_schema_definitions; v_draft uuid;
BEGIN
  SELECT * INTO v_definition FROM api.dataset_schema_definitions WHERE id = p_definition_id FOR UPDATE;
  IF v_definition.id IS NULL THEN
    RAISE EXCEPTION 'measurement table not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_definition.workspace_id, 'schema.edit');
  IF v_definition.parent_id IS NOT DISTINCT FROM p_parent_id THEN RETURN v_definition; END IF;
  PERFORM internal.check_dataset_schema_parent(v_definition, p_parent_id);
  PERFORM set_config('sheetbase.dataset_schema_reparent', v_definition.id::text, true);
  UPDATE api.dataset_schema_definitions SET parent_id = p_parent_id, updated_at = now()
   WHERE id = v_definition.id RETURNING * INTO v_definition;
  PERFORM set_config('sheetbase.dataset_schema_reparent', '', true);
  SELECT id INTO v_draft FROM api.dataset_schema_versions
   WHERE schema_id = v_definition.id AND lifecycle = 'draft' LIMIT 1;
  IF v_draft IS NOT NULL THEN
    PERFORM internal.merge_inherited_dataset_fields(v_draft);
  END IF;
  RETURN v_definition;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.reparent_dataset_schema(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reparent_dataset_schema(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.reparent_dataset_schema(uuid, uuid) TO authenticated;
--> statement-breakpoint
-- A subtype's next version picks up what its parents have published since.
CREATE OR REPLACE FUNCTION api.create_next_dataset_schema_version(p_schema_definition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  definition api.dataset_schema_definitions;
  source api.dataset_schema_versions;
  created api.dataset_schema_versions;
BEGIN
  SELECT * INTO definition FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id FOR UPDATE;
  IF definition.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Definition not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(definition.workspace_id, 'schema.edit');
  IF definition.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'retired Dataset Schema Definitions cannot be versioned' USING ERRCODE = 'SB072';
  END IF;
  SELECT * INTO source
    FROM api.dataset_schema_versions
   WHERE schema_id = definition.id
   ORDER BY version DESC
   LIMIT 1;
  IF source.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  created := internal.fork_dataset_schema_version(source.id);
  IF definition.parent_id IS NOT NULL THEN
    PERFORM internal.merge_inherited_dataset_fields(created.id);
  END IF;
  RETURN jsonb_build_object('schema_version_id', created.id, 'version', created.version);
END;
$function$;
