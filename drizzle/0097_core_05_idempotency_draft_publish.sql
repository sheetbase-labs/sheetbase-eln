-- CORE-05 corrections: actor-scoped idempotency, explicit Dataset Schema
-- draft boundaries, explicit Model promotion targets, and schema.publish
-- enforcement for publication lifecycle transitions.

-- ---------------------------------------------------------------------------
-- 1. configuration_change_log: actor + idempotency key contract
-- ---------------------------------------------------------------------------
ALTER TABLE api.configuration_change_log
  ADD COLUMN IF NOT EXISTS idempotency_key text;

UPDATE api.configuration_change_log
   SET actor_user_id = coalesce(nullif(actor_user_id, ''), 'unknown')
 WHERE actor_user_id IS NULL OR actor_user_id = '';

UPDATE api.configuration_change_log
   SET idempotency_key = request_digest
 WHERE idempotency_key IS NULL;

ALTER TABLE api.configuration_change_log
  ALTER COLUMN actor_user_id SET NOT NULL,
  ALTER COLUMN idempotency_key SET NOT NULL;

ALTER TABLE api.configuration_change_log
  DROP CONSTRAINT IF EXISTS uq_configuration_change_log;

ALTER TABLE api.configuration_change_log
  DROP CONSTRAINT IF EXISTS uq_configuration_change_log_actor_key;

ALTER TABLE api.configuration_change_log
  ADD CONSTRAINT uq_configuration_change_log_actor_key
    UNIQUE (workspace_id, actor_user_id, kind, idempotency_key);

ALTER TABLE api.configuration_change_log
  DROP CONSTRAINT IF EXISTS chk_configuration_change_log_idempotency_key;

ALTER TABLE api.configuration_change_log
  ADD CONSTRAINT chk_configuration_change_log_idempotency_key
    CHECK (length(idempotency_key) BETWEEN 1 AND 128);

