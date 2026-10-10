-- EXP-03.2 — a draft experiment is private to its author (and workspace administrators).
--
-- The read policies on api.records are permissive and OR together, so a workspace
-- member can read any record in the workspace, drafted or not. A RESTRICTIVE policy
-- ANDs with them, which is the only way to narrow a read the permissive policies
-- already allow.
--
-- The rule is scoped to experiments in the draft state: the experiment lifecycle is
-- what gives 'draft' a meaning here, and widening it to every record kind would change
-- read behaviour the rest of the application depends on. Starting an experiment moves
-- it out of draft, which is what makes it visible to the team.
CREATE POLICY records_draft_experiment_private ON api.records
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    NOT (kind = 'experiment' AND status = 'draft')
    OR created_by_user_id = api.current_user_id()
    OR api.has_capability(workspace_id, 'workspace.admin')
  );
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
