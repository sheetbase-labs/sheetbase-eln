-- CORE-05.5–05.8: governed evolution and explicit promotion on CORE-02.

CREATE TABLE api.configuration_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  kind text NOT NULL,
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  actor_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_configuration_change_log UNIQUE (workspace_id, kind, request_digest),
  CONSTRAINT chk_configuration_change_log_kind CHECK (kind IN (
    'model_field_evolution',
    'dataset_schema_evolution',
    'local_field_promotion',
    'calculation_promotion'
  ))
);
ALTER TABLE api.configuration_change_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY configuration_change_log_read ON api.configuration_change_log
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
GRANT SELECT ON api.configuration_change_log TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON api.configuration_change_log FROM PUBLIC, authenticated, api_client;

CREATE OR REPLACE FUNCTION internal.rank_change_class(p_class text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE p_class
    WHEN 'breaking' THEN 3
    WHEN 'migration-requiring' THEN 2
    WHEN 'compatible' THEN 1
    ELSE 0
  END
$$;

CREATE OR REPLACE FUNCTION internal.max_change_class(p_left text, p_right text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN internal.rank_change_class(p_left) >= internal.rank_change_class(p_right)
    THEN p_left ELSE p_right END
$$;

CREATE OR REPLACE FUNCTION internal.classify_dataset_schema_fields(
  p_base_version_id uuid,
  p_fields jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  classification text := 'compatible';
  changes jsonb := '[]'::jsonb;
  old_field api.dataset_schema_version_fields;
  new_field jsonb;
  new_ids uuid[] := '{}';
  v_field_id uuid;
  class text;
BEGIN
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Dataset Schema fields must be an array' USING ERRCODE = '22023';
  END IF;
  FOR new_field IN SELECT value FROM jsonb_array_elements(p_fields) LOOP
    v_field_id := coalesce(internal.collect_uuid(new_field->>'field_id'), internal.collect_uuid(new_field->>'fieldId'));
    IF v_field_id IS NULL THEN
      classification := internal.max_change_class(classification, 'compatible');
      changes := changes || jsonb_build_array(jsonb_build_object(
        'fieldId', NULL, 'key', coalesce(new_field->>'key',''), 'class',
        CASE WHEN coalesce((new_field->>'nullable')::boolean, true) THEN 'compatible' ELSE 'migration-requiring' END,
        'reason', 'added_field'
      ));
      IF NOT coalesce((new_field->>'nullable')::boolean, true) THEN
        classification := internal.max_change_class(classification, 'migration-requiring');
      END IF;
      CONTINUE;
    END IF;
    new_ids := array_append(new_ids, v_field_id);
    SELECT * INTO old_field FROM api.dataset_schema_version_fields
     WHERE schema_version_id = p_base_version_id AND api.dataset_schema_version_fields.field_id = v_field_id;
    IF old_field.id IS NULL THEN
      class := CASE WHEN coalesce((new_field->>'nullable')::boolean, true) THEN 'compatible' ELSE 'migration-requiring' END;
      classification := internal.max_change_class(classification, class);
      changes := changes || jsonb_build_array(jsonb_build_object('fieldId', v_field_id, 'class', class, 'reason', 'added_field'));
    ELSIF coalesce(new_field->>'logical_type', new_field->>'logicalType', old_field.logical_type) IS DISTINCT FROM old_field.logical_type
       OR coalesce(new_field->>'cardinality', old_field.cardinality) IS DISTINCT FROM old_field.cardinality
       OR (new_field ? 'quantity' AND new_field->'quantity' IS DISTINCT FROM old_field.quantity)
       OR (new_field ? 'relationship' AND new_field->'relationship' IS DISTINCT FROM old_field.relationship) THEN
      classification := 'breaking';
      changes := changes || jsonb_build_array(jsonb_build_object('fieldId', v_field_id, 'class', 'breaking', 'reason', 'semantic_identity_change'));
    ELSIF coalesce((new_field->>'nullable')::boolean, old_field.nullable) IS DISTINCT FROM old_field.nullable
          AND coalesce((new_field->>'nullable')::boolean, old_field.nullable) = false THEN
      classification := internal.max_change_class(classification, 'migration-requiring');
      changes := changes || jsonb_build_array(jsonb_build_object('fieldId', v_field_id, 'class', 'migration-requiring', 'reason', 'required_tightening'));
    ELSIF (new_field ? 'validation' AND new_field->'validation' IS DISTINCT FROM to_jsonb(old_field.validation)) THEN
      classification := internal.max_change_class(classification, 'migration-requiring');
      changes := changes || jsonb_build_array(jsonb_build_object('fieldId', v_field_id, 'class', 'migration-requiring', 'reason', 'validation_change'));
    ELSE
      changes := changes || jsonb_build_array(jsonb_build_object('fieldId', v_field_id, 'class', 'compatible', 'reason', 'metadata'));
    END IF;
  END LOOP;
  FOR old_field IN SELECT * FROM api.dataset_schema_version_fields WHERE schema_version_id = p_base_version_id LOOP
    IF NOT (old_field.field_id = ANY (new_ids)) THEN
      classification := internal.max_change_class(classification, 'breaking');
      changes := changes || jsonb_build_array(jsonb_build_object(
        'fieldId', old_field.field_id, 'class', 'breaking', 'reason', 'removed_field'
      ));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('classification', classification, 'changes', changes);
END;
$$;

CREATE OR REPLACE FUNCTION api.preview_dataset_schema_evolution(
  p_schema_version_id uuid,
  p_fields jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
  classified jsonb;
  impact jsonb;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
  SELECT s.workspace_id INTO workspace FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(workspace, 'schema.edit');
  classified := internal.classify_dataset_schema_fields(version.id, p_fields);
  impact := api.discover_object_dependencies('dataset_schema_version', version.id);
  RETURN classified || jsonb_build_object(
    'baseSchemaVersionId', version.id,
    'impact', impact->'dependencies',
    'advancesLiveDatasets', false,
    'note', 'Live Datasets remain bound to the previous Schema Version until explicitly rebound.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.apply_dataset_schema_evolution(
  p_schema_version_id uuid,
  p_fields jsonb,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
  actor text := api.current_user_id();
  digest text;
  existing api.configuration_change_log;
  preview jsonb;
  next_version jsonb;
  published api.dataset_schema_versions;
  result jsonb;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id;
  SELECT s.workspace_id INTO workspace FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(workspace, 'schema.publish');
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'valid idempotency key is required' USING ERRCODE = '22023';
  END IF;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'base', p_schema_version_id, 'fields', p_fields
  )::text, 'UTF8')), 'hex');
  SELECT * INTO existing FROM api.configuration_change_log
   WHERE workspace_id = workspace AND kind = 'dataset_schema_evolution' AND request_digest = digest;
  IF existing.id IS NOT NULL THEN
    RETURN existing.result || jsonb_build_object('idempotent', true);
  END IF;
  preview := api.preview_dataset_schema_evolution(p_schema_version_id, p_fields);
  next_version := api.create_next_dataset_schema_version(version.schema_id);
  PERFORM api.replace_dataset_schema_version_fields((next_version->>'schema_version_id')::uuid, p_fields);
  published := api.publish_dataset_schema_version((next_version->>'schema_version_id')::uuid);
  result := preview || jsonb_build_object(
    'ok', true,
    'schemaVersionId', published.id,
    'version', published.version,
    'idempotent', false
  );
  INSERT INTO api.configuration_change_log(workspace_id, kind, request_digest, result, actor_user_id)
  VALUES (workspace, 'dataset_schema_evolution', digest, result, actor);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION api.preview_model_field_evolution(
  p_definition_id uuid,
  p_action text,
  p_patch jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  field api.record_field_definitions;
  classification text := 'compatible';
  reason text := 'metadata';
  impact jsonb;
BEGIN
  SELECT * INTO field FROM api.record_field_definitions WHERE id = p_definition_id;
  IF field.id IS NULL THEN RAISE EXCEPTION 'Model field not found' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(field.workspace_id, 'schema.edit');
  IF p_action = 'retire' THEN
    classification := 'migration-requiring';
    reason := 'retire_field';
  ELSIF p_action = 'update' THEN
    IF p_patch ?| ARRAY['logicalType','logical_type','key','field_name'] THEN
      classification := 'breaking';
      reason := 'identity_change_blocked';
    ELSIF field.lifecycle IN ('active','retired') AND p_patch ?| ARRAY['nullable','defaultValue','validation'] THEN
      classification := 'breaking';
      reason := 'active_contract_immutable';
    ELSE
      classification := 'compatible';
      reason := 'metadata';
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported Model field action' USING ERRCODE = '22023';
  END IF;
  impact := api.discover_object_dependencies('model_field', field.id);
  RETURN jsonb_build_object(
    'classification', classification,
    'reason', reason,
    'blocked', classification = 'breaking',
    'impact', impact->'dependencies'
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.apply_model_field_evolution(
  p_definition_id uuid,
  p_action text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_confirm boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  preview jsonb;
  field api.record_field_definitions;
BEGIN
  preview := api.preview_model_field_evolution(p_definition_id, p_action, p_patch);
  IF (preview->>'blocked')::boolean THEN
    RAISE EXCEPTION 'destructive Model field change is blocked' USING ERRCODE = 'SB072';
  END IF;
  IF preview->>'classification' = 'migration-requiring' AND p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'consequential Model field change requires confirmation' USING ERRCODE = 'SB071';
  END IF;
  IF p_action = 'retire' THEN
    field := api.retire_model_field(p_definition_id);
  ELSE
    field := api.update_model_field(p_definition_id, p_patch);
  END IF;
  RETURN preview || jsonb_build_object('ok', true, 'field', to_jsonb(field));
END;
$$;

CREATE OR REPLACE FUNCTION api.preview_local_field_promotion(
  p_instance_id uuid,
  p_field_id uuid,
  p_target text,
  p_schema_definition_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  local_field jsonb;
  value jsonb;
  errors jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT item INTO local_field
    FROM jsonb_array_elements(coalesce(instance.state->'localFields','[]'::jsonb)) item
   WHERE item->>'fieldId' = p_field_id::text AND item->>'lifecycle' = 'active';
  IF local_field IS NULL THEN RAISE EXCEPTION 'local field not found' USING ERRCODE = '22023'; END IF;
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
    'copiesValues', false,
    'historicalValuesRemainLocal', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.promote_local_field(
  p_instance_id uuid,
  p_field_id uuid,
  p_target text,
  p_schema_definition_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  preview jsonb;
  local_field jsonb;
  digest text;
  existing api.configuration_change_log;
  actor text := api.current_user_id();
  next_version jsonb;
  created api.record_field_definitions;
  result jsonb;
  fields jsonb;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL THEN RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(instance.workspace_id, 'schema.edit');
  preview := api.preview_local_field_promotion(p_instance_id, p_field_id, p_target, p_schema_definition_id);
  IF (preview->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'local field values are incompatible with promotion' USING ERRCODE = 'SB071';
  END IF;
  local_field := preview->'field';
  digest := encode(sha256(convert_to(jsonb_build_object(
    'instance', p_instance_id, 'field', p_field_id, 'target', p_target, 'schema', p_schema_definition_id
  )::text, 'UTF8')), 'hex');
  SELECT * INTO existing FROM api.configuration_change_log
   WHERE workspace_id = instance.workspace_id AND kind = 'local_field_promotion' AND request_digest = digest;
  IF existing.id IS NOT NULL THEN RETURN existing.result || jsonb_build_object('idempotent', true); END IF;
  IF p_target = 'dataset_schema' THEN
    IF p_schema_definition_id IS NULL THEN RAISE EXCEPTION 'Dataset Schema Definition is required' USING ERRCODE = '22023'; END IF;
    next_version := api.create_next_dataset_schema_version(p_schema_definition_id);
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'field_id', field_id, 'key', key, 'label', label, 'description', description,
      'logical_type', logical_type, 'nullable', nullable, 'default_value', default_value,
      'quantity', quantity, 'validation', validation, 'category', category,
      'relationship', relationship, 'cardinality', cardinality, 'display_order', display_order
    ) ORDER BY display_order), '[]'::jsonb) INTO fields
      FROM api.dataset_schema_version_fields
     WHERE schema_version_id = (next_version->>'schema_version_id')::uuid;
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
    PERFORM api.replace_dataset_schema_version_fields((next_version->>'schema_version_id')::uuid, fields);
    result := preview || jsonb_build_object(
      'ok', true,
      'targetKind', 'dataset_schema_field',
      'targetId', p_field_id,
      'schemaVersionId', next_version->>'schema_version_id',
      'idempotent', false
    );
  ELSIF p_target = 'model_field' THEN
    created := api.create_model_field(
      instance.workspace_id,
      'sample',
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
      'idempotent', false
    );
  ELSE
    RAISE EXCEPTION 'unsupported promotion target' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.configuration_change_log(workspace_id, kind, request_digest, result, actor_user_id)
  VALUES (instance.workspace_id, 'local_field_promotion', digest, result, actor);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION api.preview_calculation_promotion(
  p_instance_id uuid,
  p_calculation_id uuid,
  p_target text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  calculation jsonb;
  dependency jsonb;
  has_local boolean := false;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  SELECT item INTO calculation
    FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations','[]'::jsonb)) item
   WHERE item->>'id' = p_calculation_id::text AND item->>'lifecycle' = 'active';
  IF calculation IS NULL THEN RAISE EXCEPTION 'Instance calculation not found' USING ERRCODE = '22023'; END IF;
  FOR dependency IN SELECT value FROM jsonb_array_elements(coalesce(calculation->'dependencies','[]'::jsonb)) LOOP
    IF dependency->>'kind' IN ('local-field','calculation') THEN has_local := true; END IF;
  END LOOP;
  IF has_local THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'incompatible_local_dependency',
      'calculation', calculation
    );
  END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'target', p_target,
    'calculation', calculation,
    'requiresDefinitionDraft', p_target = 'sheet_definition'
  );
END;
$$;

CREATE OR REPLACE FUNCTION api.promote_calculation(
  p_instance_id uuid,
  p_calculation_id uuid,
  p_target text,
  p_schema_definition_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  instance api.sheet_instances;
  preview jsonb;
  calculation jsonb;
  digest text;
  existing api.configuration_change_log;
  actor text := api.current_user_id();
  definition api.sheet_definitions;
  version api.sheet_definition_versions;
  config jsonb;
  column_id uuid;
  next_version jsonb;
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
    'instance', p_instance_id, 'calculation', p_calculation_id, 'target', p_target
  )::text, 'UTF8')), 'hex');
  SELECT * INTO existing FROM api.configuration_change_log
   WHERE workspace_id = instance.workspace_id AND kind = 'calculation_promotion' AND request_digest = digest;
  IF existing.id IS NOT NULL THEN RETURN existing.result || jsonb_build_object('idempotent', true); END IF;
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
    next_version := api.create_next_dataset_schema_version(p_schema_definition_id);
    PERFORM api.replace_dataset_schema_version_fields(
      (next_version->>'schema_version_id')::uuid,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'field_id', field_id, 'key', key, 'label', label, 'logical_type', logical_type,
          'nullable', nullable, 'validation', validation, 'cardinality', cardinality,
          'display_order', display_order
        ) ORDER BY display_order)
        FROM api.dataset_schema_version_fields
        WHERE schema_version_id = (next_version->>'schema_version_id')::uuid
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
      'schemaVersionId', next_version->>'schema_version_id',
      'storesFormula', false,
      'idempotent', false
    );
  ELSE
    RAISE EXCEPTION 'unsupported calculation promotion target' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.configuration_change_log(workspace_id, kind, request_digest, result, actor_user_id)
  VALUES (instance.workspace_id, 'calculation_promotion', digest, result, actor);
  RETURN result;
