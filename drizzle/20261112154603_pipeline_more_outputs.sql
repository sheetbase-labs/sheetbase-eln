-- Pipelines: a version may write more than one output.
--
-- `output` stays the first output. A file-only `moreOutputs` list holds the
-- others; each says which data step its rows come from (`from`). A pipeline
-- with no `moreOutputs` is read exactly as before. `output.from` is also
-- allowed: the first output may take the rows of a step other than the last.
--
-- The checks sit in internal.pipeline_more_output_errors and are appended to
-- api.pipeline_config_errors, so a token, the assistant and the app judge a
-- version the same way.

CREATE FUNCTION internal.pipeline_more_output_errors(p_config jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_data_steps text[];
  v_more jsonb;
  v_item jsonb;
  v_i integer := 0;
  v_field text;
  v_targets text[] := '{}'::text[];
  v_target text;
BEGIN
  SELECT coalesce(array_agg(s->>'name'), '{}'::text[]) INTO v_data_steps
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_config->'steps') = 'array' THEN p_config->'steps' ELSE '[]'::jsonb END
         ) s
   WHERE s->>'kind' IN (SELECT kind FROM internal.pipeline_step_kinds WHERE runs IN ('sql', 'python', 'plugin'));

  IF jsonb_typeof(p_config->'output') = 'object' AND p_config->'output' ? 'from'
     AND (jsonb_typeof(p_config->'output'->'from') IS DISTINCT FROM 'string'
          OR NOT (p_config->'output'->>'from') = ANY (v_data_steps)) THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'output.from', 'message', 'from must name a data step of this pipeline'));
  END IF;

  IF NOT p_config ? 'moreOutputs' THEN
    RETURN v_errors;
  END IF;
  v_more := p_config->'moreOutputs';
  IF jsonb_typeof(v_more) IS DISTINCT FROM 'array' THEN
    RETURN v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'moreOutputs', 'message', 'moreOutputs must be a list'));
  END IF;
  IF jsonb_array_length(v_more) > 9 THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'too_many', 'field', 'moreOutputs', 'message', 'at most 9 further outputs are allowed'));
  END IF;

  v_target := CASE p_config->'output'->>'mode'
    WHEN 'append' THEN 'append:' || coalesce(p_config->'output'->>'datasetId', '')
    WHEN 'create' THEN 'create:' || coalesce(p_config->'output'->>'schemaVersionId', 'undefined') || ':' || coalesce(p_config->'output'->>'datasetName', '')
    ELSE NULL END;
  IF v_target IS NOT NULL THEN v_targets := v_targets || v_target; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_more) LOOP
    v_field := format('moreOutputs[%s]', v_i);
    v_i := v_i + 1;
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', v_field, 'message', 'output must be an object'));
      CONTINUE;
    END IF;
    IF coalesce(v_item->>'mode', '') NOT IN ('create', 'append', 'none') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', v_field || '.mode', 'message', 'output mode must be create, append or none'));
    END IF;
    IF v_item->>'mode' = 'create' THEN
      BEGIN
        PERFORM (v_item->>'schemaVersionId')::uuid;
        IF v_item->>'schemaVersionId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', v_field || '.schemaVersionId', 'message', 'create output requires a valid Dataset Schema Version id'));
      END;
      IF jsonb_typeof(v_item->'datasetName') IS DISTINCT FROM 'string'
         OR length(btrim(v_item->>'datasetName')) NOT BETWEEN 1 AND 200 THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', v_field || '.datasetName', 'message', 'create output requires a dataset name'));
      END IF;
    END IF;
    IF v_item->>'mode' = 'append' THEN
      BEGIN
        PERFORM (v_item->>'datasetId')::uuid;
        IF v_item->>'datasetId' IS NULL THEN RAISE invalid_text_representation; END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', v_field || '.datasetId', 'message', 'append output requires a valid Dataset id'));
      END;
    END IF;
    IF coalesce(v_item->>'mode', '') <> 'none' AND (jsonb_typeof(v_item->'datasetLabel') IS DISTINCT FROM 'string'
       OR length(btrim(v_item->>'datasetLabel')) NOT BETWEEN 1 AND 200) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', v_field || '.datasetLabel', 'message', 'output requires a Dataset Version label'));
    END IF;
    IF v_item ? 'fieldMapping' AND jsonb_typeof(v_item->'fieldMapping') NOT IN ('object', 'null') THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', v_field || '.fieldMapping', 'message', 'fieldMapping must be an object or null'));
    END IF;
    IF jsonb_typeof(v_item->'from') IS DISTINCT FROM 'string' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'missing_required', 'field', v_field || '.from', 'message', 'a further output must say which step its rows come from'));
    ELSIF NOT (v_item->>'from') = ANY (v_data_steps) THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_value', 'field', v_field || '.from', 'message', 'from must name a data step of this pipeline'));
    END IF;
    v_target := CASE v_item->>'mode'
      WHEN 'append' THEN 'append:' || coalesce(v_item->>'datasetId', '')
      WHEN 'create' THEN 'create:' || coalesce(v_item->>'schemaVersionId', 'undefined') || ':' || coalesce(v_item->>'datasetName', '')
      ELSE NULL END;
    IF v_target IS NOT NULL THEN
      IF v_target = ANY (v_targets) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', v_field, 'message', 'two outputs write to the same place'));
      END IF;
      v_targets := v_targets || v_target;
    END IF;
  END LOOP;
  RETURN v_errors;
END;
$_$;
--> statement-breakpoint

-- Append the checks to the existing validator without restating it.
DO $do$
DECLARE
  v_def text;
  v_patched text;
BEGIN
  v_def := pg_get_functiondef('api.pipeline_config_errors(jsonb)'::regprocedure);
  v_patched := replace(
    v_def,
    E'  RETURN v_errors;\nEND;',
    E'  v_errors := v_errors || internal.pipeline_more_output_errors(p_config);\n  RETURN v_errors;\nEND;'
  );
  IF v_patched = v_def THEN
    RAISE EXCEPTION 'pipeline_config_errors has an unexpected ending';
  END IF;
  EXECUTE v_patched;
END;
$do$;
