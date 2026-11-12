-- Pipelines: one ordered list of typed steps (version file format 2).
--
-- Format 1 kept a version's work in four places: one transform, up to nine
-- further steps (a pause rode on a step as `confirm`), ELN actions and
-- notifications. Format 2 is one list, `steps`, in the order a run does it.
-- Every step has a `kind`:
--
--   sql, python, plugin   data steps; each reads the one before as `previous`
--   ask                   pause and ask a person about the rows so far
--   action                an ELN action, done or proposed under its policy
--   notify                post to a notification channel
--
-- Actions and notifications run once the output is written, in list order,
-- reading the result of the data step before them. A data step may carry
-- `onlyIfRows` (skip it when the step before gave no rows) and any step a
-- `note`. A version also says which `mode` it is written in: simple, standard
-- or advanced.
--
-- Every stored version is rewritten here, as Standard:
--   * the transform becomes a step named `analysis`;
--   * a step that paused becomes a data step named `<name>_shown`, followed by
--     an ask step under the original name (open prompts and waiting runs keep
--     naming it);
--   * actions keep their names; notifications become `notify_<n>`.
--
-- The kinds sit in a registry, internal.pipeline_step_kinds, so a kind added
-- later is a row rather than a rewrite of the validator: `runs` says how the
-- runner executes it (a no-code step stores the SQL it writes and runs as sql).

