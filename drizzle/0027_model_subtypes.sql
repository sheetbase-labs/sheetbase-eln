-- Any model can have subtypes. A subtype is a workspace record type
-- (api.record_models) whose parent_key names the model it extends: a
-- built-in model (Experiment, Sample, Material, Protocol, Project,
-- Instrument) or another workspace record type, to any depth. A subtype
-- inherits every field of every model above it and adds its own, and always
-- has its own ID prefix.
--
-- Objects of a subtype stay objects of the model at the top of the chain: a
-- Cell culture experiment is a record of kind 'experiment', a Cleanroom
-- project is a row in api.projects. The object pins the subtype's published
-- version through model_version_id, which records already carry and projects
-- and instruments gain here. Validation walks the chain: the pinned version's
-- own fields, each ancestor's latest published fields, and the added fields of
-- a built-in model at the top. A field key is unique across the whole chain.
--
-- An object's type can change until it is signed (api.set_model_type), and a
-- record type can move under a new parent (api.reparent_record_model), which
-- migrates its records when the model at the top of the chain changes.

ALTER TABLE api.record_models ADD COLUMN parent_key text;
--> statement-breakpoint
ALTER TABLE api.record_models
  ADD CONSTRAINT chk_record_models_parent_key
  CHECK (parent_key IS NULL OR (parent_key ~ '^[a-z][a-z0-9_]{0,59}$' AND parent_key <> key));
