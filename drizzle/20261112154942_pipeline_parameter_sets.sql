-- Pipelines: reusable parameter sets, and `include` to name them.
--
-- A set is a named list of parameters (name, type, default) a workspace keeps
-- once and many pipelines include by its key. A version that includes a set
-- carries a copy of those parameters in its own `parameters`, and `include`
-- records where they came from: [{"set": "aav9-limits", "parameters": ["ntu_limit"]}].
-- Because the copy is stored, a set changing later never changes a published
-- version or a run that used it; saving the version again takes the set's
-- current parameters.

CREATE TABLE api.pipeline_parameter_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    parameters jsonb NOT NULL,
    created_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_pipeline_parameter_sets_key CHECK (key ~ '^[a-z][a-z0-9_-]{0,63}$'),
    CONSTRAINT chk_pipeline_parameter_sets_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_pipeline_parameter_sets_parameters CHECK (jsonb_typeof(parameters) = 'array'),
    CONSTRAINT uq_pipeline_parameter_sets_key UNIQUE (workspace_id, key)
);
--> statement-breakpoint
ALTER TABLE api.pipeline_parameter_sets OWNER TO migrator;
--> statement-breakpoint
COMMENT ON TABLE api.pipeline_parameter_sets IS 'Reusable named lists of pipeline parameters that a pipeline version includes by key.';
--> statement-breakpoint
ALTER TABLE api.pipeline_parameter_sets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_parameter_sets_select ON api.pipeline_parameter_sets FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY pipeline_parameter_sets_select_api_client ON api.pipeline_parameter_sets FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.pipeline_parameter_sets TO authenticated, api_client;
--> statement-breakpoint

-- The parameters of a set are judged as a pipeline judges its own.
CREATE FUNCTION internal.pipeline_parameter_set_errors(p_parameters jsonb) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
    FROM jsonb_array_elements(api.pipeline_config_errors(jsonb_build_object(
           'configVersion', 2,
           'mode', 'standard',
           'parameters', p_parameters,
           'inputs', '[]'::jsonb,
           'steps', jsonb_build_array(jsonb_build_object('name', 'check', 'kind', 'sql', 'statement', 'SELECT 1')),
           'output', jsonb_build_object('mode', 'none')
         ))) e
   WHERE e->>'field' LIKE 'parameters%';