CREATE TABLE IF NOT EXISTS internal.pipeline_step_kinds (
  kind text PRIMARY KEY CHECK (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  runs text NOT NULL CHECK (runs IN ('sql', 'python', 'plugin', 'ask', 'action', 'notify'))
);
--> statement-breakpoint

INSERT INTO internal.pipeline_step_kinds (kind, runs) VALUES
  ('sql', 'sql'),
  ('python', 'python'),
  ('plugin', 'plugin'),
  ('ask', 'ask'),
  ('action', 'action'),
  ('notify', 'notify')
ON CONFLICT (kind) DO NOTHING;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.pipeline_config_errors(p_config jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_param jsonb;
  v_input jsonb;
  v_names text[] := '{}'::text[];
  v_targets text[] := '{}'::text[];
  v_actions jsonb := '[]'::jsonb;
  v_runs text;
  v_uses_python boolean := false;
BEGIN
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'configuration', 'message', 'configuration must be an object')
    );
  END IF;
  IF p_config->'configVersion' IS DISTINCT FROM '2'::jsonb THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'unsupported_config_version', 'field', 'configVersion', 'message', 'configVersion must be 2')
    );
  END IF;
  IF coalesce(p_config->>'mode', '') NOT IN ('simple', 'standard', 'advanced') THEN
    v_errors := v_errors || jsonb_build_array(
      jsonb_build_object('code', 'invalid_value', 'field', 'mode', 'message', 'mode must be simple, standard or advanced')
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
         OR v_input - ARRAY['name','required','description','schemaId'] <> '{}'::jsonb
         OR jsonb_typeof(v_input->'name') <> 'string'
         OR v_input->>'name' = 'previous'
         OR v_input->>'name' !~ '^[a-z][a-z0-9_]{0,47}$' THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_shape', 'field', 'inputs', 'message', 'each input needs a valid lowercase name')
        );
      ELSIF v_input ? 'schemaId' AND NOT (
            jsonb_typeof(v_input->'schemaId') = 'string'
            AND v_input->>'schemaId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'invalid_value', 'field', 'inputs', 'message', 'input ' || coalesce(v_input->>'name', '') || ' schemaId must be a Dataset Schema id')
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

  -- steps: one ordered list of every kind
  v_names := '{}'::text[];
  IF jsonb_typeof(p_config->'steps') IS DISTINCT FROM 'array' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','steps','message','steps must be an array'));
  ELSIF jsonb_array_length(p_config->'steps') > 50 THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','too_many','field','steps','message','A version holds at most 50 steps.'));
  ELSE
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_config->'steps') LOOP
      v_runs := NULL;
      IF jsonb_typeof(v_item) = 'object' THEN
        SELECT k.runs INTO v_runs FROM internal.pipeline_step_kinds k WHERE k.kind = v_item->>'kind';
      END IF;
      IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
        OR coalesce(v_item->>'name','') !~ '^[a-z][a-z0-9_]{0,47}$'
        OR v_item->>'name' = 'previous' THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Each step needs a lowercase identifier'));
        CONTINUE;
      END IF;
      IF v_item->>'name' = ANY(v_names) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','duplicate_name','field','steps','message','Step names must be unique'));
      END IF;
      v_names := array_append(v_names, v_item->>'name');
      IF v_runs IS NULL THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','unsupported_language','field','steps','message','Step ' || (v_item->>'name') || ' has a kind this version cannot run.'));
        CONTINUE;
      END IF;
      IF v_item ? 'note' AND (jsonb_typeof(v_item->'note') IS DISTINCT FROM 'string' OR length(v_item->>'note') > 500) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','A step note is at most 500 characters.'));
      END IF;
      IF v_item ? 'onlyIfRows' AND (v_runs NOT IN ('sql','python','plugin') OR jsonb_typeof(v_item->'onlyIfRows') IS DISTINCT FROM 'boolean') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Only a step that gives rows can be skipped when the step before it gave none.'));
      END IF;
      IF v_runs IN ('sql','python') THEN
        IF jsonb_typeof(v_item->'statement') IS DISTINCT FROM 'string'
          OR length(btrim(v_item->>'statement')) NOT BETWEEN 1 AND 20000 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Step code must contain 1–20000 characters'));
        END IF;
        IF v_runs = 'python' THEN
          v_uses_python := true;
        END IF;
      ELSIF v_runs = 'plugin' THEN
        IF jsonb_typeof(v_item->'plugin') IS DISTINCT FROM 'object'
          OR coalesce(v_item->'plugin'->>'operation','') !~ '^plugin\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$'
          OR jsonb_typeof(v_item->'plugin'->'arguments') IS DISTINCT FROM 'object' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','A plugin step needs the plugin step it runs and its settings.'));
        END IF;
      ELSIF v_runs = 'ask' THEN
        IF jsonb_typeof(v_item->'ask') IS DISTINCT FROM 'object'
          OR jsonb_typeof(v_item->'ask'->'fields') IS DISTINCT FROM 'array'
          OR jsonb_array_length(v_item->'ask'->'fields') NOT BETWEEN 1 AND 20
          OR jsonb_typeof(v_item->'ask'->'askedUserIds') IS DISTINCT FROM 'array'
          OR jsonb_array_length(v_item->'ask'->'askedUserIds') NOT BETWEEN 1 AND 50 THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','steps','message','An ask step needs a form of 1 to 20 fields and 1 to 50 people to ask.'));
        END IF;
      ELSIF v_runs = 'action' THEN
        IF jsonb_typeof(v_item->'action') IS DISTINCT FROM 'object' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','steps','message','An action step needs the action it does.'));
        ELSE
          v_actions := v_actions || jsonb_build_array((v_item->'action') || jsonb_build_object('name', v_item->>'name'));
        END IF;
      ELSIF v_runs = 'notify' THEN
        IF jsonb_typeof(v_item->'notify') IS DISTINCT FROM 'object'
          OR coalesce(v_item->'notify'->>'subscriptionId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','steps','message','Choose a webhook destination'));
        ELSIF v_item->'notify'->>'subscriptionId' = ANY(v_targets) THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','duplicate_name','field','steps','message','Webhook destinations must be unique'));
        ELSE
          v_targets := array_append(v_targets, v_item->'notify'->>'subscriptionId');
          IF v_item->'notify' ? 'payload' AND jsonb_typeof(v_item->'notify'->'payload') IS DISTINCT FROM 'object' THEN
            v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_shape','field','steps','message','The webhook details must be a JSON object.'));
          END IF;
        END IF;
      END IF;
    END LOOP;
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

  IF v_uses_python
     AND coalesce(p_config->>'pythonRuntime','') !~ '^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$' THEN
    v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','missing_required','field','pythonRuntime','message','Choose an available Python runtime before saving.'));
  END IF;
  IF jsonb_array_length(v_actions) > 0 THEN
    v_errors := v_errors || internal.pipeline_action_errors(v_actions);
  END IF;
  RETURN v_errors;
