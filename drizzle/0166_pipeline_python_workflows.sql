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
    IF jsonb_typeof(p_config->'actions') IS DISTINCT FROM 'array' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','actions','message','actions must be an array'));
    ELSIF jsonb_array_length(p_config->'actions') > 20 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','too_many','field','actions','message','At most twenty ELN actions are allowed.'));
    ELSE
      v_names := '{}'::text[];
      FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'actions') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
          OR coalesce(v_item->>'name','') !~ '^[a-z][a-z0-9_]{0,47}$'
          OR jsonb_typeof(v_item->'operation') IS DISTINCT FROM 'string'
          OR jsonb_typeof(v_item->'arguments') IS DISTINCT FROM 'object' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','actions','message','Each action needs a name, operation and inputs.'));
        ELSIF v_item->>'name' = ANY(v_names) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','duplicate_name','field','actions','message','Action names must be unique.'));
        END IF;
        v_names := array_append(v_names, v_item->>'name');
      END LOOP;
    END IF;
  END IF;
  RETURN v_errors;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_config_errors(jsonb) TO authenticated;

--> statement-breakpoint

CREATE TABLE internal.pipeline_webhook_triggers (
  definition_id uuid PRIMARY KEY REFERENCES api.pipeline_definitions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  created_by_user_id text NOT NULL,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON internal.pipeline_webhook_triggers FROM PUBLIC, authenticated, api_client, anon;
