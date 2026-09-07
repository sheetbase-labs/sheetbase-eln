-- Keep authored actions within the governed operation catalogue.
CREATE OR REPLACE FUNCTION internal.pipeline_action_errors(p_actions jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $fn$
DECLARE
  v_catalogue constant jsonb := $catalogue$[{"operation":"create_project","rpc":"create_project","label":"Create project","description":"Create a project in the run workspace.","arguments":[{"name":"p_title","type":"text","required":true,"nullable":false}]},{"operation":"create_model_record","rpc":"create_model_record","label":"Create record","description":"Create an experiment, sample, reagent, report or supported model record in a project.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_kind","type":"text","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_tags","type":"text[]","required":false,"nullable":false},{"name":"p_properties","type":"jsonb","required":false,"nullable":false},{"name":"p_custom_fields","type":"jsonb","required":false,"nullable":false}]},{"operation":"update_record_custom_fields","rpc":"update_record_custom_fields","label":"Update record properties","description":"Update workspace properties using the current record metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_values","type":"jsonb","required":true,"nullable":false}]},{"operation":"archive_record","rpc":"archive_record","label":"Archive record","description":"Archive a record using the current metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false}]},{"operation":"restore_record","rpc":"restore_record","label":"Restore record","description":"Restore an archived record using the current metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false}]},{"operation":"create_record_link","rpc":"create_record_link","label":"Link records","description":"Create a link from a source record to a target record in the workspace.","arguments":[{"name":"p_source_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_target_kind","type":"text","required":true,"nullable":false},{"name":"p_target_identifier","type":"text","required":true,"nullable":false},{"name":"p_link_type","type":"text","required":true,"nullable":false},{"name":"p_target_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_label","type":"text","required":false,"nullable":true}]},{"operation":"transfer_sample","rpc":"transfer_sample","label":"Move sample","description":"Record a sample storage transfer with chain-of-custody evidence.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_to_location","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"receive_sample","rpc":"receive_sample","label":"Receive sample stock","description":"Add sample stock and record the receipt.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_location","type":"text","required":false,"nullable":true},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"consume_sample","rpc":"consume_sample","label":"Consume sample stock","description":"Reduce sample stock and record its use.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"edit_sample","rpc":"edit_sample","label":"Update sample details","description":"Update sample metadata without bypassing custody operations.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":true},{"name":"p_properties","type":"jsonb","required":true,"nullable":true},{"name":"p_tags","type":"text[]","required":true,"nullable":true},{"name":"p_notes","type":"text","required":true,"nullable":true},{"name":"p_custom_fields","type":"jsonb","required":true,"nullable":true}]},{"operation":"archive_sample","rpc":"archive_sample","label":"Archive sample","description":"Archive a sample with custody evidence.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"restore_sample","rpc":"restore_sample","label":"Restore sample","description":"Restore an archived sample with custody evidence.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"record_reagent_movement","rpc":"record_reagent_movement","label":"Record reagent movement","description":"Receive, consume or adjust reagent stock through its governed movement operation.","arguments":[{"name":"p_reagent_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_operation","type":"text","required":true,"nullable":false},{"name":"p_quantity_delta","type":"numeric","required":false,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":true}]},{"operation":"commit_dataset_row_batch","rpc":"commit_dataset_row_batch","label":"Commit dataset rows","description":"Commit a validated row batch at the expected dataset revision.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_dataset_revision","type":"bigint","required":true,"nullable":false},{"name":"p_rows","type":"jsonb","required":true,"nullable":false},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"}]},{"operation":"snapshot_dataset","rpc":"snapshot_dataset","label":"Snapshot dataset","description":"Create an immutable dataset version with a label.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_dataset_revision","type":"bigint","required":true,"nullable":false},{"name":"p_label","type":"text","required":true,"nullable":false}]},{"operation":"archive_dataset","rpc":"archive_dataset","label":"Archive dataset","description":"Archive a dataset through dependency and revision checks.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]},{"operation":"restore_dataset","rpc":"restore_dataset","label":"Restore dataset","description":"Restore an archived dataset at the expected revision.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}]$catalogue$::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_action jsonb; v_definition jsonb; v_argument jsonb; v_key text;
  v_names text[] := '{}';