--> statement-breakpoint
CREATE INDEX idx_record_models_parent ON api.record_models USING btree (workspace_id, parent_key);
--> statement-breakpoint
ALTER TABLE api.projects
  ADD COLUMN model_version_id uuid REFERENCES api.record_model_versions(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE api.instruments
  ADD COLUMN model_version_id uuid REFERENCES api.record_model_versions(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX idx_projects_model_version ON api.projects USING btree (model_version_id) WHERE model_version_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_instruments_model_version ON api.instruments USING btree (model_version_id) WHERE model_version_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_records_model_version ON api.records USING btree (model_version_id) WHERE model_version_id IS NOT NULL;
--> statement-breakpoint
-- A subtype's own prefix replaces PRJ- and INS-.
ALTER TABLE api.projects DROP CONSTRAINT chk_projects_display_id;
--> statement-breakpoint
ALTER TABLE api.projects ADD CONSTRAINT chk_projects_display_id
  CHECK (display_id IS NULL OR display_id ~ '^[A-Z][A-Z0-9]{0,7}-[0-9]{4,}$');
--> statement-breakpoint
ALTER TABLE api.instruments DROP CONSTRAINT chk_instruments_display_id;
--> statement-breakpoint
ALTER TABLE api.instruments ADD CONSTRAINT chk_instruments_display_id
  CHECK (display_id IS NULL OR display_id ~ '^[A-Z][A-Z0-9]{0,7}-[0-9]{4,}$');
--> statement-breakpoint
-- The built-in models a subtype may extend. Core infrastructure (users,
-- access, audit, signing) is not a model and can never be a parent.
CREATE FUNCTION internal.extendable_builtin_model(p_key text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT p_key IN ('experiment','sample','material','protocol_template','project','instrument')
$$;
--> statement-breakpoint
-- The models above p_key, nearest first. A built-in model ends the chain.
CREATE FUNCTION internal.model_ancestors(p_workspace uuid, p_key text)
    RETURNS TABLE(key text, depth integer, builtin boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE current_key text := p_key; parent text; level integer := 0;
BEGIN
  LOOP
    IF EXISTS (SELECT 1 FROM api.model_kinds m WHERE m.key = current_key) THEN RETURN; END IF;
    SELECT m.parent_key INTO parent FROM api.record_models m
      WHERE m.workspace_id = p_workspace AND m.key = current_key;
    IF parent IS NULL THEN RETURN; END IF;
    level := level + 1;
    IF level > 64 THEN RAISE EXCEPTION 'model chain is too deep' USING ERRCODE = 'SB071'; END IF;
    key := parent;
    depth := level;
    builtin := EXISTS (SELECT 1 FROM api.model_kinds m WHERE m.key = parent);
    RETURN NEXT;
    current_key := parent;
  END LOOP;
END $$;
--> statement-breakpoint
-- The model at the top of p_key's chain (p_key itself when it has no parent).
CREATE FUNCTION internal.model_root(p_workspace uuid, p_key text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT coalesce(
    (SELECT a.key FROM internal.model_ancestors(p_workspace, p_key) a ORDER BY a.depth DESC LIMIT 1),
    p_key)
$$;
--> statement-breakpoint
-- Where objects of p_key live: 'records' with their record kind, or the
-- 'project' / 'instrument' tables. NULL when the chain does not end in a model
-- that can have subtypes.
CREATE FUNCTION internal.model_host(p_workspace uuid, p_key text, OUT host text, OUT record_kind text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE root text := internal.model_root(p_workspace, p_key); kind api.model_kinds;
BEGIN
  SELECT * INTO kind FROM api.model_kinds WHERE key = root;
  IF kind.key IS NULL THEN
    IF EXISTS (SELECT 1 FROM api.record_models WHERE workspace_id = p_workspace AND key = root) THEN
      host := 'records'; record_kind := root;
    END IF;
    RETURN;
  END IF;
  IF NOT internal.extendable_builtin_model(root) THEN RETURN; END IF;
  IF kind.identity_table = 'api.records' THEN host := 'records'; record_kind := kind.record_kind;
  ELSIF kind.identity_table = 'api.projects' THEN host := 'project';
  ELSIF kind.identity_table = 'api.instruments' THEN host := 'instrument';
  END IF;
END $$;
--> statement-breakpoint
-- Every workspace record type below p_key, at any depth.
CREATE FUNCTION internal.model_descendants(p_workspace uuid, p_key text) RETURNS SETOF api.record_models
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
CREATE FUNCTION internal.latest_published_model_version(p_model_id uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT v.id FROM api.record_model_versions v
   WHERE v.model_id = p_model_id AND v.lifecycle = 'published'
   ORDER BY v.version DESC LIMIT 1
$$;
--> statement-breakpoint
-- The versions whose fields an object pinned to p_version carries: the pin
-- itself, then each workspace ancestor's latest published version.
CREATE FUNCTION internal.model_chain_versions(p_version uuid) RETURNS TABLE(version_id uuid, depth integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT v.id, 0 FROM api.record_model_versions v WHERE v.id = p_version
  UNION ALL
  SELECT internal.latest_published_model_version(parent.id), a.depth
    FROM api.record_model_versions v
    JOIN api.record_models m ON m.id = v.model_id
    CROSS JOIN LATERAL internal.model_ancestors(v.workspace_id, m.key) a
    JOIN api.record_models parent ON parent.workspace_id = v.workspace_id AND parent.key = a.key
   WHERE v.id = p_version AND NOT a.builtin
$$;
--> statement-breakpoint
-- The built-in model at the top of a pinned version's chain, if there is one.
CREATE FUNCTION internal.model_version_builtin_root(p_version uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT root.key FROM api.record_model_versions v
    JOIN api.record_models m ON m.id = v.model_id
    JOIN api.model_kinds root ON root.key = internal.model_root(v.workspace_id, m.key)
   WHERE v.id = p_version
$$;
--> statement-breakpoint
-- A pinned object's fields now span its whole chain. Each field is reported
-- under p_model (the object's record kind or host model) so callers keep
-- filtering by it.
CREATE OR REPLACE FUNCTION internal.record_model_fields(p_workspace uuid, p_model text, p_version uuid) RETURNS SETOF api.record_field_definitions
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT d.* FROM api.record_field_definitions d
    WHERE p_version IS NULL AND d.workspace_id=p_workspace AND d.kind=p_model
  UNION ALL
  SELECT (internal.canonical_model_field_value(jsonb_populate_record(NULL::api.record_field_definitions,
    f || jsonb_build_object('workspace_id',p_workspace,'kind',p_model,
      'validation',coalesce(f->'validation','{}'::jsonb),
      'cardinality',coalesce(f->>'cardinality','one'))))).*
  FROM internal.model_chain_versions(p_version) chain
  JOIN api.record_model_versions v ON v.id=chain.version_id
  CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
  WHERE p_version IS NOT NULL AND v.workspace_id=p_workspace
  UNION ALL
  SELECT (jsonb_populate_record(NULL::api.record_field_definitions,
    to_jsonb(d) || jsonb_build_object('kind',p_model))).*
  FROM api.record_field_definitions d
  WHERE p_version IS NOT NULL AND d.workspace_id=p_workspace
    AND d.kind=internal.model_version_builtin_root(p_version)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.record_model_options(p_version uuid, p_definition uuid) RETURNS SETOF api.model_field_options
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT o.* FROM api.model_field_options o WHERE o.definition_id=p_definition
  UNION ALL
  SELECT (jsonb_populate_record(NULL::api.model_field_options,
    o || jsonb_build_object('definition_id',p_definition,
      'display_order',coalesce(o->'display_order',o->'displayOrder','0'::jsonb)))).*
  FROM internal.model_chain_versions(p_version) chain
  JOIN api.record_model_versions v ON v.id=chain.version_id
  CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) o
  WHERE p_version IS NOT NULL AND (f->>'id')::uuid=p_definition
$$;
--> statement-breakpoint
-- Field keys used anywhere else in p_key's family: every ancestor (published
-- fields, or a built-in model's added fields and standard columns) and every
-- descendant's published fields. A new field on p_key must avoid all of them.
CREATE FUNCTION internal.model_family_field_keys(p_workspace uuid, p_key text) RETURNS SETOF text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT f->>'field_name'
    FROM internal.model_ancestors(p_workspace, p_key) a
    JOIN api.record_models m ON m.workspace_id = p_workspace AND m.key = a.key
    JOIN api.record_model_versions v ON v.id = internal.latest_published_model_version(m.id)
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
   WHERE NOT a.builtin
  UNION
  SELECT d.field_name FROM internal.model_ancestors(p_workspace, p_key) a
    JOIN api.record_field_definitions d ON d.workspace_id = p_workspace AND d.kind = a.key
   WHERE a.builtin
  UNION
  SELECT b.field_key FROM internal.model_ancestors(p_workspace, p_key) a
    JOIN api.model_base_fields b ON b.model_key = a.key
   WHERE a.builtin
  UNION
  SELECT f->>'field_name'
    FROM internal.model_descendants(p_workspace, p_key) m
    JOIN api.record_model_versions v ON v.model_id = m.id AND v.lifecycle IN ('draft','published')
    CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
$$;
--> statement-breakpoint
-- Keep the version guard's checks and add: a subtype's fields may not reuse a
-- key from anywhere else in its family.
CREATE OR REPLACE FUNCTION internal.guard_record_model_definition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE f jsonb; model api.record_models; seen_ids uuid[]:='{}'; seen_keys text[]:='{}'; field_id uuid; taken text;
BEGIN
  SELECT * INTO model FROM api.record_models WHERE id=NEW.model_id;
  IF model.workspace_id IS DISTINCT FROM NEW.workspace_id OR jsonb_typeof(NEW.definition->'fields') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid Record Model definition' USING ERRCODE='22023';
  END IF;
  IF NEW.definition ? 'migrationScope' AND NEW.definition->>'migrationScope' NOT IN ('new-records-only','also-migrate-open-experiments') THEN
    RAISE EXCEPTION 'invalid migration scope' USING ERRCODE='22023';
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(NEW.definition->'fields') LOOP
    PERFORM internal.canonical_model_field_value(jsonb_populate_record(NULL::api.record_field_definitions,
      f || jsonb_build_object('cardinality',coalesce(f->>'cardinality','one'))));
    field_id := (f->>'id')::uuid;
    IF (field_id IS NOT NULL AND f->>'field_name' ~ '^[a-z][a-z0-9_]{0,59}$'
      AND length(btrim(f->>'label')) BETWEEN 1 AND 200
      AND f->>'logical_type' IN ('text','integer','decimal','boolean','date','timestamp','category','reference')
      AND jsonb_typeof(f->'nullable')='boolean' AND f->>'lifecycle' IN ('active','retired')
      AND coalesce(f->>'cardinality','one')='one' AND jsonb_typeof(f->'validation')='object') IS NOT TRUE THEN
      RAISE EXCEPTION 'invalid Record Model field' USING ERRCODE='SB071';
    END IF;
    IF field_id=ANY(seen_ids) OR f->>'field_name'=ANY(seen_keys) THEN
      RAISE EXCEPTION 'duplicate Record Model field' USING ERRCODE='SB071';
    END IF;
    seen_ids:=seen_ids||field_id; seen_keys:=seen_keys||(f->>'field_name');
    IF EXISTS(SELECT 1 FROM api.record_field_definitions d WHERE d.id=field_id
      AND (d.workspace_id<>NEW.workspace_id OR d.kind<>model.key)) OR EXISTS(
      SELECT 1 FROM api.record_model_versions v CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') old_field
      WHERE v.model_id=NEW.model_id AND v.lifecycle='published' AND old_field->>'id'=f->>'id'
        AND old_field->>'field_name' IS DISTINCT FROM f->>'field_name') THEN
      RAISE EXCEPTION 'published field identity cannot change or be borrowed' USING ERRCODE='SB070';
    END IF;
    IF f->'quantity' IS NOT NULL AND f->'quantity'<>'null'::jsonb AND
      (f->>'logical_type' NOT IN ('integer','decimal') OR coalesce(f->'quantity'->>'kind','')='' OR
       coalesce(f->'quantity'->>'dimension','')='' OR coalesce(f->'quantity'->>'storageUnit','')='') THEN
      RAISE EXCEPTION 'quantity requires kind, dimension and storageUnit on a numeric field' USING ERRCODE='SB071';
    END IF;
  END LOOP;
  SELECT k INTO taken FROM internal.model_family_field_keys(NEW.workspace_id, model.key) k
   WHERE k = ANY(seen_keys) LIMIT 1;
  IF taken IS NOT NULL THEN
    RAISE EXCEPTION 'field % is already used by a related model', taken USING ERRCODE='SB082';
  END IF;
  RETURN NEW;
END $_$;
--> statement-breakpoint
-- A field added to a built-in model or record type may not take a key one of
-- its subtypes already uses.
CREATE FUNCTION internal.guard_field_key_in_family() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM internal.model_descendants(NEW.workspace_id, NEW.kind) m
      JOIN api.record_model_versions v ON v.model_id = m.id AND v.lifecycle IN ('draft','published')
      CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
     WHERE f->>'field_name' = NEW.field_name
  ) THEN
    RAISE EXCEPTION 'field % is already used by a subtype', NEW.field_name USING ERRCODE='SB082';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_field_key_in_family BEFORE INSERT OR UPDATE OF field_name ON api.record_field_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.guard_field_key_in_family();
--> statement-breakpoint
-- A record's kind is the record kind at the top of its type's chain, so a
-- subtype record is still listed, reviewed and signed as that kind.
CREATE OR REPLACE FUNCTION internal.guard_record_model_pin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE model api.record_models; version api.record_model_versions; old_fields jsonb; host record;
  changing boolean := coalesce(current_setting('sheetbase.record_type_change',true),'') = NEW.id::text
    OR coalesce(current_setting('sheetbase.record_model_upgrade',true),'') = NEW.id::text;
BEGIN
  IF NEW.model_version_id IS NULL THEN
    SELECT * INTO model FROM api.record_models WHERE workspace_id=NEW.workspace_id AND key=NEW.kind;
    IF model.id IS NULL THEN
      IF TG_OP='UPDATE' AND OLD.model_version_id IS NOT NULL AND NOT changing THEN
        RAISE EXCEPTION 'use api.set_model_type to change a record''s type' USING ERRCODE='42501';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP='INSERT' OR changing THEN
      NEW.model_version_id := internal.latest_published_model_version(model.id);
    END IF;
  END IF;
  SELECT * INTO version FROM api.record_model_versions WHERE id=NEW.model_version_id;
  SELECT * INTO model FROM api.record_models WHERE id=version.model_id;
  IF version.id IS NULL OR version.workspace_id<>NEW.workspace_id OR version.lifecycle<>'published' THEN
    RAISE EXCEPTION 'published Record Model version required' USING ERRCODE='SB108';
  END IF;
  host := internal.model_host(NEW.workspace_id, model.key);
  IF host.host IS DISTINCT FROM 'records' OR host.record_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION 'record type % does not belong to kind %', model.key, NEW.kind USING ERRCODE='SB070';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF (NEW.kind IS DISTINCT FROM OLD.kind AND coalesce(current_setting('sheetbase.record_model_reparent',true),'')='')
       OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Record Model identity is immutable' USING ERRCODE='SB070';
    END IF;
    IF NEW.model_version_id IS DISTINCT FROM OLD.model_version_id AND NOT changing
       AND coalesce(current_setting('sheetbase.record_model_reparent',true),'')='' THEN
      RAISE EXCEPTION 'use the explicit Record Model upgrade' USING ERRCODE='42501';
    END IF;
    IF OLD.locked_at IS NOT NULL AND (NEW.model_version_id IS DISTINCT FROM OLD.model_version_id OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields) THEN
      RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011';
    END IF;
    old_fields := OLD.custom_fields;
  ELSE old_fields := NULL;
  END IF;
  -- A pin-only adoption never injects defaults into historical values.
  IF TG_OP='INSERT' OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN
    NEW.custom_fields := internal.validate_versioned_model_fields(NEW.workspace_id,NEW.kind,NEW.custom_fields,old_fields,version.id);
  ELSE
    PERFORM internal.validate_versioned_model_fields(NEW.workspace_id,NEW.kind,NEW.custom_fields,old_fields,version.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Re-parenting moves records to a new kind; allow it only inside that RPC.
CREATE OR REPLACE FUNCTION internal.guard_record_kind() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."kind" IS DISTINCT FROM OLD."kind"
     AND coalesce(current_setting('sheetbase.record_model_reparent', true), '') = '' THEN
    RAISE EXCEPTION 'record kind is immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."model_kinds"
    WHERE "identity_table" = 'api.records' AND "record_kind" = NEW."kind"
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."record_models"
    WHERE "workspace_id" = NEW."workspace_id" AND "key" = NEW."kind"
  ) THEN
    RETURN NEW;
  END IF;
  -- Preserve the historical CHECK constraint SQLSTATE for an unsupported
  -- kind; callers and tests already branch on 23514.
  RAISE EXCEPTION 'unknown record kind: %', NEW."kind" USING ERRCODE='23514';
END $$;
--> statement-breakpoint
-- Projects and instruments pinned to a subtype validate against its chain.
CREATE FUNCTION internal.guard_host_model_pin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE model api.record_models; version api.record_model_versions; host record; old_fields jsonb;
  host_key text := CASE TG_TABLE_NAME WHEN 'projects' THEN 'project' ELSE 'instrument' END;
  changing boolean := coalesce(current_setting('sheetbase.record_type_change',true),'') = NEW.id::text;
BEGIN
  IF TG_OP='UPDATE' AND NEW.model_version_id IS DISTINCT FROM OLD.model_version_id AND NOT changing THEN
    RAISE EXCEPTION 'use api.set_model_type to change the type' USING ERRCODE='42501';
  END IF;
  IF NEW.model_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO version FROM api.record_model_versions WHERE id=NEW.model_version_id;
  SELECT * INTO model FROM api.record_models WHERE id=version.model_id;
  IF version.id IS NULL OR version.workspace_id<>NEW.workspace_id OR version.lifecycle<>'published' THEN
    RAISE EXCEPTION 'published Record Model version required' USING ERRCODE='SB108';
  END IF;
  host := internal.model_host(NEW.workspace_id, model.key);
  IF host.host IS DISTINCT FROM host_key THEN
    RAISE EXCEPTION 'type % does not belong to %', model.key, host_key USING ERRCODE='SB070';
  END IF;
  old_fields := CASE WHEN TG_OP='UPDATE' THEN OLD.custom_fields END;
  IF TG_OP='INSERT' OR NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN
    NEW.custom_fields := internal.validate_versioned_model_fields(NEW.workspace_id,host_key,NEW.custom_fields,old_fields,version.id);
  ELSE
    PERFORM internal.validate_versioned_model_fields(NEW.workspace_id,host_key,NEW.custom_fields,old_fields,version.id);
  END IF;
  IF TG_OP='INSERT' AND NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_model_identifier(model.id);
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_host_model_pin BEFORE INSERT OR UPDATE OF custom_fields, model_version_id, workspace_id ON api.projects
  FOR EACH ROW EXECUTE FUNCTION internal.guard_host_model_pin();
--> statement-breakpoint
CREATE TRIGGER a_host_model_pin BEFORE INSERT OR UPDATE OF custom_fields, model_version_id, workspace_id ON api.instruments
  FOR EACH ROW EXECUTE FUNCTION internal.guard_host_model_pin();
--> statement-breakpoint
-- A pinned project or instrument is validated by its pin guard; the built-in
-- check would refuse the subtype's own fields.
CREATE OR REPLACE FUNCTION internal.guard_model_custom_fields() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE model text; old_fields jsonb; evaluated jsonb; warning jsonb;
BEGIN
 IF TG_TABLE_NAME='records' THEN
   model:=internal.model_key_for('api.records',NEW.kind);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id AND NEW.kind IS NOT DISTINCT FROM OLD.kind THEN OLD.custom_fields ELSE '{}'::jsonb END;
 ELSE
   model:=internal.model_key_for('api.'||TG_TABLE_NAME,NULL);
   old_fields:=CASE WHEN TG_OP='UPDATE' AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id THEN OLD.custom_fields ELSE '{}'::jsonb END;
 END IF;
 IF model IS NULL THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='records' AND TG_OP='UPDATE' AND to_jsonb(NEW)->>'locked_at' IS NOT NULL AND NEW.custom_fields IS DISTINCT FROM OLD.custom_fields THEN RAISE EXCEPTION 'record is locked' USING ERRCODE='SB011'; END IF;
 IF (to_jsonb(NEW)->>'model_version_id') IS NULL THEN
 NEW.custom_fields:=internal.validate_model_fields(NEW.workspace_id,model,NEW.custom_fields,old_fields);
 END IF;
 evaluated:=internal.evaluate_model_rules(NEW.workspace_id,model,NEW.custom_fields);
 IF coalesce((evaluated->>'blocked')::boolean,false) THEN
   RAISE EXCEPTION '%', evaluated->'blocks'->0->>'message' USING ERRCODE='SB083';
 END IF;
 FOR warning IN SELECT value FROM jsonb_array_elements(evaluated->'warnings') LOOP
   RAISE WARNING 'model rule %: %', warning->>'ruleId', warning->>'message';
 END LOOP;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER model_custom_fields_pin BEFORE UPDATE OF model_version_id ON api.projects
  FOR EACH ROW EXECUTE FUNCTION internal.guard_model_custom_fields();
--> statement-breakpoint
CREATE TRIGGER model_custom_fields_pin BEFORE UPDATE OF model_version_id ON api.instruments
  FOR EACH ROW EXECUTE FUNCTION internal.guard_model_custom_fields();
--> statement-breakpoint
-- The next identifier in a record type's own sequence, for any caller that
-- already holds the right to create in the type's workspace.
CREATE FUNCTION internal.next_model_identifier(p_model_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_model api.record_models; v_number bigint;
BEGIN
  SELECT * INTO v_model FROM api.record_models WHERE id = p_model_id;
  IF v_model.id IS NULL THEN RAISE EXCEPTION 'model not found' USING ERRCODE = '42501'; END IF;
  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (v_model.workspace_id, 'model:' || lower(v_model.identifier_prefix), 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_model.identifier_prefix || '-' || lpad(v_number::text, 4, '0');
END $$;
--> statement-breakpoint
-- Prefixes the built-in models already use; a subtype must pick another.
CREATE FUNCTION internal.reserved_model_prefix(p_prefix text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT upper(p_prefix) IN ('EXP','SMP','MAT','PRT','PRJ','INS','DS','MDL','TPL','SHT','AN','CL','CAL','PL','RPT','FIL','STU','NTP')
$$;
--> statement-breakpoint
-- Create a subtype of any model that can have one. It starts as a draft
-- record type with no fields of its own; publishing it makes it pickable.
CREATE FUNCTION api.create_model_subtype(p_workspace_id uuid, p_parent_key text, p_key text, p_name text, p_identifier_prefix text, p_description text DEFAULT NULL::text) RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_model api.record_models;
BEGIN
  IF p_parent_key IS NULL OR (internal.model_host(p_workspace_id, p_parent_key)).host IS NULL THEN
    RAISE EXCEPTION 'model % cannot have subtypes', coalesce(p_parent_key, '') USING ERRCODE = 'SB071';
  END IF;
  IF internal.reserved_model_prefix(btrim(coalesce(p_identifier_prefix, ''))) THEN
    RAISE EXCEPTION 'identifier prefix is used by a built-in model' USING ERRCODE = 'SB082';
  END IF;
  v_model := api.create_workspace_model(p_workspace_id, p_key, p_name, p_identifier_prefix, p_description);
  UPDATE api.record_models SET parent_key = p_parent_key WHERE id = v_model.id
    RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_model_subtype(p_workspace_id uuid, p_parent_key text, p_key text, p_name text, p_identifier_prefix text, p_description text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_model_subtype(p_workspace_id uuid, p_parent_key text, p_key text, p_name text, p_identifier_prefix text, p_description text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_model_subtype(p_workspace_id uuid, p_parent_key text, p_key text, p_name text, p_identifier_prefix text, p_description text) TO authenticated;
--> statement-breakpoint
-- parent_key must name a model that can have subtypes and may never loop. It
-- is set once, while the type is still an unpublished draft; after that only
-- api.reparent_record_model may move it.
CREATE FUNCTION internal.guard_record_model_parent() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.parent_key IS NOT DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.parent_key END) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND coalesce(current_setting('sheetbase.record_model_reparent', true), '') <> NEW.id::text
     AND (OLD.parent_key IS NOT NULL OR EXISTS (SELECT 1 FROM api.record_model_versions v WHERE v.model_id = NEW.id AND v.lifecycle = 'published')) THEN
    RAISE EXCEPTION 'use api.reparent_record_model to move a record type' USING ERRCODE = '42501';
  END IF;
  IF NEW.parent_key IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM api.model_kinds WHERE key = NEW.parent_key) THEN
    IF NOT internal.extendable_builtin_model(NEW.parent_key) THEN
      RAISE EXCEPTION 'model % cannot have subtypes', NEW.parent_key USING ERRCODE = 'SB071';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_models WHERE workspace_id = NEW.workspace_id AND key = NEW.parent_key) THEN
    RAISE EXCEPTION 'parent model % not found', NEW.parent_key USING ERRCODE = 'SB071';
  END IF;
  IF NEW.parent_key = NEW.key OR EXISTS (
    SELECT 1 FROM internal.model_ancestors(NEW.workspace_id, NEW.parent_key) a WHERE a.key = NEW.key
  ) THEN
    RAISE EXCEPTION 'a model cannot sit under its own subtype' USING ERRCODE = 'SB071';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_record_model_parent BEFORE INSERT OR UPDATE OF parent_key ON api.record_models
  FOR EACH ROW EXECUTE FUNCTION internal.guard_record_model_parent();
--> statement-breakpoint
-- Change an object's type within its family, until it is signed. The object
-- gets the new type's own identifier, and p_custom_fields replaces its added
-- field values (the caller drops values the new type does not carry). A NULL
-- p_model_key returns it to the model at the top of the chain.
CREATE FUNCTION api.set_model_type(p_host text, p_id uuid, p_model_key text, p_custom_fields jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records; v_project api.projects; v_instrument api.instruments;
  v_workspace uuid; v_root text; v_target api.record_models; v_host record;
  v_version uuid; v_identifier text; v_from uuid; v_result jsonb;
BEGIN
  IF NOT api.has_write_actor() THEN RAISE EXCEPTION 'not found in active workspace' USING ERRCODE='42501'; END IF;
  IF p_host = 'records' THEN
    SELECT * INTO v_record FROM api.records WHERE id = p_id FOR UPDATE;
    IF v_record.id IS NULL OR v_record.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
      RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE='42501';
    END IF;
    PERFORM internal.assert_object_access('record', p_id, 'edit');
    IF v_record.locked_at IS NOT NULL THEN RAISE EXCEPTION 'a signed record keeps its type' USING ERRCODE='SB011'; END IF;
    IF v_record.archived_at IS NOT NULL OR v_record.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'record is not editable' USING ERRCODE='SB004'; END IF;
    v_workspace := v_record.workspace_id; v_root := internal.model_root(v_workspace, v_record.kind);
    v_from := v_record.model_version_id;
  ELSIF p_host = 'project' THEN
    SELECT * INTO v_project FROM api.projects WHERE id = p_id FOR UPDATE;
    IF v_project.id IS NULL OR v_project.workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR NOT internal.can_edit_project(p_id) THEN
      RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE='42501';
    END IF;
    v_workspace := v_project.workspace_id; v_root := 'project'; v_from := v_project.model_version_id;
  ELSIF p_host = 'instrument' THEN
    SELECT * INTO v_instrument FROM api.instruments WHERE id = p_id FOR UPDATE;
    IF v_instrument.id IS NULL OR v_instrument.workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR NOT api.is_workspace_writer(v_instrument.workspace_id) THEN
      RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE='42501';
    END IF;
    v_workspace := v_instrument.workspace_id; v_root := 'instrument'; v_from := v_instrument.model_version_id;
  ELSE
    RAISE EXCEPTION 'unknown host %', p_host USING ERRCODE='22023';
  END IF;

  IF p_model_key IS NULL OR p_model_key = v_root THEN
    SELECT * INTO v_target FROM api.record_models WHERE workspace_id = v_workspace AND key = v_root;
  ELSE
    SELECT * INTO v_target FROM api.record_models WHERE workspace_id = v_workspace AND key = p_model_key;
    IF v_target.id IS NULL THEN RAISE EXCEPTION 'type % not found', p_model_key USING ERRCODE='SB071'; END IF;
    v_host := internal.model_host(v_workspace, v_target.key);
    IF v_host.host IS DISTINCT FROM p_host OR (p_host = 'records' AND v_host.record_kind IS DISTINCT FROM v_record.kind) THEN
      RAISE EXCEPTION 'type % is not in this family', p_model_key USING ERRCODE='SB070';
    END IF;
  END IF;
  IF v_target.id IS NOT NULL THEN
    v_version := internal.latest_published_model_version(v_target.id);
    IF v_version IS NULL THEN RAISE EXCEPTION 'type % has no published version', v_target.key USING ERRCODE='SB108'; END IF;
    -- An upgrade within the same type is not a type change.
    IF EXISTS (SELECT 1 FROM api.record_model_versions f WHERE f.id = v_from AND f.model_id = v_target.id) THEN
      v_version := v_from;
    END IF;
    IF v_version IS DISTINCT FROM v_from THEN
      v_identifier := internal.next_model_identifier(v_target.id);
    END IF;
  END IF;

  PERFORM set_config('sheetbase.record_type_change', p_id::text, true);
  IF p_host = 'records' THEN
    IF v_identifier IS NULL AND v_version IS DISTINCT FROM v_from THEN
      v_identifier := api.next_record_identifier(v_workspace, v_record.kind);
    END IF;
    UPDATE api.records
       SET model_version_id = v_version,
           identifier = coalesce(v_identifier, identifier),
           custom_fields = coalesce(p_custom_fields, '{}'::jsonb),
           metadata_version = metadata_version + 1,
           updated_at = now(), updated_by_user_id = api.current_user_id()
     WHERE id = p_id RETURNING to_jsonb(api.records.*) INTO v_result;
  ELSIF p_host = 'project' THEN
    IF v_identifier IS NULL AND v_version IS DISTINCT FROM v_from THEN
      v_identifier := internal.next_display_id(v_workspace, 'project');
    END IF;
    UPDATE api.projects
       SET model_version_id = v_version,
           display_id = coalesce(v_identifier, display_id),
           custom_fields = coalesce(p_custom_fields, '{}'::jsonb)
     WHERE id = p_id RETURNING to_jsonb(api.projects.*) INTO v_result;
  ELSE
    IF v_identifier IS NULL AND v_version IS DISTINCT FROM v_from THEN
      v_identifier := 'INS-' || lpad((
        SELECT coalesce(max(substring(display_id FROM '^INS-([0-9]+)$')::integer), 0) + 1
          FROM api.instruments WHERE workspace_id = v_workspace)::text, 4, '0');
    END IF;
    UPDATE api.instruments
       SET model_version_id = v_version,
           display_id = coalesce(v_identifier, display_id),
           custom_fields = coalesce(p_custom_fields, '{}'::jsonb)
     WHERE id = p_id RETURNING to_jsonb(api.instruments.*) INTO v_result;
  END IF;
  PERFORM set_config('sheetbase.record_type_change', '', true);
  IF v_result IS NULL THEN RAISE EXCEPTION 'not found in active workspace' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_type(p_host text, p_id uuid, p_model_key text, p_custom_fields jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_type(p_host text, p_id uuid, p_model_key text, p_custom_fields jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_type(p_host text, p_id uuid, p_model_key text, p_custom_fields jsonb) TO authenticated;
--> statement-breakpoint
-- Move a record type (and everything below it) under a new parent, or make
-- it stand alone with a NULL parent. When the model at the top of the chain
-- changes, every record of the moved types becomes a record of the new kind
-- and is checked against its new chain; signed records cannot move.
CREATE FUNCTION api.reparent_record_model(p_model_id uuid, p_parent_key text) RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_model api.record_models; v_old_host record; v_new_host record; v_moved uuid[]; v_locked integer;
  v_row api.records;
BEGIN
  SELECT * INTO v_model FROM api.record_models WHERE id = p_model_id FOR UPDATE;
  IF v_model.id IS NULL THEN RAISE EXCEPTION 'model not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(v_model.workspace_id, 'schema.edit');
  IF v_model.parent_key IS NOT DISTINCT FROM p_parent_key THEN RETURN v_model; END IF;
  v_old_host := internal.model_host(v_model.workspace_id, v_model.key);
  IF p_parent_key IS NOT NULL THEN
    v_new_host := internal.model_host(v_model.workspace_id, p_parent_key);
    IF v_new_host.host IS NULL THEN
      RAISE EXCEPTION 'model % cannot have subtypes', p_parent_key USING ERRCODE = 'SB071';
    END IF;
  END IF;
  SELECT array_agg(id) INTO v_moved FROM (
    SELECT v_model.id AS id UNION ALL SELECT d.id FROM internal.model_descendants(v_model.workspace_id, v_model.key) d
  ) moved;

  PERFORM set_config('sheetbase.record_model_reparent', v_model.id::text, true);
  UPDATE api.record_models SET parent_key = p_parent_key, updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE id = v_model.id RETURNING * INTO v_model;
  v_new_host := internal.model_host(v_model.workspace_id, v_model.key);
  IF v_new_host.host IS DISTINCT FROM v_old_host.host THEN
    IF EXISTS (SELECT 1 FROM api.projects p JOIN api.record_model_versions v ON v.id = p.model_version_id WHERE v.model_id = ANY(v_moved))
       OR EXISTS (SELECT 1 FROM api.instruments i JOIN api.record_model_versions v ON v.id = i.model_version_id WHERE v.model_id = ANY(v_moved))
       OR EXISTS (SELECT 1 FROM api.records r JOIN api.record_model_versions v ON v.id = r.model_version_id WHERE v.model_id = ANY(v_moved)) THEN
      RAISE EXCEPTION 'a type with records can only move within records' USING ERRCODE = 'SB070';
    END IF;
  ELSIF v_new_host.host = 'records' AND v_new_host.record_kind IS DISTINCT FROM v_old_host.record_kind THEN
    SELECT count(*) INTO v_locked FROM api.records r JOIN api.record_model_versions v ON v.id = r.model_version_id
     WHERE v.model_id = ANY(v_moved) AND r.locked_at IS NOT NULL;
    IF v_locked > 0 THEN
      RAISE EXCEPTION '% signed records would change type', v_locked USING ERRCODE = 'SB011';
    END IF;
    FOR v_row IN SELECT r.* FROM api.records r JOIN api.record_model_versions v ON v.id = r.model_version_id
      WHERE v.model_id = ANY(v_moved) FOR UPDATE OF r LOOP
      BEGIN
        UPDATE api.records SET kind = v_new_host.record_kind,
               custom_fields = custom_fields || '{}'::jsonb,
               metadata_version = metadata_version + 1, updated_at = now()
         WHERE id = v_row.id;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '% can''t move: %', v_row.identifier, SQLERRM USING ERRCODE = 'SB071';
      END;
    END LOOP;
  ELSE
    -- Same kind: recheck every moved record against its new chain.
    FOR v_row IN SELECT r.* FROM api.records r JOIN api.record_model_versions v ON v.id = r.model_version_id
      WHERE v.model_id = ANY(v_moved) LOOP
      BEGIN
        PERFORM internal.validate_versioned_model_fields(v_row.workspace_id, v_row.kind, v_row.custom_fields, v_row.custom_fields, v_row.model_version_id);
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION '% can''t move: %', v_row.identifier, SQLERRM USING ERRCODE = 'SB071';
      END;
    END LOOP;
  END IF;
  -- Moved types must not share a field key with their new family.
  IF EXISTS (
    SELECT 1 FROM unnest(v_moved) moved_id
      JOIN api.record_models m ON m.id = moved_id
      JOIN api.record_model_versions v ON v.id = internal.latest_published_model_version(m.id)
      CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
     WHERE f->>'field_name' IN (
       SELECT k FROM internal.model_ancestors(m.workspace_id, m.key) a
         CROSS JOIN LATERAL (
           SELECT d.field_name AS k FROM api.record_field_definitions d WHERE a.builtin AND d.workspace_id = m.workspace_id AND d.kind = a.key
           UNION ALL
           SELECT af->>'field_name' FROM api.record_models am
             JOIN api.record_model_versions av ON av.id = internal.latest_published_model_version(am.id)
             CROSS JOIN LATERAL jsonb_array_elements(av.definition->'fields') af
            WHERE NOT a.builtin AND am.workspace_id = m.workspace_id AND am.key = a.key
         ) keys)
  ) THEN
    RAISE EXCEPTION 'a field key clashes with the new parent' USING ERRCODE = 'SB082';
  END IF;
  PERFORM set_config('sheetbase.record_model_reparent', '', true);
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.reparent_record_model(p_model_id uuid, p_parent_key text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reparent_record_model(p_model_id uuid, p_parent_key text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.reparent_record_model(p_model_id uuid, p_parent_key text) TO authenticated;
--> statement-breakpoint
-- Upgrades stay within one record type: the target version must belong to
-- the type the record is pinned to now, not to the record's kind.
CREATE OR REPLACE FUNCTION api.upgrade_record_model_record(p_record_id uuid, p_version_id uuid, p_expected_metadata_version bigint, p_reason text) RETURNS api.records
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record "api"."records";
  v_version "api"."record_model_versions";
  v_row "api"."records";
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id FOR UPDATE;
  IF v_record.id IS NULL OR v_record.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_record.workspace_id, 'schema.edit');
  IF p_expected_metadata_version IS NULL OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM v_record.workspace_id OR v_version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'published Record Model version not found' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_model_versions pinned
                  WHERE pinned.id = v_record.model_version_id AND pinned.model_id = v_version.model_id) THEN
    RAISE EXCEPTION 'version does not belong to the Record model' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'an upgrade reason is required' USING ERRCODE = '22023';
  END IF;
  IF v_record.model_version_id=v_version.id THEN RETURN v_record; END IF;
  IF EXISTS(SELECT 1 FROM api.record_model_versions old_version WHERE old_version.id=v_record.model_version_id AND old_version.version>=v_version.version) THEN
    RAISE EXCEPTION 'Record Model versions cannot move backwards' USING ERRCODE='SB071';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.record_model_versions old_version
    CROSS JOIN LATERAL jsonb_array_elements(old_version.definition->'fields') old_field
    LEFT JOIN LATERAL (SELECT f FROM jsonb_array_elements(v_version.definition->'fields') f
      WHERE f->>'id'=old_field->>'id') target ON true
    WHERE old_version.id=v_record.model_version_id AND v_record.custom_fields ? (old_field->>'field_name')
      AND (target.f IS NULL OR old_field->>'field_name' IS DISTINCT FROM target.f->>'field_name'
        OR old_field->>'logical_type' IS DISTINCT FROM target.f->>'logical_type'
        OR old_field->'quantity' IS DISTINCT FROM target.f->'quantity'
        OR old_field->'relationship' IS DISTINCT FROM target.f->'relationship'
        OR (old_field->>'logical_type'='category' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(old_field->'options','[]'::jsonb)) old_option
          WHERE old_option->>'key'=v_record.custom_fields->>(old_field->>'field_name')
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(target.f->'options','[]'::jsonb)) new_option
              WHERE new_option->>'key'=old_option->>'key'
                AND new_option->>'id' IS NOT DISTINCT FROM old_option->>'id'
                AND new_option->>'label' IS NOT DISTINCT FROM old_option->>'label'
            )
        )))
  ) THEN RAISE EXCEPTION 'upgrade changes stored field meaning; explicit value migration required' USING ERRCODE='SB071'; END IF;
  PERFORM set_config('sheetbase.record_model_upgrade',v_record.id::text,true);
  UPDATE api.records
     SET model_version_id = v_version.id, metadata_version = v_record.metadata_version + 1,
         updated_at = now(), updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_row;
  PERFORM set_config('sheetbase.record_model_upgrade','',true);
  INSERT INTO api.record_model_version_upgrades(workspace_id, record_id, from_version_id, to_version_id, reason, upgraded_by_user_id)
  VALUES (v_record.workspace_id, v_record.id, v_record.model_version_id, v_version.id, btrim(p_reason), api.current_user_id());
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update', v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'model_version_upgrade', 'modelVersionId', v_version.id, 'reason', btrim(p_reason)));
  RETURN v_row;
END $$;