CREATE OR REPLACE FUNCTION internal.replay_configuration_change(
  p_workspace_id uuid,
  p_actor_user_id text,
  p_kind text,
  p_idempotency_key text,
  p_request_digest text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  existing api.configuration_change_log;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO existing
    FROM api.configuration_change_log
   WHERE workspace_id = p_workspace_id
     AND actor_user_id = p_actor_user_id
     AND kind = p_kind
     AND idempotency_key = p_idempotency_key;
  IF existing.id IS NULL THEN
    RETURN NULL;
  END IF;
  IF existing.request_digest IS DISTINCT FROM p_request_digest THEN
    RAISE EXCEPTION 'idempotency key was used for a different configuration request'
      USING ERRCODE = '23505';
  END IF;
  RETURN existing.result || jsonb_build_object('idempotent', true);
END;
$$;

CREATE OR REPLACE FUNCTION internal.record_configuration_change(
  p_workspace_id uuid,
  p_actor_user_id text,
  p_kind text,
  p_idempotency_key text,
  p_request_digest text,
  p_result jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO api.configuration_change_log(
    workspace_id, actor_user_id, kind, idempotency_key, request_digest, result
  ) VALUES (
    p_workspace_id, p_actor_user_id, p_kind, p_idempotency_key, p_request_digest, p_result
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION
  internal.replay_configuration_change(uuid, text, text, text, text),
  internal.record_configuration_change(uuid, text, text, text, text, jsonb)
  FROM PUBLIC, authenticated, api_client;

-- ---------------------------------------------------------------------------
-- 2. Dataset Schema Version revision + explicit draft boundaries
-- ---------------------------------------------------------------------------
ALTER TABLE api.dataset_schema_versions
  ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;

ALTER TABLE api.dataset_schema_versions
  DROP CONSTRAINT IF EXISTS chk_dataset_schema_versions_revision;

ALTER TABLE api.dataset_schema_versions
  ADD CONSTRAINT chk_dataset_schema_versions_revision CHECK (revision > 0);

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
  UPDATE api.dataset_schema_versions
     SET revision = revision + 1, updated_at = now()
   WHERE id = version.id;
END;
$$;

CREATE OR REPLACE FUNCTION internal.fork_dataset_schema_version(p_source_version_id uuid)
RETURNS api.dataset_schema_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  source api.dataset_schema_versions;
  created api.dataset_schema_versions;
  actor text := api.current_user_id();
  next_version integer;
BEGIN
  SELECT * INTO source FROM api.dataset_schema_versions WHERE id = p_source_version_id FOR UPDATE;
  IF source.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.dataset_schema_versions
     WHERE schema_id = source.schema_id AND lifecycle = 'draft'
  ) THEN
    RAISE EXCEPTION 'a draft Dataset Schema Version already exists' USING ERRCODE = 'SB072';
  END IF;
  SELECT coalesce(max(version), 0) + 1 INTO next_version
    FROM api.dataset_schema_versions
   WHERE schema_id = source.schema_id;
  INSERT INTO api.dataset_schema_versions(
    schema_id, version, lifecycle, created_by_user_id, revision
  ) VALUES (
    source.schema_id, next_version, 'draft', actor, 1
  ) RETURNING * INTO created;
  INSERT INTO api.dataset_schema_version_fields(
    schema_version_id, field_id, key, label, description, logical_type, nullable,
    default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
  )
  SELECT created.id, field_id, key, label, description, logical_type, nullable,
         default_value, quantity, validation, category, relationship, cardinality, lifecycle, display_order
    FROM api.dataset_schema_version_fields
   WHERE schema_version_id = source.id;
  RETURN created;
END;
$$;

CREATE OR REPLACE FUNCTION internal.lock_dataset_schema_write_version(
  p_schema_version_id uuid,
  p_expected_revision bigint
) RETURNS api.dataset_schema_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  definition api.dataset_schema_definitions;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO definition FROM api.dataset_schema_definitions WHERE id = version.schema_id FOR UPDATE;
  IF version.lifecycle = 'draft' THEN
    IF p_expected_revision IS NULL THEN
      RAISE EXCEPTION 'expected revision is required to update a draft Dataset Schema Version'
        USING ERRCODE = 'SB001';
    END IF;
    IF p_expected_revision IS DISTINCT FROM version.revision THEN
      RAISE EXCEPTION 'stale Dataset Schema Version revision' USING ERRCODE = 'SB001';
    END IF;
    RETURN version;
  END IF;
  IF version.lifecycle <> 'active' THEN
    RAISE EXCEPTION 'Dataset Schema Version cannot be evolved' USING ERRCODE = 'SB072';
  END IF;
  RETURN internal.fork_dataset_schema_version(version.id);
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
  RETURN jsonb_build_object('schema_version_id', created.id, 'version', created.version);
END;
$$;

REVOKE EXECUTE ON FUNCTION
  internal.fork_dataset_schema_version(uuid),
  internal.lock_dataset_schema_write_version(uuid, bigint)
  FROM PUBLIC, authenticated, api_client;

-- ---------------------------------------------------------------------------
-- 3. Capability overlay (fail-closed test seam) + publish lifecycle guards
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
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
  -- Fail-closed overlay for proving capability splits. Production must not set
  -- sheetbase.capability_mask; unset keeps the role-mapped vocabulary.
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL THEN
    RETURN p_capability = ANY (string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ','));
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

DROP POLICY IF EXISTS dataset_schema_definitions_write ON api.dataset_schema_definitions;
DROP POLICY IF EXISTS dataset_schema_versions_write ON api.dataset_schema_versions;
DROP POLICY IF EXISTS dataset_schema_version_fields_write ON api.dataset_schema_version_fields;
CREATE POLICY dataset_schema_definitions_write ON api.dataset_schema_definitions
  FOR ALL TO authenticated
  USING (api.has_capability(workspace_id, 'schema.edit'))
  WITH CHECK (api.has_capability(workspace_id, 'schema.edit'));
CREATE POLICY dataset_schema_versions_write ON api.dataset_schema_versions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions s
     WHERE s.id = schema_id
       AND api.has_capability(s.workspace_id, 'schema.edit')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions s
     WHERE s.id = schema_id
       AND api.has_capability(s.workspace_id, 'schema.edit')
  ));
CREATE POLICY dataset_schema_version_fields_write ON api.dataset_schema_version_fields
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
     WHERE v.id = schema_version_id
       AND api.has_capability(s.workspace_id, 'schema.edit')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM api.dataset_schema_versions v
    JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
     WHERE v.id = schema_version_id
       AND api.has_capability(s.workspace_id, 'schema.edit')
  ));