BEGIN
  IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN
    RETURN '[{"code":"invalid_shape","field":"actions","message":"actions must be an array"}]'::jsonb;
  END IF;
  IF jsonb_array_length(p_actions) > 20 THEN
    RETURN '[{"code":"too_many","field":"actions","message":"At most twenty ELN actions are allowed."}]'::jsonb;
  END IF;
  FOR v_action IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    IF jsonb_typeof(v_action) IS DISTINCT FROM 'object'
      OR coalesce(v_action->>'name','') !~ '^[a-z][a-z0-9_]{0,47}$'
      OR v_action->>'name' = ANY(v_names)
      OR v_action->>'name' IN ('constructor','prototype') THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"Each action needs a unique lowercase name."}]'::jsonb;
      CONTINUE;
    END IF;
    v_names := array_append(v_names, v_action->>'name');
    SELECT value INTO v_definition FROM jsonb_array_elements(v_catalogue) WHERE value->>'operation' = v_action->>'operation';
    IF v_definition IS NULL THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"Unsupported ELN action."}]'::jsonb;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_action->'arguments') IS DISTINCT FROM 'object' THEN
      v_errors := v_errors || '[{"code":"invalid_shape","field":"actions","message":"Action inputs must be an object."}]'::jsonb;
      CONTINUE;
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_action->'arguments') LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_definition->'arguments') arg WHERE arg->>'name' = v_key AND NOT arg ? 'server') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','actions','message','This action input is not editable: ' || v_key));
      END IF;
    END LOOP;
    FOR v_argument IN SELECT value FROM jsonb_array_elements(v_definition->'arguments') LOOP
      IF v_argument->'required' = 'true'::jsonb AND NOT v_argument ? 'server' AND NOT (v_action->'arguments') ? (v_argument->>'name') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','missing_required','field','actions','message','Required action input: ' || (v_argument->>'name')));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_errors;
