-- API-005 follow-up: give the api_client request role (created by
-- docker/db/init/00-roles.sh) a workspace-scoped window into api.projects,
-- enforced by RLS. The browser-session path (AUTH-004) ties access to a
-- user membership; the external path trusts the workspace_id claim on the
-- short-lived JWT the application minted after verifying the credential,
-- so it does not require a user id.
--
-- Scope breadth (projects:read vs projects:write, no delete) is enforced at
-- the application proxy before the request reaches PostgREST — see
-- src/lib/external-token.ts. RLS here only guarantees workspace isolation,
-- so a leaked or over-scoped token still cannot cross workspaces.

-- The init script grants api_client USAGE on the api schema on first volume
-- initialisation; repeat it here so a freshly created test database (which
-- skips the init script) also grants it.
GRANT USAGE ON SCHEMA api TO api_client;--> statement-breakpoint

-- api_client can read the claim helpers it needs. claim_probe is not
-- SECURITY DEFINER, so the caller must hold EXECUTE on it and on
-- current_workspace_id; is_workspace_member is not used by api_client
-- policies (there is no user id in the external claim set).
GRANT EXECUTE ON FUNCTION "api"."claim_probe"() TO api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."current_workspace_id"() TO api_client;--> statement-breakpoint

-- No DELETE for api_client: external credentials cannot destroy projects
-- in Phase 1. A projects:write scope still allows INSERT/UPDATE.
GRANT SELECT, INSERT, UPDATE ON "api"."projects" TO api_client;--> statement-breakpoint

-- RLS policies for api_client. workspace_id is pinned to the active claim
-- on every path; inserts/updates cannot target another workspace.
CREATE POLICY "projects_select_api_client" ON "api"."projects"
  FOR SELECT TO api_client
  USING (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "projects_insert_api_client" ON "api"."projects"
  FOR INSERT TO api_client
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

CREATE POLICY "projects_update_api_client" ON "api"."projects"
  FOR UPDATE TO api_client
  USING (workspace_id = "api"."current_workspace_id"())
  WITH CHECK (workspace_id = "api"."current_workspace_id"());--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
