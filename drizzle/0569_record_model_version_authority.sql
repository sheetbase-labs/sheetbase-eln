-- Draft definitions are private proposals. Only publication projects them into
-- the current-field registry; records continue to validate against their pin.
-- Lifecycle and revision changes must use the approval-aware RPCs, not direct
-- inserts/updates that could fabricate a published definition.
REVOKE INSERT, UPDATE ON api.record_model_versions FROM authenticated;
--> statement-breakpoint

-- Share the established scalar/quantity/reference canonicaliser between live
-- definitions and immutable snapshot projections, including conflict checks.
DO $$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('internal.canonicalize_model_field_definition()'::regprocedure);
  source := replace(source, 'canonicalize_model_field_definition()', 'canonical_model_field_value(p_field api.record_field_definitions)');
  source := replace(source, 'RETURNS trigger', 'RETURNS api.record_field_definitions');
  source := replace(source, 'NEW', 'p_field');
  EXECUTE source;
END $$;
REVOKE ALL ON FUNCTION internal.canonical_model_field_value(api.record_field_definitions) FROM PUBLIC;
CREATE OR REPLACE FUNCTION internal.canonicalize_model_field_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  NEW := internal.canonical_model_field_value(NEW);
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE FUNCTION internal.guard_record_model_definition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f jsonb; model api.record_models; seen_ids uuid[]:='{}'; seen_keys text[]:='{}'; field_id uuid;
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
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION internal.guard_record_model_definition() FROM PUBLIC;
CREATE TRIGGER z_record_model_definition BEFORE INSERT OR UPDATE OF definition ON api.record_model_versions
FOR EACH ROW EXECUTE FUNCTION internal.guard_record_model_definition();
--> statement-breakpoint

