-- Pipelines in the external API: read access to the registry and its runs for
-- API keys (`pipelines:read`), and a scope for saving draft versions
-- (`pipelines:write`).
--
-- Reads: api_client already cannot see these tables (they were member-only).
-- Each gets the same workspace-scoped SELECT policy the webhook tables use, so a
-- service credential sees only its own workspace and never writes.
--
-- Writes: nothing is granted to api_client. create_pipeline_definition_version and
-- update_pipeline_definition_version_draft stay `authenticated`-only, so only a
-- personal token (the creating member's own identity) can save a draft; a service
-- credential minted with `pipelines:write` is refused by the database.

GRANT SELECT ON
  api.pipeline_definitions,
  api.pipeline_definition_versions,
  api.pipeline_runs,
  api.pipeline_run_logs,
  api.pipeline_run_outputs
TO api_client;
--> statement-breakpoint

CREATE POLICY pipeline_definitions_client_select ON api.pipeline_definitions
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY pipeline_definition_versions_client_select ON api.pipeline_definition_versions
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY pipeline_runs_client_select ON api.pipeline_runs
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY pipeline_run_logs_client_select ON api.pipeline_run_logs
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY pipeline_run_outputs_client_select ON api.pipeline_run_outputs
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint

ALTER TABLE "internal"."api_credentials" DROP CONSTRAINT "chk_api_credentials_scopes";
--> statement-breakpoint
ALTER TABLE "internal"."api_credentials" ADD CONSTRAINT "chk_api_credentials_scopes" CHECK (cardinality("internal"."api_credentials"."scopes") > 0 AND "internal"."api_credentials"."scopes" <@ ARRAY['projects:read','projects:write','datasets:read','datasets:write','schema:read','schema:write','schema:publish','sheets:read','sheets:write','models:read','models:write','templates:read','templates:write','reviews:read','reviews:write','files:read','files:write','webhooks:read','webhooks:write','agent_operations:read','agent_operations:write','pipelines:read','pipelines:write']::text[]);
