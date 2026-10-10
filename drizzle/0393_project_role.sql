-- PROJ-03.1 — project_role alongside access_level.
--
-- The task keeps the two concepts separate: access_level stays the permission
-- (owner/editor/reviewer/viewer, enforced through the can_* flags), and project_role
-- records what the person does on the project (lead, scientist, default reviewer,
-- oversight). The role is descriptive, so it is nullable and does not affect the
-- permission flags. Groups arrive with DEC-06/SET-02 and client rows with PORTAL.

ALTER TABLE api.project_access ADD COLUMN IF NOT EXISTS project_role text;
--> statement-breakpoint
ALTER TABLE api.project_access DROP CONSTRAINT IF EXISTS project_access_project_role_check;
--> statement-breakpoint
ALTER TABLE api.project_access
  ADD CONSTRAINT project_access_project_role_check
  CHECK (
    project_role IS NULL
    OR project_role IN ('lead', 'scientist', 'default_reviewer', 'oversight')
  );
--> statement-breakpoint

-- grant_project_access now records the role as well as the permission. The role is
-- optional so every existing caller keeps working; the permission path is unchanged and
-- still delegates to set_project_member.
DROP FUNCTION IF EXISTS api.grant_project_access(uuid, uuid, text, text);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.grant_project_access(
  p_workspace_id uuid,
  p_project_id uuid,
  p_user_id text,
  p_access_level text DEFAULT 'viewer',
  p_project_role text DEFAULT NULL
)
RETURNS api.project_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_row api.project_access;
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Workspace mismatch' USING ERRCODE='42501';
  END IF;
  IF p_project_role IS NOT NULL
     AND p_project_role NOT IN ('lead', 'scientist', 'default_reviewer', 'oversight') THEN
    RAISE EXCEPTION 'Unknown project role' USING ERRCODE='22023';
  END IF;

  v_row := api.set_project_member(p_project_id, p_user_id, p_access_level);

  IF p_project_role IS NOT NULL THEN
    UPDATE api.project_access
       SET project_role = p_project_role,
           updated_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END $function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION api.grant_project_access(uuid, uuid, text, text, text) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.grant_project_access(uuid, uuid, text, text, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
