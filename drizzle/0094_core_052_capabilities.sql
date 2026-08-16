-- CORE-05.2 / 05.3: capability vocabulary, steward role, and server enforcement.
-- Capabilities are resolved from workspace membership. They are not JWT claims.
-- Roles assign capabilities; later grants should change this resolver only.

ALTER TABLE api.workspace_memberships DROP CONSTRAINT chk_workspace_memberships_role;
ALTER TABLE api.workspace_memberships ADD CONSTRAINT chk_workspace_memberships_role
  CHECK (role IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer'));
DO $role_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_workspace_invitations_role'
       AND conrelid = 'api.workspace_invitations'::regclass
  ) THEN
    ALTER TABLE api.workspace_invitations DROP CONSTRAINT chk_workspace_invitations_role;
  ELSIF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'workspace_invitations_role_check'
       AND conrelid = 'api.workspace_invitations'::regclass
  ) THEN
    ALTER TABLE api.workspace_invitations DROP CONSTRAINT workspace_invitations_role_check;
  END IF;
END
$role_check$;
ALTER TABLE api.workspace_invitations ADD CONSTRAINT chk_workspace_invitations_role
  CHECK (role IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer'));

CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_user_id() IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$$;
REVOKE EXECUTE ON FUNCTION api.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION api.require_capability(p_workspace_id uuid, p_capability text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT api.has_capability(p_workspace_id, p_capability) THEN
    RAISE EXCEPTION 'capability required: %', p_capability USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION api.require_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.require_capability(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION api.list_capabilities(p_workspace_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(capability ORDER BY capability), '{}'::text[])
    FROM unnest(ARRAY[
      'workspace.admin',
      'schema.edit',
      'schema.publish',
      'schema.retire',
      'record.link',
      'record.create',
      'instance.upgrade'
    ]) AS capability
   WHERE api.has_capability(p_workspace_id, capability)
$$;
REVOKE EXECUTE ON FUNCTION api.list_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.list_capabilities(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION api.assert_record_batch_capabilities(p_workspace_id uuid, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  has_create boolean := false;
  has_link boolean := false;
BEGIN
  IF jsonb_typeof(p_rows) = 'array' THEN
    SELECT
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) row_item WHERE row_item->>'operation' = 'create'),
      EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) row_item WHERE row_item->>'operation' = 'link')
      INTO has_create, has_link;
  END IF;
  IF has_create THEN
    PERFORM api.require_capability(p_workspace_id, 'record.create');
  END IF;
  IF has_link THEN
    PERFORM api.require_capability(p_workspace_id, 'record.link');
  END IF;
  IF NOT has_create AND NOT has_link THEN
    IF NOT api.has_capability(p_workspace_id, 'record.link')
       AND NOT api.has_capability(p_workspace_id, 'record.create') THEN
      RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION api.assert_record_batch_capabilities(uuid, jsonb) FROM PUBLIC;

-- Compatibility wrappers. Do not add new is_x_admin helpers.
CREATE OR REPLACE FUNCTION api.has_schema_capability(p_workspace uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE p_capability
    WHEN 'model_field.manage' THEN api.has_capability(p_workspace, 'schema.edit')
    WHEN 'dataset_schema.publish' THEN api.has_capability(p_workspace, 'schema.publish')
    WHEN 'dataset_schema.retire' THEN api.has_capability(p_workspace, 'schema.retire')
    WHEN 'schema_relationship.retire' THEN api.has_capability(p_workspace, 'schema.retire')
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION api.is_model_field_admin(p_workspace uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT api.has_capability(p_workspace, 'schema.edit')
$$;

CREATE OR REPLACE FUNCTION api.is_sheet_definition_admin(p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT api.has_capability(p_workspace_id, 'schema.edit')
$$;

CREATE OR REPLACE FUNCTION api.create_invitation(
  p_workspace_id uuid, p_email text, p_role text DEFAULT 'member', p_expires_after_days integer DEFAULT 7
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations; v_token text:=gen_random_uuid()::text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061';
  END IF;
  IF p_email IS NULL OR btrim(p_email) !~ '^[^@]+@[^@]+\.[^@]+$'
     OR p_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer')
     OR p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN
    RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061';
  END IF;
  INSERT INTO api.workspace_invitations(workspace_id,email,role,token_hash,expires_at,created_by_user_id)
  VALUES(
    p_workspace_id,
    lower(btrim(p_email)),
    p_role,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),
    now()+make_interval(days=>p_expires_after_days),
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;

CREATE OR REPLACE FUNCTION api.change_member_role(p_workspace_id uuid, p_user_id text, p_new_role text)
RETURNS api.workspace_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.has_capability(p_workspace_id, 'workspace.admin')
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052';
  END IF;
  IF p_new_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE='SB053';
  END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot change own role' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND p_new_role<>'owner'
     AND (SELECT count(*) FROM api.workspace_memberships
           WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN
    RAISE EXCEPTION 'cannot demote last owner' USING ERRCODE='SB051';
  END IF;
  UPDATE api.workspace_memberships SET role=p_new_role,updated_at=now() WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;

DROP POLICY dataset_schema_definitions_write ON api.dataset_schema_definitions;
DROP POLICY dataset_schema_versions_write ON api.dataset_schema_versions;
DROP POLICY dataset_schema_version_fields_write ON api.dataset_schema_version_fields;
CREATE POLICY dataset_schema_definitions_write ON api.dataset_schema_definitions
  FOR ALL TO authenticated
  USING (api.has_capability(workspace_id, 'schema.edit') OR api.has_capability(workspace_id, 'schema.publish'))
  WITH CHECK (api.has_capability(workspace_id, 'schema.edit') OR api.has_capability(workspace_id, 'schema.publish'));
CREATE POLICY dataset_schema_versions_write ON api.dataset_schema_versions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions s
     WHERE s.id=schema_id
       AND (api.has_capability(s.workspace_id, 'schema.edit') OR api.has_capability(s.workspace_id, 'schema.publish'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions s
     WHERE s.id=schema_id
       AND (api.has_capability(s.workspace_id, 'schema.edit') OR api.has_capability(s.workspace_id, 'schema.publish'))
  ));
CREATE POLICY dataset_schema_version_fields_write ON api.dataset_schema_version_fields
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id=v.schema_id
     WHERE v.id=schema_version_id
       AND (api.has_capability(s.workspace_id, 'schema.edit') OR api.has_capability(s.workspace_id, 'schema.publish'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id=v.schema_id
     WHERE v.id=schema_version_id
       AND (api.has_capability(s.workspace_id, 'schema.edit') OR api.has_capability(s.workspace_id, 'schema.publish'))
  ));

CREATE OR REPLACE FUNCTION internal.replace_dataset_schema_version_fields(
  p_schema_version_id uuid,
  p_fields jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item jsonb;
  ordinal integer := 0;
  field_key text;
  field_label text;
  logical_type text;
  field_id uuid;
  display_order integer;
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Dataset Schema fields must be an array' USING ERRCODE = '22023';
  END IF;
  DELETE FROM api.dataset_schema_version_fields WHERE schema_version_id = p_schema_version_id;
  FOR item IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    ordinal := ordinal + 1;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid Dataset Schema field' USING ERRCODE = '22023';
    END IF;
    field_key := coalesce(item->>'key', item->>'field_key');
    field_label := coalesce(item->>'label', item->>'name');
    logical_type := coalesce(item->>'logical_type', item->>'logicalType');
    IF field_key IS NULL OR field_key !~ '^[a-z][a-z0-9_]{0,59}$'
       OR field_label IS NULL OR length(btrim(field_label)) NOT BETWEEN 1 AND 200
       OR logical_type IS NULL THEN
      RAISE EXCEPTION 'invalid Dataset Schema field metadata' USING ERRCODE = 'SB071';
    END IF;
    BEGIN
      field_id := coalesce(nullif(item->>'field_id','')::uuid, nullif(item->>'fieldId','')::uuid, gen_random_uuid());
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'invalid Dataset Schema field id' USING ERRCODE = '22023';
    END;
    display_order := coalesce((item->>'display_order')::integer, (item->>'displayOrder')::integer, ordinal);
    INSERT INTO api.dataset_schema_version_fields(
      schema_version_id, field_id, key, label, description, logical_type, nullable,
      default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
    ) VALUES (
      p_schema_version_id,
      field_id,
      field_key,
      btrim(field_label),
      nullif(btrim(coalesce(item->>'description','')), ''),
      logical_type,
      coalesce((item->>'nullable')::boolean, true),
      CASE WHEN item ? 'default_value' THEN item->'default_value'
           WHEN item ? 'defaultValue' THEN item->'defaultValue'
           ELSE NULL END,
      CASE WHEN item ? 'quantity' THEN item->'quantity' ELSE NULL END,
      coalesce(item->'validation', '{}'::jsonb),
      CASE WHEN item ? 'category' THEN item->'category' ELSE NULL END,
      CASE WHEN item ? 'relationship' THEN item->'relationship' ELSE NULL END,
      coalesce(item->>'cardinality', 'one'),
      coalesce(item->>'lifecycle', 'active'),
      display_order
    );
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.replace_dataset_schema_version_fields(uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;

CREATE OR REPLACE FUNCTION api.create_dataset_schema_definition(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_description text DEFAULT NULL,
  p_fields jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor text := api.current_user_id();
  definition api.dataset_schema_definitions;
  version api.dataset_schema_versions;
BEGIN
  PERFORM api.require_capability(p_workspace_id, 'schema.edit');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$'
     OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200
     OR length(coalesce(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'invalid Dataset Schema Definition metadata' USING ERRCODE = 'SB071';
  END IF;
  INSERT INTO api.dataset_schema_definitions(
    workspace_id, key, name, description, lifecycle, created_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name), nullif(btrim(p_description), ''), 'draft', actor
  ) RETURNING * INTO definition;
  INSERT INTO api.dataset_schema_versions(schema_id, version, lifecycle, created_by_user_id)
  VALUES (definition.id, 1, 'draft', actor)
  RETURNING * INTO version;
  PERFORM internal.replace_dataset_schema_version_fields(version.id, coalesce(p_fields, '[]'::jsonb));
  RETURN jsonb_build_object(
    'schema_definition_id', definition.id,
    'schema_version_id', version.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.replace_dataset_schema_version_fields(
  p_schema_version_id uuid,
  p_fields jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  SELECT s.workspace_id INTO workspace
    FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace, 'schema.edit');
  IF version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  PERFORM internal.replace_dataset_schema_version_fields(version.id, p_fields);
END;
$$;

CREATE OR REPLACE FUNCTION api.publish_dataset_schema_version(p_schema_version_id uuid)
RETURNS api.dataset_schema_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  SELECT s.workspace_id INTO workspace
    FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace, 'schema.publish');
  IF version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be published' USING ERRCODE = 'SB072';
  END IF;
  UPDATE api.dataset_schema_versions
     SET lifecycle = 'active', published_at = now(), updated_at = now()
   WHERE id = version.id
  RETURNING * INTO version;
  UPDATE api.dataset_schema_definitions
     SET lifecycle = 'active', updated_at = now()
   WHERE id = version.schema_id AND lifecycle = 'draft';
  RETURN version;
END;
$$;

CREATE OR REPLACE FUNCTION api.create_next_dataset_schema_version(p_schema_definition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  definition api.dataset_schema_definitions;
  existing api.dataset_schema_versions;
  source api.dataset_schema_versions;
  created api.dataset_schema_versions;
  actor text := api.current_user_id();
  next_version integer;
BEGIN
  SELECT * INTO definition FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id FOR UPDATE;
  IF definition.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Definition not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(definition.workspace_id, 'schema.edit');
  IF definition.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'retired Dataset Schema Definitions cannot be versioned' USING ERRCODE = 'SB072';
  END IF;
  SELECT * INTO existing
    FROM api.dataset_schema_versions
   WHERE schema_id = definition.id AND lifecycle = 'draft'
   ORDER BY version DESC
   LIMIT 1;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('schema_version_id', existing.id, 'version', existing.version);
  END IF;
  SELECT * INTO source
    FROM api.dataset_schema_versions
   WHERE schema_id = definition.id
   ORDER BY version DESC
   LIMIT 1;
  next_version := coalesce(source.version, 0) + 1;
  INSERT INTO api.dataset_schema_versions(schema_id, version, lifecycle, created_by_user_id)
  VALUES (definition.id, next_version, 'draft', actor)
  RETURNING * INTO created;
  IF source.id IS NOT NULL THEN
    INSERT INTO api.dataset_schema_version_fields(
      schema_version_id, field_id, key, label, description, logical_type, nullable,
      default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
    )
    SELECT created.id, field_id, key, label, description, logical_type, nullable,
           default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
      FROM api.dataset_schema_version_fields
     WHERE schema_version_id = source.id;
  END IF;
  RETURN jsonb_build_object('schema_version_id', created.id, 'version', created.version);
END;
$$;

CREATE OR REPLACE FUNCTION api.retire_dataset_schema_definition(p_schema_definition_id uuid)
RETURNS api.dataset_schema_definitions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  definition api.dataset_schema_definitions;
BEGIN
  SELECT * INTO definition FROM api.dataset_schema_definitions WHERE id = p_schema_definition_id FOR UPDATE;
  IF definition.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Definition not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(definition.workspace_id, 'schema.retire');
  IF definition.lifecycle = 'retired' THEN
    RAISE EXCEPTION 'Dataset Schema Definition is already retired' USING ERRCODE = 'SB072';
  END IF;
  UPDATE api.dataset_schema_definitions
     SET lifecycle = 'retired', updated_at = now()
   WHERE id = definition.id
  RETURNING * INTO definition;
  RETURN definition;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  api.create_dataset_schema_definition(uuid, text, text, text, jsonb),
  api.replace_dataset_schema_version_fields(uuid, jsonb),
  api.publish_dataset_schema_version(uuid),
  api.create_next_dataset_schema_version(uuid),
  api.retire_dataset_schema_definition(uuid)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.create_dataset_schema_definition(uuid, text, text, text, jsonb),
  api.replace_dataset_schema_version_fields(uuid, jsonb),
  api.publish_dataset_schema_version(uuid),
  api.create_next_dataset_schema_version(uuid),
  api.retire_dataset_schema_definition(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION api.create_sheet_definition(
  p_workspace_id uuid, p_key text, p_name text, p_description text, p_configuration jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; version api.sheet_definition_versions; actor text:=api.current_user_id();
BEGIN
 PERFORM api.require_capability(p_workspace_id, 'schema.edit');
 IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_description,''))>2000 THEN RAISE EXCEPTION 'invalid Sheet Definition metadata' USING ERRCODE='SB071'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration);
 INSERT INTO api.sheet_definitions(workspace_id,key,name,description,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,p_key,btrim(p_name),nullif(btrim(p_description),''),actor,actor) RETURNING * INTO definition;
 INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id) VALUES(definition.id,1,p_configuration,actor,actor) RETURNING * INTO version;
 RETURN jsonb_build_object('definition',to_jsonb(definition),'version',to_jsonb(version));
END $$;

CREATE OR REPLACE FUNCTION api.create_sheet_definition_version(
  p_definition_id uuid, p_expected_definition_revision bigint, p_configuration jsonb
) RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; result api.sheet_definition_versions; next_version integer; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(definition.workspace_id, 'schema.edit');
 IF definition.revision<>p_expected_definition_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration); SELECT coalesce(max(version),0)+1 INTO next_version FROM api.sheet_definition_versions WHERE definition_id=definition.id;
 INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id) VALUES(definition.id,next_version,p_configuration,actor,actor) RETURNING * INTO result;
 UPDATE api.sheet_definitions SET revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_definition(p_definition_id uuid, p_expected_revision bigint, p_patch jsonb)
RETURNS api.sheet_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(definition.workspace_id, 'schema.edit');
 IF definition.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'retired Sheet Definition cannot be configured' USING ERRCODE='SB072'; END IF;
 IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch - ARRAY['name','description']<>'{}'::jsonb
    OR (p_patch ? 'name' AND (jsonb_typeof(p_patch->'name') IS DISTINCT FROM 'string' OR length(btrim(p_patch->>'name')) NOT BETWEEN 1 AND 200))
    OR (p_patch ? 'description' AND jsonb_typeof(p_patch->'description') NOT IN ('string','null'))
    OR (jsonb_typeof(p_patch->'description')='string' AND length(p_patch->>'description')>2000)
 THEN RAISE EXCEPTION 'invalid Sheet Definition metadata patch' USING ERRCODE='SB071'; END IF;
 UPDATE api.sheet_definitions SET name=CASE WHEN p_patch?'name' THEN btrim(p_patch->>'name') ELSE name END,description=CASE WHEN p_patch?'description' THEN nullif(btrim(p_patch->>'description'),'') ELSE description END,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id RETURNING * INTO definition; RETURN definition;
END $$;

CREATE OR REPLACE FUNCTION api.update_sheet_definition_draft(p_version_id uuid, p_expected_revision bigint, p_configuration jsonb)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; workspace uuid; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE;
 SELECT workspace_id INTO workspace FROM api.sheet_definitions WHERE id=version.definition_id;
 IF version.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(workspace, 'schema.edit');
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF version.lifecycle<>'draft' THEN RAISE EXCEPTION 'only draft Sheet Definition Versions may be updated' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(p_configuration);
 UPDATE api.sheet_definition_versions SET configuration=p_configuration,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;

CREATE OR REPLACE FUNCTION api.publish_sheet_definition_version(p_version_id uuid, p_expected_revision bigint)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE; SELECT * INTO definition FROM api.sheet_definitions WHERE id=version.definition_id FOR UPDATE;
 IF version.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(definition.workspace_id, 'schema.publish');
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' OR version.lifecycle<>'draft' THEN RAISE EXCEPTION 'only active Definition drafts may be published' USING ERRCODE='SB072'; END IF;
 PERFORM internal.validate_sheet_definition_configuration(version.configuration);
 UPDATE api.sheet_definition_versions SET lifecycle='published',revision=revision+1,published_at=now(),published_by_user_id=actor,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;

CREATE OR REPLACE FUNCTION api.retire_sheet_definition(p_definition_id uuid, p_expected_revision bigint)
RETURNS api.sheet_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE definition api.sheet_definitions; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO definition FROM api.sheet_definitions WHERE id=p_definition_id FOR UPDATE;
 IF definition.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(definition.workspace_id, 'schema.retire');
 IF definition.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition revision' USING ERRCODE='SB001'; END IF;
 IF definition.lifecycle<>'active' THEN RAISE EXCEPTION 'Sheet Definition is already retired' USING ERRCODE='SB072'; END IF;
 UPDATE api.sheet_definitions SET lifecycle='retired',revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=definition.id RETURNING * INTO definition; RETURN definition;
END $$;

CREATE OR REPLACE FUNCTION api.retire_sheet_definition_version(p_version_id uuid, p_expected_revision bigint)
RETURNS api.sheet_definition_versions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE version api.sheet_definition_versions; workspace uuid; actor text:=api.current_user_id();
BEGIN
 SELECT * INTO version FROM api.sheet_definition_versions WHERE id=p_version_id FOR UPDATE;
 SELECT workspace_id INTO workspace FROM api.sheet_definitions WHERE id=version.definition_id;
 IF version.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.retire' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(workspace, 'schema.retire');
 IF version.revision<>p_expected_revision THEN RAISE EXCEPTION 'stale Sheet Definition Version revision' USING ERRCODE='SB001'; END IF;
 IF version.lifecycle='retired' THEN RAISE EXCEPTION 'Sheet Definition Version is already retired' USING ERRCODE='SB072'; END IF;
 UPDATE api.sheet_definition_versions SET lifecycle='retired',revision=revision+1,retired_at=now(),retired_by_user_id=actor,updated_at=now(),updated_by_user_id=actor WHERE id=version.id RETURNING * INTO version; RETURN version;
END $$;


CREATE OR REPLACE FUNCTION api.extract_sheet_definition_draft(
  p_instance_id uuid,
  p_expected_instance_revision bigint,
  p_key text,
  p_name text,
  p_description text,
  p_selection jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances; preview jsonb; definition api.sheet_definitions; version api.sheet_definition_versions; actor text:=api.current_user_id();
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL THEN RAISE EXCEPTION 'capability required: schema.edit' USING ERRCODE='42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'schema.edit');
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision
  THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' OR p_name IS NULL
     OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_description,''))>2000
  THEN RAISE EXCEPTION 'invalid Sheet Definition metadata' USING ERRCODE='SB071'; END IF;
  preview:=internal.build_sheet_definition_extraction_preview(instance,p_selection);
  INSERT INTO api.sheet_definitions(workspace_id,key,name,description,created_by_user_id,updated_by_user_id)
    VALUES(instance.workspace_id,p_key,btrim(p_name),nullif(btrim(p_description),''),actor,actor) RETURNING * INTO definition;
  INSERT INTO api.sheet_definition_versions(definition_id,version,configuration,created_by_user_id,updated_by_user_id)
    VALUES(definition.id,1,preview->'configuration',actor,actor) RETURNING * INTO version;
  RETURN jsonb_build_object('definition',to_jsonb(definition),'version',to_jsonb(version),'preview',preview);
END $$;

CREATE OR REPLACE FUNCTION api.preview_sheet_instance_definition_upgrade(
  p_instance_id uuid,p_expected_instance_revision bigint,p_target_definition_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE instance api.sheet_instances;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR SHARE;
  IF instance.id IS NULL THEN RAISE EXCEPTION 'capability required: instance.upgrade' USING ERRCODE='42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'instance.upgrade');
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  RETURN internal.build_sheet_instance_definition_upgrade_preview(instance,p_target_definition_version_id);
END $$;

CREATE OR REPLACE FUNCTION api.apply_sheet_instance_definition_upgrade(
  p_instance_id uuid,p_expected_instance_revision bigint,p_target_definition_version_id uuid,p_decisions jsonb,p_parameter_inputs jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
#variable_conflict use_variable
DECLARE
  instance api.sheet_instances; preview jsonb; target_config jsonb; resolved jsonb; new_state jsonb;
  conflict jsonb; decision jsonb; item jsonb; nested jsonb; source_column jsonb; identity jsonb; first_identity_column jsonb;
  actor text:=api.current_user_id(); source_version_id uuid; source_id text; target_id text; conflict_kind text;
  collection text;
  column_map jsonb:='{}'::jsonb; parameter_map jsonb:='{}'::jsonb; retained_ids text[]:='{}';
  calculations jsonb:='[]'::jsonb; dependencies jsonb; overrides jsonb:='{}'::jsonb; presentation jsonb; mapped jsonb; inputs jsonb:='[]'::jsonb; supplied jsonb; source_parameter_id text;
  allowed_ids text[]; ordered_ids text[]:='{}'; mapped_id text; provenance api.sheet_instance_definition_upgrades;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id=p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR actor IS NULL THEN RAISE EXCEPTION 'capability required: instance.upgrade' USING ERRCODE='42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'instance.upgrade');
  IF instance.lifecycle<>'active' OR instance.revision<>p_expected_instance_revision THEN RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE='SB073'; END IF;
  preview:=internal.build_sheet_instance_definition_upgrade_preview(instance,p_target_definition_version_id);
  IF p_decisions IS NULL OR jsonb_typeof(p_decisions)<>'array' OR jsonb_array_length(p_decisions)>512 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) d GROUP BY d->>'conflictId' HAVING count(*)>1) THEN RAISE EXCEPTION 'upgrade decisions must be a bounded unique array' USING ERRCODE='SB088'; END IF;
  IF jsonb_array_length(p_decisions)<>jsonb_array_length(preview->'conflicts') THEN RAISE EXCEPTION 'every current upgrade conflict requires exactly one decision' USING ERRCODE='SB088'; END IF;
  FOR conflict IN SELECT value FROM jsonb_array_elements(preview->'conflicts') LOOP
    SELECT value INTO decision FROM jsonb_array_elements(p_decisions) WHERE value->>'conflictId'=conflict->>'id';
    IF decision IS NULL OR decision->>'outcome' NOT IN ('retain-local','map','defer') OR NOT (conflict->'allowedOutcomes' @> jsonb_build_array(decision->>'outcome'))
       OR decision-(CASE WHEN decision->>'outcome'='map' THEN ARRAY['conflictId','outcome','targetId'] ELSE ARRAY['conflictId','outcome'] END)<>'{}'::jsonb
       OR (decision->>'outcome'='map' AND NOT (conflict->'targetCandidates' @> jsonb_build_array(decision->>'targetId')))
    THEN RAISE EXCEPTION 'invalid or stale Definition upgrade decision' USING ERRCODE='SB088'; END IF;
    IF decision->>'outcome'='map' THEN PERFORM internal.sheet_definition_uuid(decision->>'targetId','upgrade decision target ID'); END IF;
  END LOOP;
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_decisions) selected
    JOIN LATERAL (SELECT value FROM jsonb_array_elements(preview->'conflicts') value WHERE value->>'id'=selected->>'conflictId') current_conflict ON true
    WHERE selected->>'outcome'='map'
    GROUP BY split_part(current_conflict.value->>'kind','-',1),selected->>'targetId' HAVING count(*)>1
  ) THEN RAISE EXCEPTION 'Definition upgrade maps must be one-to-one per object kind' USING ERRCODE='SB088'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_decisions) decision WHERE decision->>'outcome'='defer') THEN
    RETURN jsonb_build_object('status','deferred','preview',preview);
  END IF;

  source_version_id:=instance.source_definition_version_id;
  SELECT configuration INTO target_config FROM api.sheet_definition_versions WHERE id=p_target_definition_version_id;
  FOR decision IN SELECT value FROM jsonb_array_elements(p_decisions) LOOP
    SELECT value->>'kind',value->>'sourceId' INTO conflict_kind,source_id FROM jsonb_array_elements(preview->'conflicts') value WHERE value->>'id'=decision->>'conflictId';
    IF decision->>'outcome'='retain-local' THEN
      SELECT value INTO source_column FROM api.sheet_definition_versions version_row CROSS JOIN LATERAL jsonb_array_elements(version_row.configuration->'columns') value WHERE version_row.id=source_version_id AND value->>'id'=source_id;
      IF source_column->'source'->>'kind'<>'declared' THEN RAISE EXCEPTION 'only removed declared columns may be retained locally' USING ERRCODE='SB088'; END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(instance.state->'localFields') field WHERE field->>'fieldId'=source_id) THEN instance.state:=jsonb_set(instance.state,'{localFields}',instance.state->'localFields'||jsonb_build_array(source_column->'field'),true); END IF;
      retained_ids:=array_append(retained_ids,source_id);
    ELSE
      target_id:=decision->>'targetId';
      IF conflict_kind LIKE 'column-%' THEN column_map:=column_map||jsonb_build_object(source_id,target_id);
      ELSIF conflict_kind LIKE 'parameter-%' THEN parameter_map:=parameter_map||jsonb_build_object(source_id,target_id); END IF;
    END IF;
  END LOOP;

  IF p_parameter_inputs IS NULL OR jsonb_typeof(p_parameter_inputs)<>'array' OR jsonb_array_length(p_parameter_inputs)>64 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_parameter_inputs) input GROUP BY input->>'parameterId' HAVING count(*)>1) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_parameter_inputs) input WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target_config->'parameters') parameter WHERE parameter->>'id'=input->>'parameterId')) THEN RAISE EXCEPTION 'invalid explicit target parameter inputs' USING ERRCODE='SB088'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(target_config->'parameters') LOOP
    target_id:=item->>'id'; supplied:=NULL;
    SELECT value INTO supplied FROM jsonb_array_elements(p_parameter_inputs) WHERE value->>'parameterId'=target_id;
    IF supplied IS NULL THEN
      SELECT key INTO source_parameter_id FROM jsonb_each_text(parameter_map) WHERE value=target_id LIMIT 1;
      source_parameter_id:=coalesce(source_parameter_id,target_id);
      SELECT jsonb_build_object('parameterId',target_id,'kind','scalar','value',value->'value') INTO supplied FROM jsonb_array_elements(coalesce(instance.state->'parameterValues','[]'::jsonb)) value WHERE value->>'parameterId'=source_parameter_id;
      IF supplied IS NULL THEN
        SELECT CASE WHEN value->>'kind'='record' THEN jsonb_build_object('parameterId',target_id,'kind','record','recordId',value->>'recordId') WHEN value->'policy'->>'mode'='version' THEN jsonb_build_object('parameterId',target_id,'kind','dataset-version','datasetVersionId',value->'policy'->>'datasetVersionId') ELSE jsonb_build_object('parameterId',target_id,'kind','dataset','datasetId',value->>'datasetId') END INTO supplied
          FROM jsonb_array_elements(instance.state->'bindings') value WHERE value->>'parameterId'=source_parameter_id;
      END IF;
    END IF;
    IF supplied IS NOT NULL THEN inputs:=inputs||jsonb_build_array(supplied); END IF;
  END LOOP;
  resolved:=internal.resolve_sheet_parameters(instance.workspace_id,p_target_definition_version_id,inputs);

  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) LOOP
    dependencies:='[]'::jsonb;
    FOR nested IN SELECT value FROM jsonb_array_elements(item->'dependencies') LOOP
      mapped_id:=nested->>'id';
      IF nested->>'kind'='column' AND column_map ? mapped_id THEN mapped_id:=column_map->>mapped_id;
      ELSIF nested->>'kind'='column' AND mapped_id=ANY(retained_ids) THEN nested:=jsonb_set(nested,'{kind}','"local-field"',true);
      END IF;
      dependencies:=dependencies||jsonb_build_array(jsonb_set(nested,'{id}',to_jsonb(mapped_id),true));
    END LOOP;
    calculations:=calculations||jsonb_build_array(jsonb_set(item,'{dependencies}',dependencies,true));
  END LOOP;
  FOR source_id,nested IN SELECT * FROM jsonb_each(instance.state->'calculationOverrides') LOOP
    mapped_id:=source_id;
    IF overrides ? mapped_id THEN RAISE EXCEPTION 'calculation override mapping is not one-to-one' USING ERRCODE='SB088'; END IF;
    overrides:=overrides||jsonb_build_object(mapped_id,nested);
  END LOOP;

  presentation:=instance.state->'presentation';
  FOR collection IN SELECT unnest(ARRAY['columnOrder','hiddenColumnIds']) LOOP
    mapped:='[]'::jsonb; ordered_ids:='{}';
    FOR source_id IN SELECT value FROM jsonb_array_elements_text(presentation->collection) LOOP
      mapped_id:=coalesce(column_map->>source_id,source_id);
      IF mapped_id<>ALL(ordered_ids) THEN mapped:=mapped||jsonb_build_array(mapped_id); ordered_ids:=array_append(ordered_ids,mapped_id); END IF;
    END LOOP;
    presentation:=jsonb_set(presentation,ARRAY[collection],mapped,true);
  END LOOP;
  mapped:='{}'::jsonb;
  FOR source_id,nested IN SELECT * FROM jsonb_each(presentation->'columnWidths') LOOP mapped_id:=coalesce(column_map->>source_id,source_id); mapped:=mapped||jsonb_build_object(mapped_id,nested); END LOOP;
  presentation:=jsonb_set(presentation,'{columnWidths}',mapped,true);
  FOREACH collection IN ARRAY ARRAY['filters','sorts'] LOOP
    mapped:='[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(coalesce(presentation->collection,'[]'::jsonb)) LOOP mapped_id:=coalesce(column_map->>(item->>'columnId'),item->>'columnId'); mapped:=mapped||jsonb_build_array(jsonb_set(item,'{columnId}',to_jsonb(mapped_id),true)); END LOOP;
    presentation:=jsonb_set(presentation,ARRAY[collection],mapped,true);
  END LOOP;
  SELECT coalesce(array_agg(id),'{}') INTO allowed_ids FROM (
    SELECT value->>'id' id FROM jsonb_array_elements(target_config->'columns') value
    UNION SELECT value->>'fieldId' FROM jsonb_array_elements(instance.state->'localFields') value
    UNION SELECT value->>'id' FROM jsonb_array_elements(calculations) value
  ) ids;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(presentation->'columnOrder') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(presentation->'hiddenColumnIds') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_object_keys(presentation->'columnWidths') id WHERE id<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(presentation->'filters') AS filter_entry(value) WHERE (filter_entry.value->>'columnId')<>ALL(allowed_ids)) OR EXISTS(SELECT 1 FROM jsonb_array_elements(presentation->'sorts') AS sort_entry(value) WHERE (sort_entry.value->>'columnId')<>ALL(allowed_ids)) THEN RAISE EXCEPTION 'upgrade decisions leave incompatible Instance presentation references' USING ERRCODE='SB088'; END IF;
  ordered_ids:=ARRAY(SELECT value FROM jsonb_array_elements_text(presentation->'columnOrder'));
  FOR target_id IN SELECT value->>'id' FROM jsonb_array_elements(target_config->'columns') value LOOP IF target_id<>ALL(ordered_ids) THEN ordered_ids:=array_append(ordered_ids,target_id); END IF; END LOOP;
  presentation:=jsonb_set(presentation,'{columnOrder}',to_jsonb(ordered_ids),true);
  presentation:=jsonb_set(presentation,'{frozenColumnCount}',to_jsonb(least((presentation->>'frozenColumnCount')::integer,cardinality(ordered_ids))),true);

  identity:=target_config->'rowIdentity';
  SELECT value INTO first_identity_column FROM jsonb_array_elements(target_config->'columns') WHERE value->>'id'=identity->'columnIds'->>0;
  identity:=identity||jsonb_build_object('formatVersion',1,'logicalTypes',(SELECT jsonb_agg(column_item->'field'->>'logicalType' ORDER BY ids.ordinality) FROM jsonb_array_elements(identity->'columnIds') WITH ORDINALITY ids JOIN LATERAL jsonb_array_elements(target_config->'columns') column_item ON column_item->>'id'=ids.value#>>'{}'),'sourceBindingId',CASE WHEN identity->>'kind'='source' THEN first_identity_column->'source'->>'bindingId' ELSE NULL END,'sourceFieldId',CASE WHEN identity->>'kind'='source' THEN first_identity_column->'source'->>'sourceFieldId' ELSE NULL END);
  new_state:=(instance.state-'bindings'-'parameterValues'-'resolutionProvenance'-'resolvedRowIdentity'-'instanceCalculations')||resolved||jsonb_build_object('resolvedRowIdentity',identity,'calculationOverrides',overrides,'presentation',presentation);
  IF calculations<>'[]'::jsonb OR instance.state ? 'instanceCalculations' THEN new_state:=jsonb_set(new_state,'{instanceCalculations}',calculations,true); END IF;
  PERFORM internal.validate_sheet_instance_state(new_state); PERFORM internal.validate_sheet_instance_calculation_dependencies(p_target_definition_version_id,new_state); PERFORM internal.validate_sheet_instance_presentation(p_target_definition_version_id,new_state);

  PERFORM set_config('sheetbase.sheet_instance_write','rpc-v1',true); PERFORM set_config('sheetbase.sheet_instance_upgrade','rpc-v1',true);
  UPDATE api.sheet_instances SET source_definition_version_id=p_target_definition_version_id,state=new_state,revision=revision+1,updated_at=now(),updated_by_user_id=actor WHERE id=instance.id RETURNING * INTO instance;
  INSERT INTO api.sheet_instance_definition_upgrades(workspace_id,instance_id,source_definition_version_id,target_definition_version_id,source_instance_revision,resulting_instance_revision,decision_manifest,actor_user_id)
    VALUES(instance.workspace_id,instance.id,source_version_id,p_target_definition_version_id,p_expected_instance_revision,instance.revision,p_decisions,actor) RETURNING * INTO provenance;
  RETURN jsonb_build_object('status','applied','preview',preview,'instance',to_jsonb(instance),'provenance',jsonb_build_object('sourceDefinitionVersionId',provenance.source_definition_version_id,'targetDefinitionVersionId',provenance.target_definition_version_id,'sourceInstanceRevision',provenance.source_instance_revision,'resultingInstanceRevision',provenance.resulting_instance_revision,'actorUserId',provenance.actor_user_id,'upgradedAt',provenance.upgraded_at,'decisions',provenance.decision_manifest));
END $$;

CREATE OR REPLACE FUNCTION api.search_sheet_records(
  p_model_key text,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 25,
  p_include_archived boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_limit integer;
  v_q text;
  v_pattern text;
BEGIN
  PERFORM api.require_capability(api.current_workspace_id(), 'record.link');
  IF p_model_key IS NULL OR length(btrim(p_model_key)) = 0 THEN
    RAISE EXCEPTION 'model key is required' USING ERRCODE = '22023';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'model does not support Sheet Record search' USING ERRCODE = '22023';
  END IF;
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_q := btrim(coalesce(p_query, ''));
  v_pattern := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN coalesce((
    SELECT jsonb_agg(row_to_json(s)::jsonb)
    FROM (
      SELECT
        r.id,
        r.kind,
        r.identifier,
        r.title,
        r.status,
        (r.archived_at IS NOT NULL) AS archived
      FROM api.records r
      WHERE r.kind = v_kind
        AND r.deleted_at IS NULL
        AND (p_include_archived OR r.archived_at IS NULL)
        AND (
          v_q = ''
          OR r.identifier ILIKE v_pattern ESCAPE '\'
          OR r.title ILIKE v_pattern ESCAPE '\'
          OR EXISTS (
            SELECT 1
            FROM jsonb_each_text(coalesce(r.custom_fields, '{}'::jsonb)) e
            WHERE e.value ILIKE v_pattern ESCAPE '\'
          )
        )
      ORDER BY
        CASE WHEN r.identifier = v_q THEN 0 ELSE 1 END,
        r.identifier
      LIMIT v_limit
    ) s
  ), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION api.validate_sheet_record_batch(
  p_project_id uuid,
  p_model_key text,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  v_kind text;
  item jsonb;
  row_index integer := 0;
  results jsonb := '[]'::jsonb;
  errors jsonb;
  classification text;
  match_id uuid;
  existing api.records;
  custom jsonb;
  v_title text;
  v_row_key text;
  v_operation text;
  seen_keys text[] := '{}';
  seen_matches text[] := '{}';
  identifier_key text;
  duplicate_matches text[] := '{}';
BEGIN
  IF workspace IS NULL THEN
    RAISE EXCEPTION 'capability required: record.link' USING ERRCODE = '42501';
  END IF;
  PERFORM api.assert_record_batch_capabilities(workspace, p_rows);
  IF NOT EXISTS (
    SELECT 1 FROM api.projects
     WHERE id = p_project_id AND workspace_id = workspace
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'model does not support Sheet Record batches' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0
     OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION '1 to 1000 batch rows are required' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(identifier), '{}')
    INTO duplicate_matches
    FROM (
      SELECT value->>'matchIdentifier' AS identifier
      FROM jsonb_array_elements(p_rows) value
      WHERE value->>'operation' = 'create'
        AND nullif(btrim(coalesce(value->>'matchIdentifier', '')), '') IS NOT NULL
      GROUP BY value->>'matchIdentifier'
      HAVING count(*) > 1
    ) d;

  FOR item IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    row_index := row_index + 1;
    errors := '[]'::jsonb;
    classification := NULL;
    match_id := NULL;
    IF jsonb_typeof(item) <> 'object'
       OR jsonb_typeof(item->'rowKey') <> 'string'
       OR length(btrim(item->>'rowKey')) = 0
       OR item->>'operation' NOT IN ('create', 'link') THEN
      RAISE EXCEPTION 'invalid Sheet Record batch row shape' USING ERRCODE = '22023';
    END IF;
    v_row_key := item->>'rowKey';
    v_operation := item->>'operation';
    IF v_row_key = ANY (seen_keys) THEN
      RAISE EXCEPTION 'duplicate Sheet row key in batch' USING ERRCODE = '22023';
    END IF;
    seen_keys := array_append(seen_keys, v_row_key);

    IF v_operation = 'link' THEN
      BEGIN
        match_id := (item->>'recordId')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'not-uuid',
          'message', 'Record reference identity is the Record UUID, not the Record ID or Name.'
        ));
        match_id := NULL;
      END;
      IF match_id IS NULL AND jsonb_array_length(errors) = 0 THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'required',
          'message', 'Record reference is required.'
        ));
      ELSIF match_id IS NOT NULL THEN
        SELECT * INTO existing
          FROM api.records r
         WHERE r.id = match_id
           AND r.workspace_id = workspace
           AND r.kind = v_kind
           AND r.deleted_at IS NULL;
        IF existing.id IS NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'missing',
            'message', 'Record is not visible in this workspace and Model.'
          ));
        ELSIF existing.archived_at IS NOT NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'archived_target',
            'fieldName', 'recordId',
            'message', 'Archived Records cannot be newly linked from a Sheet.'
          ));
        ELSE
          classification := 'link';
        END IF;
      END IF;
    ELSE
      IF item ? 'identifier' THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'record_id_policy',
          'fieldName', 'identifier',
          'message', 'Sheet creation uses Model-generated PREFIX-YYYY-NNNN identifiers.'
        ));
      END IF;
      v_title := nullif(btrim(coalesce(item->>'title', '')), '');
      custom := coalesce(item->'values', '{}'::jsonb);
      IF jsonb_typeof(custom) <> 'object' THEN
        RAISE EXCEPTION 'invalid Sheet Record batch row shape' USING ERRCODE = '22023';
      END IF;
      identifier_key := nullif(btrim(coalesce(item->>'matchIdentifier', '')), '');
      IF identifier_key IS NOT NULL AND identifier_key = ANY (duplicate_matches) THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'code', 'duplicate_input_row',
          'fieldName', 'matchIdentifier',
          'message', 'Duplicate match identifier in this batch.'
        ));
      ELSIF identifier_key IS NOT NULL THEN
        seen_matches := array_append(seen_matches, identifier_key);
        SELECT * INTO existing
          FROM api.records r
         WHERE r.project_id = p_project_id
           AND r.kind = v_kind
           AND r.identifier = identifier_key
           AND r.deleted_at IS NULL;
        IF existing.id IS NOT NULL THEN
          IF existing.archived_at IS NOT NULL THEN
            errors := errors || jsonb_build_array(jsonb_build_object(
              'code', 'archived_target',
              'fieldName', 'matchIdentifier',
              'message', 'Matched Record is archived.'
            ));
          ELSE
            classification := 'existing';
            match_id := existing.id;
          END IF;
        END IF;
      END IF;
      IF classification IS NULL AND jsonb_array_length(errors) = 0 THEN
        IF v_title IS NULL THEN
          errors := errors || jsonb_build_array(jsonb_build_object(
            'code', 'required_value',
            'fieldName', 'title',
            'message', 'Record Name is required.'
          ));
        ELSE
          BEGIN
            PERFORM internal.validate_model_fields(workspace, p_model_key, custom, '{}'::jsonb);
            classification := 'create';
          EXCEPTION WHEN OTHERS THEN
            errors := errors || jsonb_build_array(jsonb_build_object(
              'code', SQLSTATE,
              'message', SQLERRM
            ));
          END;
        END IF;
      END IF;
    END IF;

    IF jsonb_array_length(errors) > 0 THEN
      classification := 'invalid';
      match_id := NULL;
    END IF;

    results := results || jsonb_build_array(jsonb_build_object(
      'rowIndex', row_index,
      'rowKey', v_row_key,
      'classification', classification,
      'recordId', match_id,
      'errors', errors
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(results) value
      WHERE value->>'classification' = 'invalid'
    ),
    'mutated', false,
    'rows', results
  );
