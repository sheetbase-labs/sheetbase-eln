-- H2: explicit preview/apply so an ad-hoc Sheet Instance can adopt a published
-- Definition Version in place. Instance UUID, Notebook block, local fields,
-- local values and Instance calculations are preserved. Unmatched local UUID
-- rows remain as local-only keys when composed row identity is Dataset-backed.

CREATE TABLE api.sheet_instance_composition_adoptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE RESTRICT,
  instance_id uuid NOT NULL REFERENCES api.sheet_instances(id) ON DELETE RESTRICT,
  target_definition_version_id uuid NOT NULL REFERENCES api.sheet_definition_versions(id) ON DELETE RESTRICT,
  source_instance_revision bigint NOT NULL,
  resulting_instance_revision bigint NOT NULL,
  retry_token uuid NOT NULL,
  request_digest text NOT NULL,
  unmatched_local_row_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  actor_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE RESTRICT,
  adopted_at timestamptz NOT NULL DEFAULT now(),
  result jsonb NOT NULL,
  CONSTRAINT uq_sheet_instance_composition_adoption_retry
    UNIQUE (instance_id, retry_token),
  CONSTRAINT chk_sheet_instance_composition_adoption_revisions
    CHECK (source_instance_revision > 0 AND resulting_instance_revision = source_instance_revision + 1),
  CONSTRAINT chk_sheet_instance_composition_adoption_digest
    CHECK (request_digest ~ '^[0-9a-f]{64}$')
);

ALTER TABLE api.sheet_instance_composition_adoptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api.sheet_instance_composition_adoptions FROM PUBLIC, authenticated, api_client;
GRANT SELECT ON api.sheet_instance_composition_adoptions TO authenticated;
CREATE POLICY sheet_instance_composition_adoptions_read
  ON api.sheet_instance_composition_adoptions
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );

CREATE FUNCTION internal.sheet_instance_unmatched_local_row_keys(p_state jsonb, p_identity_kind text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_identity_kind IN ('source', 'composite') THEN coalesce((
      SELECT jsonb_agg(key ORDER BY key)
      FROM jsonb_object_keys(coalesce(p_state->'localValues', '{}'::jsonb)) key
      WHERE key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ), '[]'::jsonb)
    ELSE '[]'::jsonb
  END
$$;

CREATE FUNCTION internal.build_sheet_instance_composition_adoption_state(
  p_instance api.sheet_instances,
  p_target_definition_version_id uuid,
  p_parameter_inputs jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  target_version api.sheet_definition_versions;
  definition api.sheet_definitions;
  config jsonb;
  resolved jsonb;
  identity jsonb;
  first_identity_column jsonb;
  presentation jsonb;
  ordered_ids text[] := '{}';
  target_id text;
  new_state jsonb;
BEGIN
  IF p_instance.source_definition_version_id IS NOT NULL
     OR p_instance.state->'provenance'->>'createdFrom' IS DISTINCT FROM 'ad_hoc' THEN
    RAISE EXCEPTION 'only ad-hoc Sheet Instances can adopt a composition contract'
      USING ERRCODE = 'SB104';
  END IF;
  SELECT * INTO target_version
    FROM api.sheet_definition_versions
   WHERE id = p_target_definition_version_id;
  IF target_version.id IS NULL THEN
    RAISE EXCEPTION 'source Definition Version must be published, active, and in this workspace'
      USING ERRCODE = 'SB074';
  END IF;
  SELECT * INTO definition FROM api.sheet_definitions WHERE id = target_version.definition_id;
  IF definition.workspace_id IS DISTINCT FROM p_instance.workspace_id
     OR definition.lifecycle <> 'active'
     OR target_version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'source Definition Version must be published, active, and in this workspace'
      USING ERRCODE = 'SB074';
  END IF;
  config := target_version.configuration;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_instance.state->'localFields') local_field
      JOIN jsonb_array_elements(config->'columns') column_item
        ON column_item->>'id' = local_field->>'fieldId'
        OR column_item->'field'->>'fieldId' = local_field->>'fieldId'
  ) THEN
    RAISE EXCEPTION 'local field identity collides with the target Definition'
      USING ERRCODE = 'SB104';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_instance.state->'localFields') local_field
      JOIN jsonb_array_elements(config->'columns') column_item
        ON column_item->'field'->>'key' = local_field->>'key'
     WHERE local_field->>'lifecycle' = 'active'
  ) THEN
    RAISE EXCEPTION 'local field key collides with the target Definition'
      USING ERRCODE = 'SB104';
  END IF;
  resolved := internal.resolve_sheet_parameters(
    p_instance.workspace_id,
    p_target_definition_version_id,
    coalesce(p_parameter_inputs, '[]'::jsonb)
  );
  identity := config->'rowIdentity';
  SELECT value INTO first_identity_column
    FROM jsonb_array_elements(config->'columns')
   WHERE value->>'id' = identity->'columnIds'->>0;
  identity := identity || jsonb_build_object(
    'formatVersion', 1,
    'logicalTypes', (
      SELECT jsonb_agg(column_item->'field'->>'logicalType' ORDER BY ids.ordinality)
        FROM jsonb_array_elements(identity->'columnIds') WITH ORDINALITY ids
        JOIN LATERAL jsonb_array_elements(config->'columns') column_item
          ON column_item->>'id' = ids.value#>>'{}'
    ),
    'sourceBindingId', CASE
      WHEN identity->>'kind' = 'source' THEN first_identity_column->'source'->>'bindingId'
      ELSE NULL
    END,
    'sourceFieldId', CASE
      WHEN identity->>'kind' = 'source' THEN first_identity_column->'source'->>'sourceFieldId'
      ELSE NULL
    END
  );
  presentation := coalesce(p_instance.state->'presentation', '{}'::jsonb);
  ordered_ids := ARRAY(
    SELECT value FROM jsonb_array_elements_text(coalesce(presentation->'columnOrder', '[]'::jsonb))
  );
  FOR target_id IN SELECT value->>'id' FROM jsonb_array_elements(config->'columns') LOOP
    IF target_id <> ALL (ordered_ids) THEN
      ordered_ids := array_append(ordered_ids, target_id);
    END IF;
  END LOOP;
  presentation := jsonb_set(presentation, '{columnOrder}', to_jsonb(ordered_ids), true);
  new_state := (
    p_instance.state
    - 'bindings'
    - 'parameterValues'
    - 'provenance'
    - 'resolutionProvenance'
    - 'resolvedRowIdentity'
  ) || resolved || jsonb_build_object(
    'provenance', jsonb_build_object('createdFrom', 'definition_version'),
    'resolvedRowIdentity', identity,
    'presentation', presentation
  );
  PERFORM internal.validate_sheet_instance_state(new_state);
  PERFORM internal.validate_sheet_instance_presentation(p_target_definition_version_id, new_state);
  PERFORM internal.validate_sheet_instance_calculation_dependencies(
    p_target_definition_version_id,
    new_state
  );
  RETURN new_state;