END;
$_$;
--> statement-breakpoint

-- One-shot: format 1 to format 2. Dropped at the end of this migration.
CREATE FUNCTION internal.pipeline_config_to_v2(c jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE
  v_steps jsonb := '[]'::jsonb;
  v_taken text[] := '{}'::text[];
  v_step jsonb;
  v_data jsonb;
  v_name text;
  v_index integer := 0;
BEGIN
  IF c->'configVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN c;
  END IF;

  SELECT coalesce(array_agg(s->>'name'), '{}') INTO v_taken
    FROM jsonb_array_elements(coalesce(c->'steps', '[]'::jsonb)) s;
  v_taken := v_taken || ARRAY(
    SELECT a->>'name' FROM jsonb_array_elements(coalesce(c->'actions', '[]'::jsonb)) a);

  IF coalesce(c->'transform'->>'language', 'none') <> 'none' THEN
    v_name := CASE WHEN 'analysis' = ANY(v_taken) THEN 'analysis_step' ELSE 'analysis' END;
    v_taken := array_append(v_taken, v_name);
    v_steps := v_steps || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_name,
        'kind', c->'transform'->>'language',
        'statement', c->'transform'->'statement',
        'contract', c->'transform'->'contract')));
  END IF;

  FOR v_step IN SELECT value FROM jsonb_array_elements(coalesce(c->'steps', '[]'::jsonb)) LOOP
    v_data := jsonb_strip_nulls(jsonb_build_object(
      'name', v_step->>'name',
      'kind', v_step->>'language',
      'statement', CASE WHEN v_step->>'language' = 'plugin' THEN NULL ELSE v_step->'statement' END,
      'plugin', v_step->'plugin',
      'contract', v_step->'contract'));
    IF v_step ? 'confirm' THEN
      v_name := left(v_step->>'name', 42) || '_shown';
      WHILE v_name = ANY(v_taken) LOOP
        v_name := left(v_name, 45) || '_' || (v_index % 10)::text;
        v_index := v_index + 1;
      END LOOP;
      v_taken := array_append(v_taken, v_name);
      v_steps := v_steps
        || jsonb_build_array(jsonb_set(v_data, '{name}', to_jsonb(v_name)))
        || jsonb_build_array(jsonb_build_object(
             'name', v_step->>'name', 'kind', 'ask', 'ask', v_step->'confirm'));
    ELSE
      v_steps := v_steps || jsonb_build_array(v_data);
    END IF;
  END LOOP;

  FOR v_step IN SELECT value FROM jsonb_array_elements(coalesce(c->'actions', '[]'::jsonb)) LOOP
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'name', v_step->>'name', 'kind', 'action', 'action', v_step - 'name'));
  END LOOP;

  v_index := 0;
  FOR v_step IN SELECT value FROM jsonb_array_elements(coalesce(c->'notifications', '[]'::jsonb)) LOOP
    v_index := v_index + 1;
    v_name := 'notify_' || v_index;
    WHILE v_name = ANY(v_taken) LOOP
      v_name := v_name || '_n';
    END LOOP;
    v_taken := array_append(v_taken, v_name);
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'kind', 'notify', 'notify', v_step));
  END LOOP;

  RETURN (c - 'transform' - 'steps' - 'actions' - 'notifications')
    || jsonb_build_object('configVersion', 2, 'mode', 'standard', 'steps', v_steps);
END;
$_$;
--> statement-breakpoint

ALTER TABLE api.pipeline_definition_versions
  DROP CONSTRAINT chk_pipeline_definition_versions_format;
--> statement-breakpoint

UPDATE api.pipeline_definition_versions
   SET configuration = internal.pipeline_config_to_v2(configuration),
       configuration_format_version = 2
 WHERE configuration->'configVersion' = '1'::jsonb
    OR configuration_format_version <> 2;
--> statement-breakpoint

ALTER TABLE api.pipeline_definition_versions
  ALTER COLUMN configuration_format_version SET DEFAULT 2,
  ADD CONSTRAINT chk_pipeline_definition_versions_format CHECK (configuration_format_version = 2);
--> statement-breakpoint

DROP FUNCTION internal.pipeline_config_to_v2(jsonb);
