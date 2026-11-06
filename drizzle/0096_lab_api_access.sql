-- Lab operations for API tokens.
--
-- Reagent orders, stocktakes, shipments, requests, sample workflows, legal
-- holds, instrument feeds and the rest of the lab are now readable and
-- actionable through the external API, MCP and webhooks. This adds the
-- `lab:read` and `lab:write` credential scopes, and lets service credentials
-- (role api_client) read the workspace-wide lab tables. Personal tokens act as
-- the person and use the same row policies as the app, so they need nothing
-- here. Step timers, project follows and the personal work views belong to
-- one person and stay personal-token only.

ALTER TABLE internal.api_credentials
    DROP CONSTRAINT chk_api_credentials_scopes;
--> statement-breakpoint
ALTER TABLE internal.api_credentials
    ADD CONSTRAINT chk_api_credentials_scopes CHECK (
        cardinality(scopes) > 0
        AND scopes <@ ARRAY[
            'projects:read','projects:write','datasets:read','datasets:write',
            'schema:read','schema:write','schema:publish','sheets:read','sheets:write',
            'models:read','models:write','templates:read','templates:write',
            'reviews:read','reviews:write','files:read','files:write',
            'webhooks:read','webhooks:write','agent_operations:read',
            'agent_operations:write','pipelines:read','pipelines:write',
            'lab:read','lab:write','admin:read','admin:write','people:read','people:write'
        ]::text[]
    );
--> statement-breakpoint
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'reagent_orders',
        'recurring_schedules',
        'recurring_occurrences',
        'instrument_service_log',
        'material_safety',
        'material_ingredients',
        'stocktakes',
        'stocktake_items',
        'instrument_feeds',
        'instrument_readings',
        'sample_workflows',
        'sample_workflow_stages',
        'sample_workflow_transitions',
        'sample_workflow_runs',
        'sample_workflow_events',
        'request_forms',
        'shipments',
        'shipment_items',
        'instrument_booking_rules',
        'instrument_required_training',
        'field_spec_limits',
        'model_incident_logs',
        'legal_holds',
        'legal_hold_records',
        'retention_rules',
        'request_details'
    ] LOOP
        EXECUTE format('GRANT SELECT ON TABLE api.%I TO api_client', t);
        EXECUTE format('DROP POLICY IF EXISTS %I ON api.%I', t || '_client_select', t);
        EXECUTE format(
            'CREATE POLICY %I ON api.%I FOR SELECT TO api_client USING (workspace_id = api.current_workspace_id())',
            t || '_client_select', t);
    END LOOP;
END
$$;
--> statement-breakpoint
-- Agents acting in the lab. A connected agent can run lab actions (order,
-- receive, log, start a stocktake and so on) as the person who connected it.
-- Unlike proposals this is not held for approval, so the owner switches it on
-- per workspace; it is off until then.
CREATE OR REPLACE FUNCTION internal.valid_ai_feature_flags(p_flags jsonb)
RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(p_flags) = 'object'
    AND p_flags - ARRAY[
      'assistant','mcp_read','mcp_draft','mcp_workflow',
      'mcp_admin_read','mcp_admin_propose','mcp_lab'
    ]::text[] = '{}'::jsonb
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'assistant','mcp_read','mcp_draft','mcp_workflow',
        'mcp_admin_read','mcp_admin_propose','mcp_lab'
      ]::text[]) AS key
      WHERE jsonb_typeof(p_flags -> key) IS DISTINCT FROM 'boolean'
    )
$$;
--> statement-breakpoint
ALTER TABLE api.workspace_settings
    DROP CONSTRAINT chk_workspace_settings_ai_feature_flags;
--> statement-breakpoint
UPDATE api.workspace_settings
   SET ai_feature_flags = ai_feature_flags || '{"mcp_lab": false}'::jsonb
 WHERE NOT ai_feature_flags ? 'mcp_lab';
--> statement-breakpoint
ALTER TABLE api.workspace_settings
    ADD CONSTRAINT chk_workspace_settings_ai_feature_flags
    CHECK (internal.valid_ai_feature_flags(ai_feature_flags));
--> statement-breakpoint
ALTER TABLE api.workspace_settings
    ALTER COLUMN ai_feature_flags SET DEFAULT '{
        "assistant": true,
        "mcp_read": true,
        "mcp_draft": true,
        "mcp_workflow": false,
        "mcp_admin_read": false,
        "mcp_admin_propose": false,
        "mcp_lab": false
    }'::jsonb;
