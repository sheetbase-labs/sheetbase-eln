-- PROJ-01.3 — archived is a filter, not a lifecycle status.
--
-- The design lists archived projects separately while their status stays
-- In progress / In review / Complete / On hold. archive_project keeps the
-- status and only sets archived_at.

CREATE OR REPLACE FUNCTION api.archive_project(p_project_id uuid)
RETURNS api.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.projects;
BEGIN
  SELECT * INTO v FROM api.projects
    WHERE id = p_project_id AND workspace_id = api.current_workspace_id()
    FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v.workspace_id
      AND m.user_id = api.current_user_id()
      AND m.suspended_at IS NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF v.archived_at IS NOT NULL THEN
    RETURN v;
  END IF;
  UPDATE api.projects
    SET archived_at = now()
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.unarchive_project(p_project_id uuid)
RETURNS api.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.projects;
BEGIN
  SELECT * INTO v FROM api.projects
    WHERE id = p_project_id AND workspace_id = api.current_workspace_id()
    FOR UPDATE;
  IF v.id IS NULL THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v.workspace_id
      AND m.user_id = api.current_user_id()
      AND m.suspended_at IS NULL
      AND m.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF v.archived_at IS NULL THEN
    RETURN v;
  END IF;
  UPDATE api.projects
    SET archived_at = NULL
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