END $fn$;
REVOKE EXECUTE ON FUNCTION internal.pipeline_action_errors(jsonb) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.pipeline_config_errors(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_param jsonb;
  v_input jsonb;
  v_names text[] := '{}'::text[];
  v_value jsonb;
  v_key text;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'configuration', 'message', 'configuration must be an object')
    );
  END IF;
  IF p_config->'configVersion' IS DISTINCT FROM '1'::jsonb THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'unsupported_config_version', 'field', 'configVersion', 'message', 'configVersion must be 1')
    );
  END IF;
  IF p_config ? 'description' AND jsonb_typeof(p_config->'description') NOT IN ('string', 'null') THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'description', 'message', 'description must be a string')
    );
  ELSIF jsonb_typeof(p_config->'description') = 'string'
    AND length(p_config->>'description') > 2000 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'description', 'message', 'description must be at most 2000 characters')
    );
  END IF;

  -- parameters (optional; absent means none)
  IF p_config ? 'parameters' AND jsonb_typeof(p_config->'parameters') IS DISTINCT FROM 'array' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'parameters', 'message', 'parameters must be an array')
    );
  ELSIF p_config ? 'parameters' AND jsonb_array_length(p_config->'parameters') > 50 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'too_many', 'field', 'parameters', 'message', 'at most 50 parameters are allowed')
    );
  ELSE
    FOR v_param IN SELECT value FROM jsonb_array_elements(p_config->'parameters') LOOP
      IF jsonb_typeof(v_param) <> 'object'
         OR v_param - ARRAY['name','type','required','default','description'] <> '{}'::jsonb
         OR jsonb_typeof(v_param->'name') <> 'string'
         OR v_param->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_shape', 'field', 'parameters', 'message', 'each parameter needs a valid lowercase name')
        );
      ELSIF v_param->>'name' = ANY(v_names) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', 'parameters', 'message', 'parameter name is duplicated: ' || v_param->>'name')
        );
      ELSE
        v_names := array_append(v_names, v_param->>'name');
        IF v_param->>'type' NOT IN ('text','integer','decimal','boolean','date','timestamp') THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' has an unsupported type')
          );
        END IF;
        IF jsonb_typeof(v_param->'required') NOT IN ('boolean', 'null', 'undefined') THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' required must be a boolean')
          );
        END IF;
        IF v_param ? 'default' AND coalesce((v_param->>'required')::boolean, false) THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'required parameter ' || v_param->>'name' || ' cannot declare a default')
          );
        END IF;
        IF v_param ? 'default' AND v_param->'default' IS NOT NULL AND NOT (
          (v_param->>'type' = 'text' AND jsonb_typeof(v_param->'default') = 'string')
          OR (v_param->>'type' = 'integer' AND jsonb_typeof(v_param->'default') = 'number'
              AND v_param->'default' #>> '{}' ~ '^-?[0-9]+$')
          OR (v_param->>'type' = 'decimal' AND jsonb_typeof(v_param->'default') = 'number')
          OR (v_param->>'type' = 'boolean' AND jsonb_typeof(v_param->'default') = 'boolean')
          OR (v_param->>'type' = 'date' AND jsonb_typeof(v_param->'default') = 'string'
              AND v_param->'default' #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
          OR (v_param->>'type' = 'timestamp' AND jsonb_typeof(v_param->'default') = 'string')
        ) THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', 'parameters', 'message', 'parameter ' || v_param->>'name' || ' default does not match its type')
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- inputs (required: between 0 and 10)
  v_names := '{}'::text[];
  IF NOT p_config ? 'inputs' OR jsonb_typeof(p_config->'inputs') IS DISTINCT FROM 'array' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'inputs must be an array')
    );
  ELSIF jsonb_array_length(p_config->'inputs') > 10 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'inputs must contain between 0 and 10 entries')
    );
  ELSE
    FOR v_input IN SELECT value FROM jsonb_array_elements(p_config->'inputs') LOOP
      IF jsonb_typeof(v_input) <> 'object'
         OR v_input - ARRAY['name','required','description'] <> '{}'::jsonb
         OR jsonb_typeof(v_input->'name') <> 'string'
         OR v_input->>'name' = 'previous'
         OR v_input->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'each input needs a valid lowercase name')
        );
      ELSIF v_input->>'name' = ANY(v_names) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', 'inputs', 'message', 'input name is duplicated: ' || v_input->>'name')
        );
      ELSE
        v_names := array_append(v_names, v_input->>'name');
      END IF;
    END LOOP;
  END IF;

  -- transform
  IF jsonb_typeof(p_config->'transform') IS DISTINCT FROM 'object' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'transform', 'message', 'transform must be an object')
    );
  ELSE
    IF coalesce(p_config->'transform'->>'language', '') NOT IN ('sql', 'python', 'none') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unsupported_language', 'field', 'transform.language', 'message', 'transform language must be SQL or Python')
      );
    END IF;
    IF p_config->'transform'->>'language' <> 'none' AND (jsonb_typeof(p_config->'transform'->'statement') IS DISTINCT FROM 'string'
       OR length(btrim(p_config->'transform'->>'statement')) NOT BETWEEN 1 AND 20000) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', 'transform.statement', 'message', 'transform statement must be between 1 and 20000 characters')
      );
    END IF;
  END IF;

  -- output
  IF jsonb_typeof(p_config->'output') IS DISTINCT FROM 'object' THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'output', 'message', 'output must be an object')
    );
  ELSE
    IF coalesce(p_config->'output'->>'mode','') NOT IN ('create', 'append', 'none') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', 'output.mode', 'message', 'output mode must be create, append or none')
      );
    END IF;
    IF p_config->'output'->>'mode' = 'create' THEN
      BEGIN
        PERFORM (p_config->'output'->>'schemaVersionId')::uuid;
        IF p_config->'output'->>'schemaVersionId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.schemaVersionId', 'message', 'create output requires a valid Dataset Schema Version id')
        );
      END;
      IF jsonb_typeof(p_config->'output'->'datasetName') IS DISTINCT FROM 'string'
         OR length(btrim(p_config->'output'->>'datasetName')) NOT BETWEEN 1 AND 200 THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetName', 'message', 'create output requires a dataset name')
        );
      END IF;
    END IF;
    IF p_config->'output'->>'mode' = 'append' THEN
      BEGIN
        PERFORM (p_config->'output'->>'datasetId')::uuid;
        IF p_config->'output'->>'datasetId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetId', 'message', 'append output requires a valid Dataset id')
        );
      END;
    END IF;
    IF p_config->'output'->>'mode' <> 'none' AND (jsonb_typeof(p_config->'output'->'datasetLabel') IS DISTINCT FROM 'string'
       OR length(btrim(p_config->'output'->>'datasetLabel')) NOT BETWEEN 1 AND 200) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', 'output.datasetLabel', 'message', 'output requires a Dataset Version label')
      );
    END IF;
    IF jsonb_typeof(p_config->'output'->'fieldMapping') NOT IN ('object', 'null') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', 'output.fieldMapping', 'message', 'fieldMapping must be an object or null')
      );
    END IF;
  END IF;

  IF p_config ? 'steps' THEN
    IF jsonb_typeof(p_config->'steps') IS DISTINCT FROM 'array' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','steps','message','steps must be an array'));
    ELSIF jsonb_array_length(p_config->'steps') > 9 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','too_many','field','steps','message','At most nine additional steps are allowed.'));
    ELSE
      v_names := '{}'::text[];
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'steps') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
          OR coalesce(v_item->>'name','') !~ '^[a-z][a-z0-9_]{0,47}$'
          OR v_item->>'name' = 'previous'
          OR coalesce(v_item->>'language','') NOT IN ('sql','python')
          OR jsonb_typeof(v_item->'statement') IS DISTINCT FROM 'string'
          OR length(btrim(v_item->>'statement')) NOT BETWEEN 1 AND 20000 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Each step needs a name, SQL or Python, and 1–20000 characters of code.'));
        ELSIF v_item->>'name' = ANY(v_names) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','duplicate_name','field','steps','message','Step names must be unique.'));
        END IF;
        v_names := array_append(v_names, v_item->>'name');
      END LOOP;
    END IF;
  END IF;
  IF p_config ? 'notifications' THEN
    IF jsonb_typeof(p_config->'notifications') IS DISTINCT FROM 'array' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','notifications','message','notifications must be an array'));
    ELSIF jsonb_array_length(p_config->'notifications') > 10 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','too_many','field','notifications','message','Choose at most ten webhook destinations.'));
    ELSE
      v_names := '{}'::text[];
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'notifications') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR coalesce(v_item->>'subscriptionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','notifications','message','Choose a webhook destination.'));
        ELSIF v_item->>'subscriptionId' = ANY(v_names) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','duplicate_name','field','notifications','message','Webhook destinations must be unique.'));
        END IF;
        IF v_item ? 'payload' AND jsonb_typeof(v_item->'payload') IS DISTINCT FROM 'object' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','notifications','message','Webhook payload must be a JSON object.'));
        END IF;
        v_names := array_append(v_names, v_item->>'subscriptionId');
      END LOOP;
    END IF;
  END IF;
  IF p_config->'transform'->>'language' = 'python' OR (jsonb_typeof(p_config->'steps') = 'array' AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_config->'steps') = 'array' THEN p_config->'steps' ELSE '[]'::jsonb END) step WHERE step->>'language' = 'python')) THEN
    IF coalesce(p_config->>'pythonRuntime','') !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','missing_required','field','pythonRuntime','message','Choose an available Python runtime before saving.'));
    END IF;
  END IF;
  IF p_config ? 'actions' THEN
    v_errors := v_errors || internal.pipeline_action_errors(p_config->'actions');
  END IF;
  RETURN v_errors;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) TO authenticated;

