-- Model features: one list of optional features a record model can switch on.
--
-- Until now each optional behaviour of a model had its own flag or table
-- (registry, incident log, result limits, campaigns ...). This is the shared
-- place for them: one row says "this model has this feature", with settings for
-- the feature. Campaigns is the first feature to use it, replacing the campaign
-- list tick-box (api.model_campaign_lists). The other features move over later.

-- Events -----------------------------------------------------------------------
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
  IF position('''model_capability''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text]', '::text, ''model_capability''::text]');
  END IF;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('model.feature.enabled'), ('model.feature.disabled')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE TABLE api.model_capabilities (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    capability text NOT NULL,
    -- Settings of the feature on this model. Each feature says what it keeps here.
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT model_capabilities_pkey PRIMARY KEY (workspace_id, model_key, capability),
    CONSTRAINT chk_model_capabilities_capability CHECK (capability ~ '^[a-z][a-z0-9_]{1,39}$'),
    CONSTRAINT chk_model_capabilities_settings CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 65536)
);
--> statement-breakpoint
ALTER TABLE api.model_capabilities OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.model_capabilities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY model_capabilities_select ON api.model_capabilities FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY model_capabilities_client_select ON api.model_capabilities FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.model_capabilities TO authenticated, api_client;
--> statement-breakpoint

-- Campaigns that were switched on through the old tick-box keep working.
INSERT INTO api.model_capabilities (workspace_id, model_key, capability, created_at, created_by_user_id)
SELECT workspace_id, model_key, 'campaigns', created_at, created_by_user_id
  FROM api.model_campaign_lists;
--> statement-breakpoint

-- Switch a feature on or off for a model (or change its settings). Needs
-- permission to edit models, like any other change to a model.
CREATE FUNCTION api.set_model_capability(
    p_model_key text, p_capability text, p_enabled boolean,
    p_settings jsonb DEFAULT NULL) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_changed boolean := false;
  v_rows integer;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF p_capability IS NULL OR p_capability !~ '^[a-z][a-z0-9_]{1,39}$' THEN
    RAISE EXCEPTION 'unknown feature' USING ERRCODE = '22023';
  END IF;
  IF p_settings IS NOT NULL AND jsonb_typeof(p_settings) <> 'object' THEN
    RAISE EXCEPTION 'settings are a JSON object' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    INSERT INTO api.model_capabilities (workspace_id, model_key, capability, settings, created_by_user_id)
    VALUES (v_workspace_id, p_model_key, p_capability, coalesce(p_settings, '{}'::jsonb), api.current_user_id())
    ON CONFLICT (workspace_id, model_key, capability) DO UPDATE
       SET settings = coalesce(p_settings, api.model_capabilities.settings)
    RETURNING (xmax = 0) INTO v_changed;
  ELSE
    DELETE FROM api.model_capabilities
     WHERE workspace_id = v_workspace_id AND model_key = p_model_key AND capability = p_capability;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_changed := v_rows > 0;
  END IF;
  IF v_changed THEN
    PERFORM internal.emit_change_event(v_workspace_id, 'model_capability',
      md5(v_workspace_id::text || ':' || p_model_key || ':' || p_capability)::uuid,
      'update', NULL, NULL,
      jsonb_build_object('change', CASE WHEN coalesce(p_enabled, false) THEN 'enabled' ELSE 'disabled' END,
                         'modelKey', p_model_key, 'feature', p_capability));
  END IF;
  RETURN coalesce(p_enabled, false);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_capability(text, text, boolean, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_capability(text, text, boolean, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_capability(text, text, boolean, jsonb) TO authenticated;
--> statement-breakpoint

-- configure_campaign checked the old tick-box; it now checks the feature.
DO $$
DECLARE
  v_sig regprocedure := 'api.configure_campaign(uuid, jsonb, jsonb, integer, integer, integer, text, jsonb, uuid, boolean, integer)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := 'SELECT 1 FROM api.model_campaign_lists WHERE workspace_id = v_ws AND model_key = v_rec.kind';
  v_new constant text := 'SELECT 1 FROM api.model_capabilities WHERE workspace_id = v_ws AND model_key = v_rec.kind AND capability = ''campaigns''';
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.configure_campaign';
  END IF;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, 'only a record of a model ticked as a campaign list can be a campaign',
                   'only a record of a model with the Campaigns feature can be a campaign');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

DROP FUNCTION api.set_model_campaign_list(text, boolean);
--> statement-breakpoint
DROP TABLE api.model_campaign_lists;
