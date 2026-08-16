-- H1: honour sheetbase.capability_mask only for the trusted migrator login.
-- Application roles (authenticator / authenticated / api_client) always use
-- workspace membership mapping. session_user is the connection login even
-- inside this SECURITY DEFINER function.

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
      RETURN true;
    ELSE
      RETURN false;
  END CASE;
END;
$$;

-- Fixture writes as migrator still skip publish checks. A capability overlay
-- on the same login must still enforce schema.publish.
CREATE OR REPLACE FUNCTION internal.require_schema_publish_for_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  workspace uuid;
  v_mask text;
BEGIN
  IF session_user = 'migrator' THEN
    v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
    IF v_mask IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'dataset_schema_versions' THEN
    SELECT s.workspace_id INTO workspace
      FROM api.dataset_schema_definitions s WHERE s.id = NEW.schema_id;
    IF TG_OP = 'INSERT' AND NEW.lifecycle IS DISTINCT FROM 'draft' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.lifecycle = 'draft'
          AND NEW.lifecycle IS DISTINCT FROM OLD.lifecycle THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'dataset_schema_definitions' THEN
    workspace := NEW.workspace_id;
    IF TG_OP = 'INSERT' AND NEW.lifecycle IS DISTINCT FROM 'draft' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.lifecycle = 'draft'
          AND NEW.lifecycle = 'active' THEN
      IF NOT api.has_capability(workspace, 'schema.publish') THEN
        RAISE EXCEPTION 'capability required: schema.publish' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
