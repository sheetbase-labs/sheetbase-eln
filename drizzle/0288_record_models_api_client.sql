-- MDL-01.3 follow-up — expose record_models to service credentials (read-only).
--
-- 0286 granted api.record_models to authenticated only, so api_client (personal
-- and service credentials used through the external /api/db boundary) could not
-- read a workspace's model definitions. Mirror the record_field_definitions
-- access from 0022: SELECT to api_client plus a workspace-scoped SELECT policy.
-- No write access: authoring stays with authenticated + the schema.edit RPCs.

GRANT SELECT ON "api"."record_models" TO api_client;
--> statement-breakpoint
CREATE POLICY "record_models_select_api_client" ON "api"."record_models"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
