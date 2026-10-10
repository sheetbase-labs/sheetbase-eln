-- SET-02 / PROJ-01 — project edits need edit authority, not management.
--
-- The 0323 restrictive update policy required `can_manage_project`, so a
-- project editor could not change the project's own metadata (title, modality,
-- stage, agreement) even though editing is exactly what an editor role is for;
-- the UPDATE matched no row and silently changed nothing. Access-rule changes
-- remain management-gated in `api.set_project_access_rule` itself, so the
-- table policy now matches the edit authority it means to express. This also
-- lets the workspace-immutability guard fire instead of the update silently
-- matching no row.
ALTER POLICY "projects_live_update" ON "api"."projects"
  USING (internal.can_edit_project(id))
  WITH CHECK (internal.can_edit_project(id));--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
