-- CORE-04.4 / 04.7: atomic create+link and all-or-nothing Sheet Record commit.
-- Browser/session only. Not granted to api_client. DEFINER with membership
-- recheck. Failed write-back rolls back newly created Records.

CREATE TABLE api.sheet_record_bulk_commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  project_id uuid NOT NULL REFERENCES api.projects(id) ON DELETE cascade,
  actor_user_id text NOT NULL REFERENCES internal.user(id) ON DELETE restrict,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sheet_record_bulk_commits_actor_idempotency
    UNIQUE (workspace_id, actor_user_id, idempotency_key),
  CONSTRAINT chk_sheet_record_bulk_commits_idempotency_key
    CHECK (length(idempotency_key) BETWEEN 1 AND 128),
  CONSTRAINT chk_sheet_record_bulk_commits_request_digest
    CHECK (request_digest ~ '^[0-9a-f]{64}$')
);
ALTER TABLE api.sheet_record_bulk_commits ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON api.sheet_record_bulk_commits TO authenticated;
CREATE POLICY sheet_record_bulk_commits_read ON api.sheet_record_bulk_commits
  FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));

CREATE FUNCTION internal.create_sheet_model_record(
  p_workspace uuid,
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_custom_fields jsonb
) RETURNS api.records
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  prefix text;
  year text := to_char(now(), 'YYYY');
  sequence integer;
  generated_identifier text;
  result api.records;
BEGIN
  prefix := CASE p_kind
    WHEN 'experiment' THEN 'EXP'
    WHEN 'protocol_template' THEN 'PRT'
    WHEN 'report' THEN 'RPT'
    WHEN 'sample' THEN 'SMP'
    WHEN 'reagent' THEN 'RGT'
    WHEN 'file' THEN 'FILE'
    WHEN 'notebook_template' THEN 'NBK'
    ELSE NULL
  END;
  IF prefix IS NULL THEN
    RAISE EXCEPTION 'unsupported record kind: %', p_kind USING ERRCODE = '23514';
  END IF;
  LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) + 1 INTO sequence
    FROM api.records
   WHERE project_id = p_project_id AND identifier LIKE prefix || '-' || year || '-%';
  generated_identifier := prefix || '-' || year || '-' || lpad(sequence::text, 4, '0');
  INSERT INTO api.records (
    workspace_id, project_id, kind, identifier, title, status, tags, properties,
    custom_fields, created_by_user_id
  ) VALUES (
    p_workspace, p_project_id, p_kind, generated_identifier,
    coalesce(nullif(btrim(p_title), ''), generated_identifier),
    'available', '{}', '{}', coalesce(p_custom_fields, '{}'), api.current_user_id()
  ) RETURNING * INTO result;
  RETURN result;