--> statement-breakpoint

-- Sequence allocation cannot hold a cancelling request behind uncommitted step logs.
CREATE SEQUENCE internal.pipeline_log_sequence AS integer;
SELECT setval('internal.pipeline_log_sequence', greatest(coalesce(max(sequence),0) + 1, 1), false) FROM api.pipeline_run_logs;
REVOKE ALL ON SEQUENCE internal.pipeline_log_sequence FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.append_pipeline_run_log(
  p_workspace_id uuid,
  p_run_id uuid,
  p_level text,
  p_stage text,
  p_message text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS api.pipeline_run_logs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_run_logs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_level NOT IN ('info', 'warning', 'error') THEN
    RAISE EXCEPTION 'invalid log level' USING ERRCODE = 'SB034';
  END IF;
  IF p_stage IS NULL OR length(btrim(p_stage)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid log stage' USING ERRCODE = 'SB034';
  END IF;
  IF p_message IS NULL OR length(btrim(p_message)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'invalid log message' USING ERRCODE = 'SB034';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF (SELECT status FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id) <> 'running' THEN
    RAISE EXCEPTION 'logs can only be appended to a running run' USING ERRCODE = 'SB042';
  END IF;
  -- Evidence integrity: only the run actor (or a Pipeline manager) may write
  -- to a run's log; other writers cannot inject misleading stage entries.
  IF api.current_user_id() IS DISTINCT FROM (
    SELECT actor_user_id FROM api.pipeline_runs WHERE id = p_run_id AND workspace_id = p_workspace_id
  ) AND NOT api.has_capability(p_workspace_id, 'pipelines.manage') THEN
    RAISE EXCEPTION 'only the run actor or a Pipeline manager may write run logs' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.pipeline_run_logs(workspace_id, run_id, sequence, level, stage, message, detail)
  VALUES (
    p_workspace_id, p_run_id,
    nextval('internal.pipeline_log_sequence'),
    p_level, btrim(p_stage), btrim(p_message), COALESCE(p_detail, '{}'::jsonb)
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.append_pipeline_run_log(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.append_pipeline_run_log(uuid, uuid, text, text, text, jsonb) TO authenticated;

--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.cancel_pipeline_run(
  p_workspace_id uuid,
  p_run_id uuid
)
RETURNS api.pipeline_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.pipeline_runs;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v FROM api.pipeline_runs
   WHERE id = p_run_id AND workspace_id = p_workspace_id FOR NO KEY UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'running' THEN
    RAISE EXCEPTION 'run is not running' USING ERRCODE = 'SB042';
  END IF;
  -- The run actor (or a steward) may cancel; other writers cannot.
  IF api.current_user_id() IS DISTINCT FROM v.actor_user_id
     AND NOT api.has_capability(p_workspace_id, 'pipelines.manage') THEN
    RAISE EXCEPTION 'only the run actor or a Pipeline manager may cancel a run' USING ERRCODE = '42501';
  END IF;
  -- Record the cancellation reason while the run is still 'running'
  -- (append_pipeline_run_log only accepts running runs).
  PERFORM api.append_pipeline_run_log(
    p_workspace_id, v.id, 'warning', 'cancel',
    'Run cancelled by a workspace writer.', '{}'::jsonb
  );
  UPDATE api.pipeline_runs SET
    status = 'cancelled', finished_at = now(),
    error_code = 'cancelled', error_message = 'run cancelled by user'
  WHERE id = p_run_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.cancel_pipeline_run(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.cancel_pipeline_run(uuid, uuid) TO authenticated;

--> statement-breakpoint

