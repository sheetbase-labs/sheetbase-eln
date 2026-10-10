-- Repair: api.pipeline_run_request_errors built its messages with
-- `'...' || v_x->>'name'`, which Postgres parses as `('...' || v_x) ->> 'name'`
-- (|| and ->> share precedence), so a missing parameter/input raised
-- "invalid input syntax for type json" instead of the intended message.
-- Parenthesise the jsonb extraction.

CREATE OR REPLACE FUNCTION api.pipeline_run_request_errors(
  p_configuration jsonb,
  p_parameters jsonb,
  p_input_versions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_param jsonb;
  v_input jsonb;
  v_key text;
  v_value jsonb;
  v_declared text[] := '{}'::text[];
  v_present text[] := '{}'::text[];
BEGIN
  IF p_parameters IS NULL OR jsonb_typeof(p_parameters) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'invalid_parameters', 'field', 'parameters', 'message', 'parameters must be an object'));
  END IF;
  IF p_input_versions IS NULL OR jsonb_typeof(p_input_versions) <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'invalid_inputs', 'field', 'input_versions', 'message', 'input_versions must be an object'));
  END IF;

  -- every supplied parameter must be declared and type-match
  FOR v_key, v_value IN SELECT entry.key, entry.value FROM jsonb_each(p_parameters) entry LOOP
    v_present := array_append(v_present, v_key);
    SELECT value INTO v_param FROM jsonb_array_elements(p_configuration->'parameters') value
      WHERE value->>'name' = v_key LIMIT 1;
    IF v_param IS NULL THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unknown_parameter', 'field', 'parameters', 'message', 'unknown parameter: ' || v_key)
      );
    ELSIF NOT (
      (v_param->>'type' = 'text' AND jsonb_typeof(v_value) = 'string')
      OR (v_param->>'type' = 'integer' AND jsonb_typeof(v_value) = 'number'
          AND v_value #>> '{}' ~ '^-?[0-9]+$')
      OR (v_param->>'type' = 'decimal' AND jsonb_typeof(v_value) = 'number')
      OR (v_param->>'type' = 'boolean' AND jsonb_typeof(v_value) = 'boolean')
      OR (v_param->>'type' = 'date' AND jsonb_typeof(v_value) = 'string'
          AND v_value #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
      OR (v_param->>'type' = 'timestamp' AND jsonb_typeof(v_value) = 'string')
    ) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_parameter_type', 'field', 'parameters', 'message', 'parameter ' || v_key || ' does not match its declared type')
      );
    END IF;
  END LOOP;

  -- every required parameter must be supplied
  FOR v_param IN SELECT value FROM jsonb_array_elements(p_configuration->'parameters') LOOP
    IF coalesce((v_param->>'required')::boolean, false)
       AND NOT (v_param->>'name' = ANY(v_present)) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'missing_parameter', 'field', 'parameters', 'message', 'missing required parameter: ' || (v_param->>'name'))
      );
    END IF;
  END LOOP;

  -- input_versions must name exactly the declared inputs with valid ids
  v_declared := '{}'::text[];
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_configuration->'inputs') LOOP
    v_declared := array_append(v_declared, v_input->>'name');
  END LOOP;
  FOR v_key, v_value IN SELECT entry.key, entry.value FROM jsonb_each(p_input_versions) entry LOOP
    IF NOT (v_key = ANY(v_declared)) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'unknown_input', 'field', 'input_versions', 'message', 'unknown input: ' || v_key)
      );
    ELSIF jsonb_typeof(v_value) <> 'string' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_input_version', 'field', 'input_versions', 'message', 'input ' || v_key || ' must be a Dataset Version id')
      );
    ELSE
      BEGIN
        PERFORM (v_value #>> '{}')::uuid;
      EXCEPTION WHEN others THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_input_version', 'field', 'input_versions', 'message', 'input ' || v_key || ' must be a Dataset Version id')
        );
      END;
    END IF;
  END LOOP;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_configuration->'inputs') LOOP
    IF NOT (SELECT EXISTS (SELECT 1 FROM jsonb_each(p_input_versions) entry WHERE entry.key = v_input->>'name')) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'missing_input', 'field', 'input_versions', 'message', 'missing input: ' || (v_input->>'name'))
      );
    END IF;
  END LOOP;

  RETURN v_errors;
END;
$$;

--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.pipeline_run_request_errors(jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.pipeline_run_request_errors(jsonb, jsonb, jsonb) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
