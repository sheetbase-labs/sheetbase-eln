-- PROJ-01 / SET-02 — a project cannot change workspace.
--
-- The RLS update policy already refuses a move for anyone without project
-- management, but a non-manager's UPDATE simply matches no row (silent zero
-- rows) rather than failing. Moving a project between workspaces would break
-- every workspace-scoped identity, so it now fails closed explicitly.
CREATE OR REPLACE FUNCTION internal.guard_project_workspace_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'project workspace is immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.guard_project_workspace_immutable() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "projects_guard_workspace"
  BEFORE UPDATE OF "workspace_id" ON "api"."projects"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_project_workspace_immutable"();--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