CREATE OR REPLACE FUNCTION internal.require_schema_publish_for_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid;
BEGIN
  IF session_user = 'migrator' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'dataset_schema_versions' THEN
    SELECT s.workspace_id INTO workspace
      FROM api.dataset_schema_definitions s WHERE s.id = NEW.schema_id;
    IF TG_OP = 'INSERT' AND NEW.lifecycle IS DISTINCT FROM 'draft' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.lifecycle = 'draft'
          AND NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'dataset_schema_definitions' THEN
    workspace := NEW.workspace_id;
    IF TG_OP = 'INSERT' AND NEW.lifecycle IS DISTINCT FROM 'draft' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.lifecycle = 'draft'
          AND NEW.lifecycle = 'active' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_schema_publish_for_version_lifecycle ON api.dataset_schema_versions;
CREATE TRIGGER require_schema_publish_for_version_lifecycle
  BEFORE INSERT OR UPDATE OF lifecycle ON api.dataset_schema_versions
  FOR EACH ROW EXECUTE FUNCTION internal.require_schema_publish_for_lifecycle();

DROP TRIGGER IF EXISTS require_schema_publish_for_definition_lifecycle ON api.dataset_schema_definitions;
CREATE TRIGGER require_schema_publish_for_definition_lifecycle
  BEFORE INSERT OR UPDATE OF lifecycle ON api.dataset_schema_definitions
  FOR EACH ROW EXECUTE FUNCTION internal.require_schema_publish_for_lifecycle();

REVOKE EXECUTE ON FUNCTION internal.require_schema_publish_for_lifecycle()
  FROM PUBLIC, authenticated, api_client;