END
$$;
REVOKE EXECUTE ON FUNCTION internal.create_sheet_model_record(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, authenticated, api_client;

CREATE FUNCTION internal.write_sheet_record_reference(
  p_workspace uuid,
  p_record_id uuid,
  p_target jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  dataset api.datasets;
  existing_row api.dataset_rows;
  field api.dataset_schema_version_fields;
  v_row_id uuid;
  v_field_id uuid;
  instance api.sheet_instances;
  model_record api.records;
BEGIN
  IF jsonb_typeof(p_target) <> 'object' OR p_target->>'kind' IS NULL THEN
    RAISE EXCEPTION 'sheet write-back target is required' USING ERRCODE = '22023';
  END IF;
  IF p_target->>'kind' = 'dataset' THEN
    SELECT * INTO dataset FROM api.datasets
     WHERE id = (p_target->>'datasetId')::uuid AND workspace_id = p_workspace
     FOR UPDATE;
    IF dataset.id IS NULL OR dataset.lifecycle <> 'active' THEN
      RAISE EXCEPTION 'dataset write-back target denied' USING ERRCODE = '42501';
    END IF;
    IF dataset.revision <> (p_target->>'expectedDatasetRevision')::bigint THEN
      RAISE EXCEPTION 'stale dataset revision' USING ERRCODE = 'SB001';
    END IF;
    v_row_id := (p_target->>'rowId')::uuid;
    v_field_id := (p_target->>'fieldId')::uuid;
    SELECT * INTO existing_row FROM api.dataset_rows
     WHERE id = v_row_id AND dataset_id = dataset.id FOR UPDATE;
    IF existing_row.id IS NULL THEN
      RAISE EXCEPTION 'dataset row missing' USING ERRCODE = '22023';
    END IF;
    IF existing_row.revision <> (p_target->>'expectedRowRevision')::bigint THEN
      RAISE EXCEPTION 'stale row revision' USING ERRCODE = 'SB001';
    END IF;
    SELECT * INTO field FROM api.dataset_schema_version_fields
     WHERE schema_version_id = dataset.schema_version_id
       AND field_id = v_field_id AND lifecycle = 'active';
    IF field.id IS NULL OR field.logical_type <> 'reference' THEN
      RAISE EXCEPTION 'write-back field is not an active reference' USING ERRCODE = '22023';
    END IF;
    DELETE FROM api.dataset_row_values WHERE row_id = v_row_id AND field_id = v_field_id;
    INSERT INTO api.dataset_row_values (row_id, field_id, ordinal, reference_id)
    VALUES (v_row_id, v_field_id, 0, p_record_id);
    UPDATE api.dataset_rows SET revision = revision + 1, updated_at = now() WHERE id = v_row_id;
    UPDATE api.datasets SET revision = revision + 1, updated_at = now() WHERE id = dataset.id;
  ELSIF p_target->>'kind' = 'local' THEN
    PERFORM api.mutate_sheet_instance_local_state(
      (p_target->>'instanceId')::uuid,
      (p_target->>'expectedRevision')::bigint,
      gen_random_uuid(),
      '[]'::jsonb,
      jsonb_build_array(jsonb_build_object(
        'kind', 'composed',
        'rowKey', p_target->>'rowKey',
        'identityValues', p_target->'identityValues',
        'compositionOffset', coalesce((p_target->>'compositionOffset')::integer, 0)
      )),
      jsonb_build_array(jsonb_build_object(
        'rowKey', p_target->>'rowKey',
        'fieldId', p_target->>'fieldId',
        'value', to_jsonb(p_record_id::text)
      ))
    );
  ELSIF p_target->>'kind' = 'model' THEN
    SELECT * INTO model_record FROM api.records
     WHERE id = (p_target->>'recordId')::uuid AND workspace_id = p_workspace
     FOR UPDATE;
    IF model_record.id IS NULL THEN
      RAISE EXCEPTION 'model write-back record denied' USING ERRCODE = '42501';
    END IF;
    IF model_record.metadata_version <> (p_target->>'expectedMetadataVersion')::integer THEN
      RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE = 'SB001';
    END IF;
    UPDATE api.records
       SET custom_fields = custom_fields || jsonb_build_object(p_target->>'fieldName', p_record_id::text),
           metadata_version = metadata_version + 1,
           updated_at = now(),
           updated_by_user_id = api.current_user_id()
     WHERE id = model_record.id;
  ELSE
    RAISE EXCEPTION 'unknown sheet write-back kind' USING ERRCODE = '22023';
  END IF;
END
$$;
REVOKE EXECUTE ON FUNCTION internal.write_sheet_record_reference(uuid, uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;

CREATE FUNCTION api.create_and_link_sheet_record(
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
  IF workspace IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'active workspace membership required' USING ERRCODE = '42501';
  END IF;
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
REVOKE EXECUTE ON FUNCTION api.create_and_link_sheet_record(uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.create_and_link_sheet_record(uuid, text, text, jsonb, jsonb)
  TO authenticated;

CREATE FUNCTION api.commit_sheet_record_batch(
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
  IF workspace IS NULL OR actor IS NULL OR NOT api.is_workspace_member(workspace) THEN
    RAISE EXCEPTION 'active workspace membership required' USING ERRCODE = '42501';
  END IF;
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
REVOKE EXECUTE ON FUNCTION api.commit_sheet_record_batch(uuid, text, jsonb, text)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.commit_sheet_record_batch(uuid, text, jsonb, text)
  TO authenticated;
NOTIFY pgrst, 'reload schema';
