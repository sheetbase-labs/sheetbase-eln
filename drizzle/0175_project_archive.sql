-- PROJ-03.3 — Project archival.
--
-- Archiving is reversible, admin-only and audited by the existing projects
-- change-event trigger. An archived project keeps all of its records readable,
-- but every write to those records is refused (defence in depth: the RPC asks
-- for the admin role, the trigger refuses records whose project is archived).

CREATE OR REPLACE FUNCTION internal.project_is_archived(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, api
AS $$
  SELECT archived_at IS NOT NULL OR status = 'archived'
  FROM api.projects WHERE id = p_project_id
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.project_is_archived(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Reads stay open; writes into (or within) an archived project are refused.
CREATE OR REPLACE FUNCTION internal.assert_record_project_active()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL
     AND internal.project_is_archived(NEW.project_id) THEN
    RAISE EXCEPTION 'project is archived' USING ERRCODE = 'SB004';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER assert_record_project_active
BEFORE INSERT OR UPDATE ON api.records
FOR EACH ROW EXECUTE FUNCTION internal.assert_record_project_active();
--> statement-breakpoint

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
    SET archived_at = now(), status = 'archived'
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.archive_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.archive_project(uuid) TO authenticated;
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
    SET archived_at = NULL, status = 'active'
    WHERE id = v.id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.unarchive_project(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.unarchive_project(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
