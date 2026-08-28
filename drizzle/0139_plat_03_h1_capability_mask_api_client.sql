-- PLAT-03 / H1 completion — the capability mask is not caller-controlled.
--
-- api.has_capability honours sheetbase.capability_mask only for the trusted
-- migrator login. The one remaining gap: when the effective request role is
-- api_client AND a capability mask GUC is present in the request context, the
-- function silently ignored the mask and answered from role mapping. A caller
-- probing capability resolution through a foreign GUC must fail closed with
-- 42501 instead of receiving an answer.
--
-- Detection uses the request role GUC (PostgREST's SET ROLE / the test's
-- SET ROLE), which persists inside SECURITY DEFINER where current_user is
-- the function owner. Human sessions (role = authenticated) keep the normal
-- role mapping; only the api_client + mask combination is rejected.

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
  -- PLAT-03: the mask is a trusted migrator overlay. Under the api_client
  -- role, a mask in the request context is an escalation attempt: hard-fail
  -- instead of silently ignoring it.
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RETURN p_capability IN ('record.create', 'record.link', 'instance.upgrade');
  END IF;
  IF api.current_user_id() IS NULL THEN
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
  IF session_user = 'migrator' THEN
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
    -- INT-01: governance surface for connector registration/pausing.
    WHEN p_capability = 'integrations.manage' THEN
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
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.has_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO api_client;

--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