DO $$
DECLARE draft_sql text; publish_sql text; projection text; start_at integer; end_at integer;
BEGIN
  draft_sql := pg_get_functiondef('api.replace_record_model_version_definition(uuid,bigint,jsonb,text)'::regprocedure);
  start_at := strpos(draft_sql, '  SELECT * INTO v_model FROM api.record_models WHERE id = v_version.model_id;');
  end_at := strpos(draft_sql, '  UPDATE api.record_model_versions');
  IF start_at = 0 OR end_at <= start_at THEN RAISE EXCEPTION 'Record Model projection source changed'; END IF;
  projection := substr(draft_sql, start_at, end_at - start_at);
  draft_sql := overlay(draft_sql placing '' from start_at for end_at - start_at);
  EXECUTE draft_sql;
  projection := replace(projection,
    'WHERE id = v_version.model_id;',
    'WHERE id = v_version.model_id FOR UPDATE;
  IF v_model.lifecycle=''published'' AND v_version.version<=v_model.current_version THEN
    RAISE EXCEPTION ''a newer Record Model version is already published'' USING ERRCODE=''SB072'';
  END IF;
  -- Serialize the short publication projection, including direct field writes.
  -- Ownership can have changed since this proposal was saved.
  LOCK TABLE api.record_field_definitions IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_definition->''fields'') f
    JOIN api.record_field_definitions d ON d.id=(f->>''id'')::uuid
    WHERE d.workspace_id<>v_model.workspace_id OR d.kind<>v_model.key) THEN
    RAISE EXCEPTION ''field identity belongs to another model'' USING ERRCODE=''SB070'';
  END IF;');

  publish_sql := pg_get_functiondef('api.publish_record_model_version(uuid)'::regprocedure);
  publish_sql := replace(publish_sql, '  v_block text;', '  v_block text;
  v_model api.record_models;
  v_field jsonb;
  v_present uuid[] := ''{}'';
  p_definition jsonb;');
  publish_sql := replace(publish_sql, '  UPDATE api.record_model_versions',
    '  p_definition := v_version.definition;
' || projection || '  UPDATE api.record_model_versions');
  -- The saved migration choice is carried out only after approval and
  -- publication, atomically: an incompatible record rolls publication back.
  publish_sql := replace(publish_sql, '  RETURN v_version;',
    '  IF v_version.definition->>''migrationScope'' = ''also-migrate-open-experiments'' THEN
    PERFORM api.migrate_open_experiments_to_model_version(v_version.model_id, v_version.id, v_version.reason);
  END IF;
  RETURN v_version;');
  EXECUTE publish_sql;
END $$;
--> statement-breakpoint

-- Preserve canonical field identities in the live registry, but never use its
-- mutable semantics for an already-versioned record. jsonb_populate_record
-- keeps the existing field validator and its scalar/type constraints shared.
CREATE FUNCTION internal.record_model_fields(p_workspace uuid, p_model text, p_version uuid)
RETURNS SETOF api.record_field_definitions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT d.* FROM api.record_field_definitions d
    WHERE p_version IS NULL AND d.workspace_id=p_workspace AND d.kind=p_model
  UNION ALL
  SELECT (internal.canonical_model_field_value(jsonb_populate_record(NULL::api.record_field_definitions,
    f || jsonb_build_object('workspace_id',p_workspace,'kind',p_model,
      'validation',coalesce(f->'validation','{}'::jsonb),
      'cardinality',coalesce(f->>'cardinality','one'))))).*
  FROM api.record_model_versions v
  JOIN api.record_models m ON m.id=v.model_id
  CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
  WHERE v.id=p_version AND v.workspace_id=p_workspace AND m.key=p_model
$$;
REVOKE ALL ON FUNCTION internal.record_model_fields(uuid,text,uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.record_model_options(p_version uuid, p_definition uuid)
RETURNS SETOF api.model_field_options
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT o.* FROM api.model_field_options o WHERE p_version IS NULL AND o.definition_id=p_definition
  UNION ALL
  SELECT (jsonb_populate_record(NULL::api.model_field_options,
    o || jsonb_build_object('definition_id',p_definition,
      'display_order',coalesce(o->'display_order',o->'displayOrder','0'::jsonb)))).*
  FROM api.record_model_versions v
  CROSS JOIN LATERAL jsonb_array_elements(v.definition->'fields') f
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) o
  WHERE v.id=p_version AND (f->>'id')::uuid=p_definition
$$;
REVOKE ALL ON FUNCTION internal.record_model_options(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.model_key_for(p_table text,p_kind text DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT key FROM api.model_kinds WHERE identity_table=p_table AND (record_kind=p_kind OR record_kind IS NULL AND p_kind IS NULL)
  UNION ALL
  SELECT key FROM api.record_models WHERE p_table='api.records' AND key=p_kind AND workspace_id=api.current_workspace_id()
  LIMIT 1
$$;
--> statement-breakpoint

DO $$
BEGIN
  EXECUTE replace(pg_get_functiondef('internal.model_field_manifest(uuid)'::regprocedure),
    'model_field_manifest(', 'unversioned_model_field_manifest(');
END $$;
CREATE OR REPLACE FUNCTION internal.model_field_manifest(p_record_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE pin uuid; result jsonb;
BEGIN
  SELECT model_version_id INTO pin FROM api.records WHERE id=p_record_id;
  IF pin IS NULL THEN RETURN internal.unversioned_model_field_manifest(p_record_id); END IF;
  SELECT jsonb_build_object('modelVersionId',v.id,'version',v.version,'definitions',coalesce(jsonb_agg(
    jsonb_build_object('id',f->'id','modelKey',m.key,'fieldName',f->'field_name','label',f->'label',
      'logicalType',f->'logical_type','nullable',f->'nullable','defaultValue',f->'default_value',
      'unit',f->'unit','quantity',f->'quantity','cardinality',f->'cardinality',
      'categorySource',f->'category_source','relationship',f->'relationship','validation',f->'validation',
      'lifecycle',f->'lifecycle','options',coalesce(f->'options','[]'::jsonb))
    ORDER BY (f->>'display_order')::integer,f->>'field_name') FILTER(WHERE f IS NOT NULL),'[]'::jsonb))
  INTO result FROM api.record_model_versions v JOIN api.record_models m ON m.id=v.model_id
    LEFT JOIN LATERAL jsonb_array_elements(v.definition->'fields') f ON true
    WHERE v.id=pin GROUP BY v.id,m.key;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION internal.unversioned_model_field_manifest(uuid) FROM PUBLIC;
--> statement-breakpoint

DO $$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('internal.validate_model_fields(uuid,text,jsonb,jsonb)'::regprocedure);
  source := replace(source, 'validate_model_fields(', 'validate_versioned_model_fields(');
  source := replace(source, 'p_old jsonb DEFAULT ''{}''::jsonb)', 'p_old jsonb, p_version uuid)');
  IF strpos(source, 'p_version uuid)')=0 THEN RAISE EXCEPTION 'Record field validator signature changed'; END IF;
  source := replace(source, 'FROM api.record_field_definitions', 'FROM internal.record_model_fields(p_workspace,p_model,p_version)');
  source := replace(source, 'FROM api.model_field_options o', 'FROM internal.record_model_options(p_version,d.id) o');
  -- NULL old state is the creation-only signal. Existing records and pin-only
  -- adoption must satisfy requiredness using actual values, never defaults.
  source := replace(source, 'IF NOT out ? d.field_name AND d.default_value IS NOT NULL',
    'IF p_old IS NULL AND NOT out ? d.field_name AND d.default_value IS NOT NULL');
  -- A reference can target either a built-in kind or another workspace model.
  source := replace(source, 'JOIN api.model_kinds m ON m.record_kind=r.kind',
    'JOIN (SELECT key,record_kind FROM api.model_kinds UNION ALL SELECT key,key FROM api.record_models WHERE workspace_id=p_workspace) m ON m.record_kind=r.kind');
  EXECUTE source;
END $$;
REVOKE ALL ON FUNCTION internal.validate_versioned_model_fields(uuid,text,jsonb,jsonb,uuid) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

-- Validate pins on every write path, including direct PostgREST inserts and
-- explicit upgrades. A version cannot be borrowed from another model/workspace.
CREATE FUNCTION internal.guard_record_model_pin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE model api.record_models; version api.record_model_versions; old_fields jsonb;
BEGIN
  SELECT * INTO model FROM api.record_models WHERE workspace_id=NEW.workspace_id AND key=NEW.kind;
  IF model.id IS NULL THEN
    IF NEW.model_version_id IS NOT NULL THEN RAISE EXCEPTION 'unexpected Record Model pin' USING ERRCODE='22023'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='INSERT' AND NEW.model_version_id IS NULL THEN
    SELECT v.id INTO NEW.model_version_id FROM api.record_model_versions v
      WHERE v.model_id=model.id AND v.lifecycle='published' ORDER BY v.version DESC LIMIT 1;
  END IF;
  SELECT * INTO version FROM api.record_model_versions WHERE id=NEW.model_version_id;
  IF version.id IS NULL OR version.model_id<>model.id OR version.workspace_id<>NEW.workspace_id OR version.lifecycle<>'published' THEN
    RAISE EXCEPTION 'published Record Model version required' USING ERRCODE='SB108';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
      RAISE EXCEPTION 'Record Model identity is immutable' USING ERRCODE='SB070';
    END IF;
    IF NEW.model_version_id IS DISTINCT FROM OLD.model_version_id
       AND coalesce(current_setting('sheetbase.record_model_upgrade',true),'')<>NEW.id::text THEN
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
REVOKE ALL ON FUNCTION internal.guard_record_model_pin() FROM PUBLIC;
CREATE TRIGGER a_record_model_pin BEFORE INSERT OR UPDATE OF custom_fields,model_version_id,kind,workspace_id ON api.records
FOR EACH ROW EXECUTE FUNCTION internal.guard_record_model_pin();
--> statement-breakpoint

-- The existing shared trigger still enforces model rules; only its field
-- validation changes source for records with a canonical version pin.
DO $$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('internal.guard_model_custom_fields()'::regprocedure);
  source := replace(source,
    ' NEW.custom_fields:=internal.validate_model_fields(NEW.workspace_id,model,NEW.custom_fields,old_fields);',
    ' IF TG_TABLE_NAME<>''records'' OR (to_jsonb(NEW)->>''model_version_id'') IS NULL THEN
 NEW.custom_fields:=internal.validate_model_fields(NEW.workspace_id,model,NEW.custom_fields,old_fields);
 END IF;');
  EXECUTE source;
END $$;
--> statement-breakpoint

DO $$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('api.create_record_model_version(uuid,text)'::regprocedure);
  source := replace(source, 'coalesce(v_latest.definition, ''{"fields":[]}''::jsonb)',
    '(coalesce(v_latest.definition, ''{"fields":[]}''::jsonb) - ''migrationScope'')');
  EXECUTE source;

  source := pg_get_functiondef('api.upgrade_record_model_record(uuid,uuid,bigint,text)'::regprocedure);
  source := replace(source, '  UPDATE api.records',
    '  IF v_record.model_version_id=v_version.id THEN RETURN v_record; END IF;
  IF EXISTS(SELECT 1 FROM api.record_model_versions old_version WHERE old_version.id=v_record.model_version_id AND old_version.version>=v_version.version) THEN
    RAISE EXCEPTION ''Record Model versions cannot move backwards'' USING ERRCODE=''SB071'';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.record_model_versions old_version
    CROSS JOIN LATERAL jsonb_array_elements(old_version.definition->''fields'') old_field
    LEFT JOIN LATERAL (SELECT f FROM jsonb_array_elements(v_version.definition->''fields'') f
      WHERE f->>''id''=old_field->>''id'') target ON true
    WHERE old_version.id=v_record.model_version_id AND v_record.custom_fields ? (old_field->>''field_name'')
      AND (target.f IS NULL OR old_field->>''field_name'' IS DISTINCT FROM target.f->>''field_name''
        OR old_field->>''logical_type'' IS DISTINCT FROM target.f->>''logical_type''
        OR old_field->''quantity'' IS DISTINCT FROM target.f->''quantity''
        OR old_field->''relationship'' IS DISTINCT FROM target.f->''relationship''
        OR (old_field->>''logical_type''=''category'' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(coalesce(old_field->''options'',''[]''::jsonb)) old_option
          WHERE old_option->>''key''=v_record.custom_fields->>(old_field->>''field_name'')
            AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(target.f->''options'',''[]''::jsonb)) new_option
              WHERE new_option->>''key''=old_option->>''key''
                AND new_option->>''id'' IS NOT DISTINCT FROM old_option->>''id''
                AND new_option->>''label'' IS NOT DISTINCT FROM old_option->>''label''
            )
        )))
  ) THEN RAISE EXCEPTION ''upgrade changes stored field meaning; explicit value migration required'' USING ERRCODE=''SB071''; END IF;
  PERFORM set_config(''sheetbase.record_model_upgrade'',v_record.id::text,true);
  UPDATE api.records');
  source := replace(source, '  INSERT INTO api.record_model_version_upgrades',
    '  PERFORM set_config(''sheetbase.record_model_upgrade'','''',true);
  INSERT INTO api.record_model_version_upgrades');
  EXECUTE source;
END $$;
--> statement-breakpoint

-- Count exactly the records the publication migration can touch, not all
-- historical usage. Kept alongside the existing usage columns for clients.
DROP FUNCTION api.record_model_version_usage(uuid);
CREATE FUNCTION api.record_model_version_usage(p_model_id uuid)
RETURNS TABLE(version_id uuid,record_count integer,created_record_count integer,upgraded_record_count integer,migratable_record_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT v.id, count(r.id)::int,
    count(r.id) FILTER (WHERE NOT EXISTS(SELECT 1 FROM api.record_model_version_upgrades u WHERE u.record_id=r.id AND u.to_version_id=v.id))::int,
    count(r.id) FILTER (WHERE EXISTS(SELECT 1 FROM api.record_model_version_upgrades u WHERE u.record_id=r.id AND u.to_version_id=v.id))::int,
    count(r.id) FILTER (WHERE r.archived_at IS NULL AND r.deleted_at IS NULL AND r.locked_at IS NULL
      AND r.status IN ('draft','planned','in_progress','on_hold','in_review'))::int
  FROM api.record_model_versions v LEFT JOIN api.records r ON r.model_version_id=v.id
  WHERE v.model_id=p_model_id AND v.workspace_id=api.current_workspace_id() AND api.is_workspace_member(v.workspace_id)
  GROUP BY v.id ORDER BY v.version DESC
$$;
REVOKE ALL ON FUNCTION api.record_model_version_usage(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION api.record_model_version_usage(uuid) TO authenticated;
--> statement-breakpoint

DO $$
DECLARE source text;
BEGIN
  source := pg_get_functiondef('api.migrate_open_experiments_to_model_version(uuid,uuid,text)'::regprocedure);
  source := replace(source, 'AND r.deleted_at IS NULL', 'AND r.deleted_at IS NULL AND r.locked_at IS NULL');
  EXECUTE source;
END $$;
NOTIFY pgrst, 'reload schema';
