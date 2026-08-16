-- CORE-01.6: schema authority is a distinct server-side capability boundary.
-- The current role mapping intentionally preserves existing Model and Dataset
-- owner/admin behaviour; later capability grants may change this function
-- without granting ordinary Record-edit authority.
CREATE OR REPLACE FUNCTION api.has_schema_capability(
  p_workspace uuid,
  p_capability text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT api.current_workspace_id() = p_workspace
    AND CASE p_capability
      WHEN 'model_field.manage' THEN EXISTS (
        SELECT 1 FROM api.workspace_memberships membership
        WHERE membership.workspace_id = p_workspace
          AND membership.user_id = api.current_user_id()
          AND membership.suspended_at IS NULL
          AND membership.role IN ('owner', 'admin')
      )
      WHEN 'dataset_schema.publish' THEN EXISTS (
        SELECT 1 FROM api.workspace_memberships membership
        WHERE membership.workspace_id = p_workspace
          AND membership.user_id = api.current_user_id()
          AND membership.suspended_at IS NULL
          AND membership.role = 'owner'
      )
      WHEN 'dataset_schema.retire' THEN EXISTS (
        SELECT 1 FROM api.workspace_memberships membership
        WHERE membership.workspace_id = p_workspace
          AND membership.user_id = api.current_user_id()
          AND membership.suspended_at IS NULL
          AND membership.role = 'owner'
      )
      WHEN 'schema_relationship.retire' THEN EXISTS (
        SELECT 1 FROM api.workspace_memberships membership
        WHERE membership.workspace_id = p_workspace
          AND membership.user_id = api.current_user_id()
          AND membership.suspended_at IS NULL
          AND membership.role = 'owner'
      )
      ELSE false
    END
$$;
REVOKE EXECUTE ON FUNCTION api.has_schema_capability(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.has_schema_capability(uuid,text) TO authenticated;
--> statement-breakpoint

-- Keep the established Model RPC contract but route it through the explicit
-- capability primitive. Record-edit permissions never satisfy this check.
CREATE OR REPLACE FUNCTION api.is_model_field_admin(p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT api.has_schema_capability(p_workspace, 'model_field.manage')
$$;
REVOKE EXECUTE ON FUNCTION api.is_model_field_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.is_model_field_admin(uuid) TO authenticated;