END
$$;

CREATE FUNCTION api.preview_sheet_instance_composition_adoption(
  p_instance_id uuid,
  p_expected_instance_revision bigint,
  p_target_definition_version_id uuid,
  p_parameter_inputs jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  instance api.sheet_instances;
  target_version api.sheet_definition_versions;
  definition api.sheet_definitions;
  new_state jsonb;
  identity_kind text;
  compatible boolean := true;
  error_code text;
  error_message text;
BEGIN
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR SHARE;
  IF instance.id IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  IF instance.lifecycle <> 'active' OR instance.revision <> p_expected_instance_revision THEN
    RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE = 'SB073';
  END IF;
  SELECT * INTO target_version FROM api.sheet_definition_versions WHERE id = p_target_definition_version_id;
  SELECT * INTO definition FROM api.sheet_definitions WHERE id = target_version.definition_id;
  BEGIN
    new_state := internal.build_sheet_instance_composition_adoption_state(
      instance,
      p_target_definition_version_id,
      p_parameter_inputs
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS error_code = RETURNED_SQLSTATE, error_message = MESSAGE_TEXT;
    IF error_code IN ('SB073', 'SB074', 'SB083', 'SB104', '22023') THEN
      compatible := false;
      new_state := NULL;
    ELSE
      RAISE;
    END IF;
  END;
  identity_kind := coalesce(
    new_state->'resolvedRowIdentity'->>'kind',
    target_version.configuration->'rowIdentity'->>'kind'
  );
  RETURN jsonb_build_object(
    'instanceId', instance.id,
    'instanceRevision', instance.revision,
    'notebookRecordId', instance.notebook_record_id,
    'compatible', compatible,
    'errorCode', error_code,
    'errorMessage', error_message,
    'target', jsonb_build_object(
      'definitionId', definition.id,
      'versionId', target_version.id,
      'version', target_version.version,
      'workspaceId', definition.workspace_id
    ),
    'unmatchedLocalRowKeys', internal.sheet_instance_unmatched_local_row_keys(
      instance.state,
      identity_kind
    ),
    'preserved', jsonb_build_object(
      'instanceId', instance.id,
      'notebookRecordId', instance.notebook_record_id,
      'localFieldIds', coalesce((
        SELECT jsonb_agg(value->>'fieldId' ORDER BY ordinality)
        FROM jsonb_array_elements(instance.state->'localFields') WITH ORDINALITY item(value, ordinality)
      ), '[]'::jsonb),
      'localValueRowCount', (
        SELECT count(*) FROM jsonb_object_keys(coalesce(instance.state->'localValues', '{}'::jsonb))
      ),
      'instanceCalculationIds', coalesce((
        SELECT jsonb_agg(value->>'id' ORDER BY ordinality)
        FROM jsonb_array_elements(coalesce(instance.state->'instanceCalculations', '[]'::jsonb))
          WITH ORDINALITY item(value, ordinality)
      ), '[]'::jsonb)
    )
  );
END
$$;

CREATE FUNCTION api.apply_sheet_instance_composition_adoption(
  p_instance_id uuid,
  p_expected_instance_revision bigint,
  p_target_definition_version_id uuid,
  p_parameter_inputs jsonb,
  p_retry_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  instance api.sheet_instances;
  actor text := api.current_user_id();
  digest text;
  prior api.sheet_instance_composition_adoptions;
  new_state jsonb;
  unmatched jsonb;
  preview jsonb;
  result jsonb;
BEGIN
  IF p_retry_token IS NULL THEN
    RAISE EXCEPTION 'retry token is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO instance FROM api.sheet_instances WHERE id = p_instance_id FOR UPDATE;
  IF instance.id IS NULL OR actor IS NULL OR NOT api.is_workspace_member(instance.workspace_id) THEN
    RAISE EXCEPTION 'workspace member required' USING ERRCODE = '42501';
  END IF;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'instanceId', p_instance_id,
    'expectedRevision', p_expected_instance_revision,
    'targetDefinitionVersionId', p_target_definition_version_id,
    'parameterInputs', coalesce(p_parameter_inputs, '[]'::jsonb)
  )::text, 'UTF8')), 'hex');
  SELECT * INTO prior
    FROM api.sheet_instance_composition_adoptions
   WHERE instance_id = p_instance_id AND retry_token = p_retry_token;
  IF prior.id IS NOT NULL THEN
    IF prior.request_digest <> digest OR prior.actor_user_id <> actor THEN
      RAISE EXCEPTION 'retry token was used for a different composition adoption'
        USING ERRCODE = '23505';
    END IF;
    RETURN prior.result || jsonb_build_object('idempotent', true);
  END IF;
  IF instance.lifecycle <> 'active' OR instance.revision <> p_expected_instance_revision THEN
    RAISE EXCEPTION 'Sheet Instance revision conflict or archive' USING ERRCODE = 'SB073';
  END IF;
  preview := api.preview_sheet_instance_composition_adoption(
    p_instance_id,
    p_expected_instance_revision,
    p_target_definition_version_id,
    p_parameter_inputs
  );
  IF coalesce((preview->>'compatible')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION '%', coalesce(preview->>'errorMessage', 'incompatible composition adoption')
      USING ERRCODE = coalesce(preview->>'errorCode', 'SB104');
  END IF;
  new_state := internal.build_sheet_instance_composition_adoption_state(
    instance,
    p_target_definition_version_id,
    p_parameter_inputs
  );
  unmatched := internal.sheet_instance_unmatched_local_row_keys(
    instance.state,
    new_state->'resolvedRowIdentity'->>'kind'
  );
  PERFORM set_config('sheetbase.sheet_instance_write', 'rpc-v1', true);
  PERFORM set_config('sheetbase.sheet_instance_upgrade', 'rpc-v1', true);
  UPDATE api.sheet_instances
     SET source_definition_version_id = p_target_definition_version_id,
         state = new_state,
         revision = revision + 1,
         updated_at = now(),
         updated_by_user_id = actor
   WHERE id = instance.id
  RETURNING * INTO instance;
  result := jsonb_build_object(
    'status', 'applied',
    'idempotent', false,
    'preview', preview,
    'instance', to_jsonb(instance),
    'unmatchedLocalRowKeys', unmatched
  );
  INSERT INTO api.sheet_instance_composition_adoptions (
    workspace_id, instance_id, target_definition_version_id,
    source_instance_revision, resulting_instance_revision,
    retry_token, request_digest, unmatched_local_row_keys, actor_user_id, result
  ) VALUES (
    instance.workspace_id, instance.id, p_target_definition_version_id,
    p_expected_instance_revision, instance.revision,
    p_retry_token, digest, unmatched, actor, result
  );
  RETURN result;
END
$$;

REVOKE EXECUTE ON FUNCTION
  internal.sheet_instance_unmatched_local_row_keys(jsonb, text),
  internal.build_sheet_instance_composition_adoption_state(api.sheet_instances, uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;
REVOKE EXECUTE ON FUNCTION
  api.preview_sheet_instance_composition_adoption(uuid, bigint, uuid, jsonb),
  api.apply_sheet_instance_composition_adoption(uuid, bigint, uuid, jsonb, uuid)
  FROM PUBLIC, api_client;
GRANT EXECUTE ON FUNCTION
  api.preview_sheet_instance_composition_adoption(uuid, bigint, uuid, jsonb),
  api.apply_sheet_instance_composition_adoption(uuid, bigint, uuid, jsonb, uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
