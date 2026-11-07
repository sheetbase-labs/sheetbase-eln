-- Extensions are installed and managed by administrators only.
--
-- `extensions.manage` used to include the data steward role, like the other
-- governed capabilities. An extension can run code and call outside services on
-- the lab's behalf, so installing, switching and removing them is now for
-- owners and admins.
DO $$
DECLARE
  v_sig regprocedure := 'api.has_capability(uuid, text)'::regprocedure;
  v_def text := pg_get_functiondef(v_sig);
  v_old constant text := $q$WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');$q$;
  v_new constant text := $q$WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin');$q$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.has_capability';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