$$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_parameter_set_errors(jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.save_pipeline_parameter_set(
    p_workspace_id uuid, p_key text, p_name text, p_parameters jsonb, p_description text DEFAULT NULL
) RETURNS api.pipeline_parameter_sets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_parameter_sets;
  v_errors jsonb;
  v_created boolean;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_-]{0,63}$' THEN
    RAISE EXCEPTION 'a set key is lower-case letters, digits, - and _, starting with a letter' USING ERRCODE = 'SB034';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a set needs a name' USING ERRCODE = 'SB034';
  END IF;
  IF jsonb_typeof(p_parameters) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'parameters must be a list' USING ERRCODE = 'SB034';
  END IF;
  v_errors := internal.pipeline_parameter_set_errors(p_parameters);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'parameter set has errors: %', v_errors->0->>'message' USING ERRCODE = 'SB034', DETAIL = v_errors::text;
  END IF;
  v_created := NOT EXISTS (SELECT 1 FROM api.pipeline_parameter_sets WHERE workspace_id = p_workspace_id AND key = p_key);
  INSERT INTO api.pipeline_parameter_sets(workspace_id, key, name, description, parameters, created_by_user_id)
  VALUES (p_workspace_id, p_key, btrim(p_name), p_description, p_parameters, api.current_user_id())
  ON CONFLICT (workspace_id, key) DO UPDATE
     SET name = EXCLUDED.name, description = EXCLUDED.description,
         parameters = EXCLUDED.parameters, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(
    p_workspace_id, 'pipeline_parameter_set', v.id,
    CASE WHEN v_created THEN 'create' ELSE 'update' END,
    NULL, NULL, to_jsonb(v)
  );
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_pipeline_parameter_set(uuid, text, text, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_pipeline_parameter_set(uuid, text, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_pipeline_parameter_set(uuid, text, text, jsonb, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_pipeline_parameter_set(p_workspace_id uuid, p_set_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.pipeline_parameter_sets;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  DELETE FROM api.pipeline_parameter_sets WHERE id = p_set_id AND workspace_id = p_workspace_id RETURNING * INTO v;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'parameter set not found' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.emit_change_event(p_workspace_id, 'pipeline_parameter_set', v.id, 'delete', NULL, NULL, to_jsonb(v));
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_pipeline_parameter_set(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_pipeline_parameter_set(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_pipeline_parameter_set(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- `include`: each entry names a set and the parameters it brought in, and
-- those parameters must be in the version's own list.
CREATE FUNCTION internal.pipeline_include_errors(p_config jsonb) RETURNS jsonb
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $_$
DECLARE
  v_errors jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name jsonb;
  v_i integer := 0;
  v_own text[];
  v_seen text[] := '{}'::text[];
BEGIN
  IF NOT p_config ? 'include' THEN
    RETURN v_errors;
  END IF;
  IF jsonb_typeof(p_config->'include') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_array(
      jsonb_build_object('code', 'invalid_shape', 'field', 'include', 'message', 'include must be a list'));
  END IF;
  SELECT coalesce(array_agg(x->>'name'), '{}'::text[]) INTO v_own
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_config->'parameters') = 'array' THEN p_config->'parameters' ELSE '[]'::jsonb END
         ) x;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_config->'include') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object'
       OR (v_item->>'set') IS NULL OR (v_item->>'set') !~ '^[a-z][a-z0-9_-]{0,63}$'
       OR jsonb_typeof(v_item->'parameters') IS DISTINCT FROM 'array' THEN
      v_errors := v_errors || jsonb_build_array(
        jsonb_build_object('code', 'invalid_shape', 'field', format('include[%s]', v_i),
                           'message', 'an include names a parameter set and the parameters it brought in'));
    ELSE
      IF (v_item->>'set') = ANY (v_seen) THEN
        v_errors := v_errors || jsonb_build_array(
          jsonb_build_object('code', 'duplicate_name', 'field', format('include[%s]', v_i), 'message', 'a parameter set is included twice'));
      END IF;
      v_seen := v_seen || (v_item->>'set');
      FOR v_name IN SELECT * FROM jsonb_array_elements(v_item->'parameters') LOOP
        IF jsonb_typeof(v_name) IS DISTINCT FROM 'string' OR NOT (v_name #>> '{}') = ANY (v_own) THEN
          v_errors := v_errors || jsonb_build_array(
            jsonb_build_object('code', 'invalid_value', 'field', format('include[%s].parameters', v_i),
                               'message', 'an included parameter must be one of the version''s parameters'));
        END IF;
      END LOOP;
    END IF;
    v_i := v_i + 1;
  END LOOP;
  RETURN v_errors;
END;
$_$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_include_errors(jsonb) OWNER TO migrator;
--> statement-breakpoint

DO $do$
DECLARE
  v_def text;
  v_patched text;
BEGIN
  v_def := pg_get_functiondef('api.pipeline_config_errors(jsonb)'::regprocedure);
  v_patched := replace(
    v_def,
    E'  RETURN v_errors;\nEND;',
    E'  v_errors := v_errors || internal.pipeline_include_errors(p_config);\n  RETURN v_errors;\nEND;'
  );
  IF v_patched = v_def THEN
    RAISE EXCEPTION 'pipeline_config_errors has an unexpected ending';
  END IF;
  EXECUTE v_patched;
END;
$do$;
--> statement-breakpoint

-- The change feed accepts the new entity type.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  IF position('''pipeline_parameter_set''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''pipeline_parameter_set''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
