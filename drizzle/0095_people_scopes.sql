-- API scopes for people and continuity.
--
-- A personal token may hold `people:read` and `people:write` to hand over work,
-- set an out of office and map sign-in groups to roles from a script or an
-- integration. The token acts as its member, so their own permissions apply.

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
      'admin:read','admin:write','people:read','people:write'
    ]::text[]
  );