END
$$;

CREATE OR REPLACE FUNCTION api.create_and_link_sheet_record(
  p_project_id uuid,
  p_model_key text,
  p_title text,
  p_custom_fields jsonb,
  p_write_target jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  v_kind text;
  created api.records;
  custom jsonb;
BEGIN
  IF workspace IS NULL THEN
    RAISE EXCEPTION 'capability required: record.create' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace, 'record.create');
  IF NOT EXISTS (
    SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = workspace
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_write_target ? 'identifier' OR p_custom_fields ? 'identifier' THEN
    RAISE EXCEPTION 'Sheet creation uses Model-generated PREFIX-YYYY-NNNN identifiers.' USING ERRCODE = '22023';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'model does not support Sheet Record creation' USING ERRCODE = '22023';
  END IF;
  custom := internal.validate_model_fields(
    workspace, p_model_key, coalesce(p_custom_fields, '{}'::jsonb), '{}'::jsonb
  );
  created := internal.create_sheet_model_record(
    workspace, p_project_id, v_kind, p_title, custom
  );
  PERFORM internal.write_sheet_record_reference(workspace, created.id, p_write_target);
  RETURN jsonb_build_object(
    'ok', true,
    'recordId', created.id,
    'identifier', created.identifier,
    'title', created.title,
    'notebookRecordLink', false
  );
END
$$;

CREATE OR REPLACE FUNCTION api.commit_sheet_record_batch(
  p_project_id uuid,
  p_model_key text,
  p_rows jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  actor text := api.current_user_id();
  v_kind text;
  existing api.sheet_record_bulk_commits;
  digest text;
  validation jsonb;
  item jsonb;
  created api.records;
  custom jsonb;
  result_rows jsonb := '[]'::jsonb;
  result jsonb;
  record_id uuid;
  classified jsonb;
BEGIN
  IF workspace IS NULL OR actor IS NULL THEN
    RAISE EXCEPTION 'capability required: record.create' USING ERRCODE = '42501';
  END IF;
  PERFORM api.assert_record_batch_capabilities(workspace, p_rows);
  IF NOT EXISTS (
    SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = workspace
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT record_kind INTO v_kind
    FROM api.model_kinds
   WHERE key = p_model_key AND identity_table = 'api.records' AND record_kind IS NOT NULL;
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'model does not support Sheet Record batches' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'projectId', p_project_id,
    'modelKey', p_model_key,
    'rows', p_rows
  )::text, 'UTF8')), 'hex');
  SELECT * INTO existing
    FROM api.sheet_record_bulk_commits
   WHERE workspace_id = workspace AND actor_user_id = actor AND idempotency_key = p_idempotency_key;
  IF existing.id IS NOT NULL THEN
    IF existing.project_id <> p_project_id OR existing.request_digest <> digest THEN
      RAISE EXCEPTION 'idempotency key was used for a different Sheet Record batch' USING ERRCODE = '23505';
    END IF;
    RETURN existing.result || jsonb_build_object('idempotent', true);
  END IF;
  validation := api.validate_sheet_record_batch(p_project_id, p_model_key, p_rows);
  IF (validation->>'ok')::boolean IS NOT TRUE THEN
    RETURN validation || jsonb_build_object('idempotent', false, 'mutated', false);
  END IF;
  FOR classified IN SELECT value FROM jsonb_array_elements(validation->'rows') LOOP
    SELECT elem INTO item
      FROM jsonb_array_elements(p_rows) AS elem
     WHERE elem->>'rowKey' = classified->>'rowKey';
    IF item IS NULL OR NOT (item ? 'writeTarget') THEN
      RAISE EXCEPTION 'each committed row requires a write-back target' USING ERRCODE = '22023';
    END IF;
    IF classified->>'classification' = 'invalid'
       OR classified->>'classification' IS NULL THEN
      RAISE EXCEPTION 'cannot commit invalid Sheet Record rows' USING ERRCODE = '22023';
    END IF;
    IF classified->>'classification' = 'create' THEN
      custom := internal.validate_model_fields(
        workspace, p_model_key, coalesce(item->'values', '{}'::jsonb), '{}'::jsonb
      );
      created := internal.create_sheet_model_record(
        workspace, p_project_id, v_kind, item->>'title', custom
      );
      record_id := created.id;
      PERFORM internal.write_sheet_record_reference(workspace, record_id, item->'writeTarget');
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'rowKey', item->>'rowKey',
        'classification', 'create',
        'recordId', record_id,
        'identifier', created.identifier
      ));
    ELSE
      record_id := (classified->>'recordId')::uuid;
      PERFORM internal.write_sheet_record_reference(workspace, record_id, item->'writeTarget');
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'rowKey', item->>'rowKey',
        'classification', classified->>'classification',
        'recordId', record_id
      ));
    END IF;
  END LOOP;
  result := jsonb_build_object(
    'ok', true,
    'mutated', true,
    'idempotent', false,
    'notebookRecordLink', false,
    'rows', result_rows
  );
  INSERT INTO api.sheet_record_bulk_commits (
    workspace_id, project_id, actor_user_id, idempotency_key, request_digest, result
  ) VALUES (workspace, p_project_id, actor, p_idempotency_key, digest, result);
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION api.create_model_record(
 p_project_id uuid,p_kind text,p_title text,p_status text DEFAULT 'draft',p_tags text[] DEFAULT '{}',p_properties jsonb DEFAULT '{}',p_custom_fields jsonb DEFAULT '{}'
) RETURNS api.records LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE workspace uuid:=api.current_workspace_id(); prefix text; year text:=to_char(now(),'YYYY'); sequence integer; generated_identifier text; result api.records;
BEGIN
 IF workspace IS NULL THEN RAISE EXCEPTION 'capability required: record.create' USING ERRCODE='42501'; END IF;
 PERFORM api.require_capability(workspace, 'record.create');
 prefix:=CASE p_kind WHEN 'experiment' THEN 'EXP' WHEN 'protocol_template' THEN 'PRT' WHEN 'report' THEN 'RPT' WHEN 'sample' THEN 'SMP' WHEN 'reagent' THEN 'RGT' WHEN 'file' THEN 'FILE' WHEN 'notebook_template' THEN 'NBK' ELSE NULL END;
 IF prefix IS NULL THEN RAISE EXCEPTION 'unsupported record kind: %',p_kind USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=workspace) THEN RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE='42501'; END IF;
 LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE;
 SELECT count(*)+1 INTO sequence FROM api.records WHERE project_id=p_project_id AND identifier LIKE prefix||'-'||year||'-%';
 generated_identifier:=prefix||'-'||year||'-'||lpad(sequence::text,4,'0');
 INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,tags,properties,custom_fields,created_by_user_id)
 VALUES(workspace,p_project_id,p_kind,generated_identifier,coalesce(nullif(btrim(p_title),''),generated_identifier),p_status,coalesce(p_tags,'{}'),coalesce(p_properties,'{}'),coalesce(p_custom_fields,'{}'),api.current_user_id()) RETURNING * INTO result;
 RETURN result;
END $$;

REVOKE EXECUTE ON FUNCTION api.search_sheet_records(text, text, integer, boolean) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.search_sheet_records(text, text, integer, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION api.validate_sheet_record_batch(uuid, text, jsonb) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.validate_sheet_record_batch(uuid, text, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION api.create_and_link_sheet_record(uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.create_and_link_sheet_record(uuid, text, text, jsonb, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION api.commit_sheet_record_batch(uuid, text, jsonb, text) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.commit_sheet_record_batch(uuid, text, jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION api.create_model_record(uuid, text, text, text, text[], jsonb, jsonb) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.create_model_record(uuid, text, text, text, text[], jsonb, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
