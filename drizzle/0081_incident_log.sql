-- Incident and deviation log.
--
-- There is no incident table. An incident log is an ordinary record model with
-- the "Incident log" box ticked, so a lab chooses what it logs (incidents,
-- deviations, near misses, complaints), what each one asks for, and which
-- model holds which. Ticking the box only tells the app to list the model's
-- records together on the Incidents page. Several models can be ticked.
--
-- "Incident" ships as a ready-made starter model, set up the way the
-- biological registries are: a published model with its fields, which the lab
-- can then change like any other model.

CREATE TABLE api.model_incident_logs (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT model_incident_logs_pkey PRIMARY KEY (workspace_id, model_key)
);
--> statement-breakpoint
ALTER TABLE api.model_incident_logs OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.model_incident_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY model_incident_logs_select ON api.model_incident_logs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.model_incident_logs TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_model_incident_log(p_model_key text, p_enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    INSERT INTO api.model_incident_logs (workspace_id, model_key, created_by_user_id)
    VALUES (v_workspace_id, p_model_key, api.current_user_id())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM api.model_incident_logs
     WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
  END IF;
  RETURN coalesce(p_enabled, false);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_incident_log(text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_incident_log(text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_incident_log(text, boolean) TO authenticated;
--> statement-breakpoint

-- Set up a ready-made model: a published model with its fields. `p_fields` is a
-- list of {field_name, label, logical_type, section, show_in_list, options},
-- where options is a list of {key, label} for a category field.
CREATE FUNCTION api.create_starter_model(
    p_key text, p_name text, p_prefix text, p_description text, p_fields jsonb,
    p_incident_log boolean DEFAULT false)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_field jsonb;
  v_option jsonb;
  v_order integer := 0;
  v_option_order integer;
  v_type text;
  v_fields jsonb := '[]'::jsonb;
  v_options jsonb;
  v_def api.record_field_definitions;
  v_opt api.model_field_options;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  PERFORM api.require_capability(v_workspace_id, 'schema.publish');
  v_model := api.create_workspace_model(v_workspace_id, p_key, p_name, p_prefix, p_description);
  FOR v_field IN SELECT * FROM jsonb_array_elements(p_fields) LOOP
    v_order := v_order + 1;
    v_type := coalesce(v_field ->> 'logical_type', 'text');
    INSERT INTO api.record_field_definitions
      (workspace_id, kind, field_name, label, display_order, logical_type, nullable,
       validation, lifecycle, created_by_user_id, section, show_in_list, ask_on_create,
       category_source)
    VALUES (v_workspace_id, p_key, v_field ->> 'field_name', v_field ->> 'label', v_order,
            v_type, true, '{}'::jsonb, 'active',
            api.current_user_id(), nullif(v_field ->> 'section', ''),
            coalesce((v_field ->> 'show_in_list')::boolean, false), true,
            CASE WHEN v_type = 'category' THEN '{"kind":"embedded"}'::jsonb END)
    RETURNING * INTO v_def;
    v_options := '[]'::jsonb;
    IF v_type = 'category' THEN
      v_option_order := 0;
      FOR v_option IN SELECT * FROM jsonb_array_elements(coalesce(v_field -> 'options', '[]'::jsonb)) LOOP
        v_option_order := v_option_order + 1;
        INSERT INTO api.model_field_options (definition_id, key, label, display_order)
        VALUES (v_def.id, v_option ->> 'key', v_option ->> 'label', v_option_order)
        RETURNING * INTO v_opt;
        v_options := v_options || to_jsonb(v_opt);
      END LOOP;
    END IF;
    v_fields := v_fields || (to_jsonb(v_def) || jsonb_build_object('options', v_options));
  END LOOP;
  INSERT INTO api.record_model_versions
    (workspace_id, model_id, version, revision, lifecycle, definition, published_at,
     created_by_user_id, updated_by_user_id)
  VALUES (v_workspace_id, v_model.id, 1, 1, 'published', jsonb_build_object('fields', v_fields), now(),
          api.current_user_id(), api.current_user_id());
  UPDATE api.record_models SET lifecycle = 'published' WHERE id = v_model.id
  RETURNING * INTO v_model;
  IF coalesce(p_incident_log, false) THEN
    PERFORM api.set_model_incident_log(p_key, true);
  END IF;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_starter_model(text, text, text, text, jsonb, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_starter_model(text, text, text, text, jsonb, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_starter_model(text, text, text, text, jsonb, boolean) TO authenticated;