END;
$$;

REVOKE EXECUTE ON FUNCTION
  internal.rank_change_class(text),
  internal.max_change_class(text, text),
  internal.classify_dataset_schema_fields(uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;
REVOKE EXECUTE ON FUNCTION
  api.preview_dataset_schema_evolution(uuid, jsonb),
  api.apply_dataset_schema_evolution(uuid, jsonb, text),
  api.preview_model_field_evolution(uuid, text, jsonb),
  api.apply_model_field_evolution(uuid, text, jsonb, boolean),
  api.preview_local_field_promotion(uuid, uuid, text, uuid),
  api.promote_local_field(uuid, uuid, text, uuid, text),
  api.preview_calculation_promotion(uuid, uuid, text),
  api.promote_calculation(uuid, uuid, text, uuid, text)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.preview_dataset_schema_evolution(uuid, jsonb),
  api.apply_dataset_schema_evolution(uuid, jsonb, text),
  api.preview_model_field_evolution(uuid, text, jsonb),
  api.apply_model_field_evolution(uuid, text, jsonb, boolean),
  api.preview_local_field_promotion(uuid, uuid, text, uuid),
  api.promote_local_field(uuid, uuid, text, uuid, text),
  api.preview_calculation_promotion(uuid, uuid, text),
  api.promote_calculation(uuid, uuid, text, uuid, text)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