-- ---------------------------------------------------------------------------
-- 4. Evolution / promotion RPCs
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS api.apply_dataset_schema_evolution(uuid, jsonb, text);
CREATE FUNCTION api.apply_dataset_schema_evolution(
  p_schema_version_id uuid,
  p_fields jsonb,
  p_idempotency_key text,
  p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  version api.dataset_schema_versions;
  write_version api.dataset_schema_versions;
  workspace uuid;
  actor text := api.current_user_id();
  digest text;
  replay jsonb;
  preview jsonb;
  published api.dataset_schema_versions;
  result jsonb;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
  SELECT s.workspace_id INTO workspace FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(workspace, 'schema.publish');
  digest := encode(sha256(convert_to(jsonb_build_object(
    'base', p_schema_version_id, 'fields', p_fields
  )::text, 'UTF8')), 'hex');
  replay := internal.replay_configuration_change(
    workspace, actor, 'dataset_schema_evolution', p_idempotency_key, digest
  );
  IF replay IS NOT NULL THEN
    RETURN replay;
  END IF;
  preview := api.preview_dataset_schema_evolution(p_schema_version_id, p_fields);
  write_version := internal.lock_dataset_schema_write_version(p_schema_version_id, p_expected_revision);
  PERFORM api.replace_dataset_schema_version_fields(write_version.id, p_fields);
  published := api.publish_dataset_schema_version(write_version.id);
  result := preview || jsonb_build_object(
    'ok', true,
    'schemaVersionId', published.id,
    'version', published.version,
    'idempotent', false
  );
  PERFORM internal.record_configuration_change(
    workspace, actor, 'dataset_schema_evolution', p_idempotency_key, digest, result
  );
  RETURN result;
END;
$$;

DROP FUNCTION IF EXISTS api.preview_local_field_promotion(uuid, uuid, text, uuid);
CREATE FUNCTION api.preview_local_field_promotion(
  p_instance_id uuid,
  p_field_id uuid,
  p_target text,
  p_schema_definition_id uuid DEFAULT NULL,
  p_model_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  local_field jsonb;
  value jsonb;
  errors jsonb := '[]'::jsonb;
  model api.model_kinds;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT item INTO local_field
    FROM jsonb_array_elements(coalesce(instance.state->'localFields','[]'::jsonb)) item
   WHERE item->>'fieldId' = p_field_id::text AND item->>'lifecycle' = 'active';
  IF local_field IS NULL THEN RAISE EXCEPTION 'local field not found' USING ERRCODE = '22023'; END IF;
  IF p_target = 'model_field' THEN
    IF p_model_key IS NULL OR btrim(p_model_key) = '' THEN
      RAISE EXCEPTION 'Model key is required' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO model FROM api.model_kinds WHERE key = p_model_key;
    IF model.key IS NULL THEN
      RAISE EXCEPTION 'unsupported Model target' USING ERRCODE = '22023';
    END IF;
  ELSIF p_target = 'dataset_schema' THEN
    IF p_model_key IS NOT NULL THEN
      RAISE EXCEPTION 'Model key is not valid for Dataset Schema promotion' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported promotion target' USING ERRCODE = '22023';
  END IF;
  FOR value IN
    SELECT r.value->(p_field_id::text)
      FROM jsonb_each(coalesce(instance.state->'localValues','{}'::jsonb)) r
     WHERE r.value ? (p_field_id::text)
  LOOP
    IF internal.sheet_local_cell_error(instance.workspace_id, local_field, value) IS NOT NULL THEN
      errors := errors || jsonb_build_array(jsonb_build_object('code', 'invalid_existing_value'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'ok', jsonb_array_length(errors) = 0,
    'errors', errors,
    'field', local_field,
    'target', p_target,
    'schemaDefinitionId', p_schema_definition_id,
    'modelKey', p_model_key,
    'copiesValues', false,
    'historicalValuesRemainLocal', true
  );
END;
$$;

DROP FUNCTION IF EXISTS api.promote_local_field(uuid, uuid, text, uuid, text);
CREATE FUNCTION api.promote_local_field(
  p_instance_id uuid,
  p_field_id uuid,
  p_target text,
  p_schema_definition_id uuid,
  p_idempotency_key text,
  p_model_key text DEFAULT NULL,
  p_schema_version_id uuid DEFAULT NULL,
  p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  preview jsonb;
  local_field jsonb;
  digest text;
  replay jsonb;
  actor text := api.current_user_id();
  write_version api.dataset_schema_versions;
  source_id uuid;
  created api.record_field_definitions;
  result jsonb;
  fields jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'schema.edit');
  preview := api.preview_local_field_promotion(
    p_instance_id, p_field_id, p_target, p_schema_definition_id, p_model_key
  );
  IF (preview->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'local field values are incompatible with promotion' USING ERRCODE = 'SB071';
  END IF;
  local_field := preview->'field';
  digest := encode(sha256(convert_to(jsonb_build_object(
    'instance', p_instance_id,
    'field', p_field_id,
    'target', p_target,
    'schema', p_schema_definition_id,
    'modelKey', p_model_key,
    'schemaVersion', p_schema_version_id
  )::text, 'UTF8')), 'hex');
  replay := internal.replay_configuration_change(
    instance.workspace_id, actor, 'local_field_promotion', p_idempotency_key, digest
  );
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  IF p_target = 'model_field' THEN
    created := api.create_model_field(
      instance.workspace_id,
      p_model_key,
      local_field->>'key',
      local_field->>'label',
      local_field->>'logicalType',
      coalesce((local_field->>'nullable')::boolean, true),
      local_field->'defaultValue',
      coalesce(local_field->'validation','{}'::jsonb)
    );
    result := preview || jsonb_build_object(
      'ok', true,
      'targetKind', 'model_field',
      'targetId', created.id,
      'modelKey', p_model_key,
      'idempotent', false
    );
    PERFORM internal.record_configuration_change(
      instance.workspace_id, actor, 'local_field_promotion', p_idempotency_key, digest, result
    );
    RETURN result;
  END IF;
  IF p_target <> 'dataset_schema' THEN
    RAISE EXCEPTION 'unsupported promotion target' USING ERRCODE = '22023';
  END IF;
  IF p_schema_definition_id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Definition is required' USING ERRCODE = '22023';
  END IF;
  IF p_schema_version_id IS NOT NULL THEN
    SELECT * INTO write_version FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
    IF write_version.schema_id IS DISTINCT FROM p_schema_definition_id THEN
      RAISE EXCEPTION 'Dataset Schema Version does not belong to the Definition' USING ERRCODE = '22023';
    END IF;
    write_version := internal.lock_dataset_schema_write_version(p_schema_version_id, p_expected_revision);
  ELSE
    IF EXISTS (
      SELECT 1 FROM api.dataset_schema_versions
       WHERE schema_id = p_schema_definition_id AND lifecycle = 'draft'
    ) THEN
      RAISE EXCEPTION 'a draft Dataset Schema Version already exists' USING ERRCODE = 'SB072';
    END IF;
    SELECT id INTO source_id
      FROM api.dataset_schema_versions
     WHERE schema_id = p_schema_definition_id
     ORDER BY version DESC
     LIMIT 1;
    write_version := internal.fork_dataset_schema_version(source_id);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'field_id', field_id, 'key', key, 'label', label, 'description', description,
    'logical_type', logical_type, 'nullable', nullable, 'default_value', default_value,
    'quantity', quantity, 'validation', validation, 'category', category,
    'relationship', relationship, 'cardinality', cardinality, 'display_order', display_order
  ) ORDER BY display_order), '[]'::jsonb) INTO fields
    FROM api.dataset_schema_version_fields
   WHERE schema_version_id = write_version.id;
  fields := fields || jsonb_build_array(jsonb_build_object(
    'field_id', p_field_id,
    'key', local_field->>'key',
    'label', local_field->>'label',
    'description', local_field->>'description',
    'logical_type', local_field->>'logicalType',
    'nullable', (local_field->>'nullable')::boolean,
    'default_value', local_field->'defaultValue',
    'quantity', local_field->'quantity',
    'validation', coalesce(local_field->'validation','{}'::jsonb),
    'category', local_field->'category',
    'relationship', local_field->'relationship',
    'cardinality', coalesce(local_field->>'cardinality','one')
  ));
  PERFORM api.replace_dataset_schema_version_fields(write_version.id, fields);
  result := preview || jsonb_build_object(
    'ok', true,
    'targetKind', 'dataset_schema_field',
    'targetId', p_field_id,
    'schemaVersionId', write_version.id,
    'idempotent', false
  );
  PERFORM internal.record_configuration_change(
    instance.workspace_id, actor, 'local_field_promotion', p_idempotency_key, digest, result
  );
  RETURN result;
END;
$$;

DROP FUNCTION IF EXISTS api.promote_calculation(uuid, uuid, text, uuid, text);
CREATE FUNCTION api.promote_calculation(
  p_instance_id uuid,
  p_calculation_id uuid,
  p_target text,
  p_schema_definition_id uuid,
  p_idempotency_key text,
  p_schema_version_id uuid DEFAULT NULL,
  p_expected_revision bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  preview jsonb;
  calculation jsonb;
  digest text;
  replay jsonb;
  actor text := api.current_user_id();
  definition api.sheet_definitions;
  version api.sheet_definition_versions;
  config jsonb;
  column_id uuid;
  write_version api.dataset_schema_versions;
  source_id uuid;
  result jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'schema.edit');
  preview := api.preview_calculation_promotion(p_instance_id, p_calculation_id, p_target);
  IF (preview->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'calculation cannot be promoted: %', preview->>'reason' USING ERRCODE = 'SB071';
  END IF;
  calculation := preview->'calculation';
  digest := encode(sha256(convert_to(jsonb_build_object(
    'instance', p_instance_id,
    'calculation', p_calculation_id,
    'target', p_target,
    'schema', p_schema_definition_id,
    'schemaVersion', p_schema_version_id
  )::text, 'UTF8')), 'hex');
  replay := internal.replay_configuration_change(
    instance.workspace_id, actor, 'calculation_promotion', p_idempotency_key, digest
  );
  IF replay IS NOT NULL THEN RETURN replay; END IF;
  IF p_target = 'sheet_definition' THEN
    IF instance.source_definition_version_id IS NULL THEN
      RAISE EXCEPTION 'Instance has no pinned Sheet Definition to receive the calculation' USING ERRCODE = 'SB071';
    END IF;
    SELECT * INTO version FROM api.sheet_definition_versions WHERE id = instance.source_definition_version_id;
    SELECT * INTO definition FROM api.sheet_definitions WHERE id = version.definition_id;
    config := version.configuration;
    column_id := p_calculation_id;
    config := jsonb_set(config, '{columns}', coalesce(config->'columns','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', column_id,
      'field', coalesce(calculation->'outputField', jsonb_build_object(
        'fieldId', column_id,
        'key', calculation->>'key',
        'label', calculation->>'label',
        'description', null,
        'logicalType', 'decimal',
        'nullable', true,
        'defaultValue', null,
        'cardinality', 'one',
        'quantity', null,
        'validation', '{}'::jsonb,
        'category', null,
        'relationship', null,
        'computation', jsonb_build_object('mode', 'computed', 'expressionId', column_id),
        'lifecycle', 'active'
      )),
      'source', jsonb_build_object('kind', 'calculated', 'calculationId', column_id)
    )));
    IF config #> '{presentation,columnOrder}' IS NOT NULL THEN
      config := jsonb_set(
        config,
        '{presentation,columnOrder}',
        coalesce(config->'presentation'->'columnOrder', '[]'::jsonb) || jsonb_build_array(column_id)
      );
    END IF;
    config := jsonb_set(config, '{calculations}', coalesce(config->'calculations','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', calculation->>'id',
      'key', calculation->>'key',
      'label', calculation->>'label',
      'outputColumnId', column_id,
      'inputColumnIds', coalesce((
        SELECT jsonb_agg(dep->>'id') FROM jsonb_array_elements(calculation->'dependencies') dep
         WHERE dep->>'kind' = 'column'
      ), '[]'::jsonb),
      'expression', calculation->'expression'
    )));
    IF version.lifecycle = 'draft' THEN
      version := api.update_sheet_definition_draft(version.id, version.revision, config);
    ELSE
      version := api.create_sheet_definition_version(definition.id, definition.revision, config);
    END IF;
    result := preview || jsonb_build_object(
      'ok', true, 'targetKind', 'sheet_definition_version', 'targetId', version.id, 'idempotent', false
    );
  ELSIF p_target = 'dataset_schema' THEN
    IF p_schema_definition_id IS NULL THEN RAISE EXCEPTION 'Dataset Schema Definition is required' USING ERRCODE = '22023'; END IF;
    IF p_schema_version_id IS NOT NULL THEN
      SELECT * INTO write_version FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
      IF write_version.schema_id IS DISTINCT FROM p_schema_definition_id THEN
        RAISE EXCEPTION 'Dataset Schema Version does not belong to the Definition' USING ERRCODE = '22023';
      END IF;
      write_version := internal.lock_dataset_schema_write_version(p_schema_version_id, p_expected_revision);
    ELSE
      IF EXISTS (
        SELECT 1 FROM api.dataset_schema_versions
         WHERE schema_id = p_schema_definition_id AND lifecycle = 'draft'
      ) THEN
        RAISE EXCEPTION 'a draft Dataset Schema Version already exists' USING ERRCODE = 'SB072';
      END IF;
      SELECT id INTO source_id
        FROM api.dataset_schema_versions
       WHERE schema_id = p_schema_definition_id
       ORDER BY version DESC
       LIMIT 1;
      write_version := internal.fork_dataset_schema_version(source_id);
    END IF;
    PERFORM api.replace_dataset_schema_version_fields(
      write_version.id,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'field_id', field_id, 'key', key, 'label', label, 'logical_type', logical_type,
          'nullable', nullable, 'validation', validation, 'cardinality', cardinality,
          'display_order', display_order
        ) ORDER BY display_order)
        FROM api.dataset_schema_version_fields
        WHERE schema_version_id = write_version.id
      ), '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'field_id', p_calculation_id,
        'key', calculation->>'key',
        'label', calculation->>'label',
        'logical_type', coalesce(calculation->'outputField'->>'logicalType','decimal'),
        'nullable', true
      ))
    );
    result := preview || jsonb_build_object(
      'ok', true,
      'targetKind', 'dataset_schema_field',
      'targetId', p_calculation_id,
      'schemaVersionId', write_version.id,
      'storesFormula', false,
      'idempotent', false
    );
  ELSE
    RAISE EXCEPTION 'unsupported calculation promotion target' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.record_configuration_change(
    instance.workspace_id, actor, 'calculation_promotion', p_idempotency_key, digest, result
  );
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  api.preview_dataset_schema_evolution(uuid, jsonb),
  api.apply_dataset_schema_evolution(uuid, jsonb, text, bigint),
  api.preview_model_field_evolution(uuid, text, jsonb),
  api.apply_model_field_evolution(uuid, text, jsonb, boolean),
  api.preview_local_field_promotion(uuid, uuid, text, uuid, text),
  api.promote_local_field(uuid, uuid, text, uuid, text, text, uuid, bigint),
  api.preview_calculation_promotion(uuid, uuid, text),
  api.promote_calculation(uuid, uuid, text, uuid, text, uuid, bigint)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.preview_dataset_schema_evolution(uuid, jsonb),
  api.apply_dataset_schema_evolution(uuid, jsonb, text, bigint),
  api.preview_model_field_evolution(uuid, text, jsonb),
  api.apply_model_field_evolution(uuid, text, jsonb, boolean),
  api.preview_local_field_promotion(uuid, uuid, text, uuid, text),
  api.promote_local_field(uuid, uuid, text, uuid, text, text, uuid, bigint),
  api.preview_calculation_promotion(uuid, uuid, text),
  api.promote_calculation(uuid, uuid, text, uuid, text, uuid, bigint)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
