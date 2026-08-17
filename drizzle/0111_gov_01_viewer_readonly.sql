-- GOV-01: workspace role `viewer` is read-only.
-- Existing viewer memberships stay `viewer`; they lose member-class mutate
-- capabilities (record.create, record.link, instance.upgrade). Scientist,
-- analyst and reviewer remain member-class. H1 capability_mask overlay for
-- the migrator login is unchanged.

CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_user_id() IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  -- Trusted test overlay. session_user is the login role (migrator), not
  -- current_user after SET ROLE and not the function owner.
  IF session_user = 'migrator' THEN
    v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
    IF v_mask IS NOT NULL THEN
      RETURN p_capability = ANY (
        string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
      );
    END IF;
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner',
        'admin',
        'member',
        'steward',
        'scientist',
        'analyst',
        'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;

COMMENT ON FUNCTION api.has_capability(uuid, text) IS
  'GOV-01: viewer is read-only. Member-class mutate capabilities exclude viewer.';
