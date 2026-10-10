-- PIPE-04.2 — a run's artefacts were released, and whether they were kept.
--
-- The run's own `result` cannot record this: it is deliberately immutable once the run has
-- settled, so writing the release into it is refused. That guard is right — a settled run's
-- evidence must not change — so the release gets its own record instead.
--
-- One row per run, written when the runner has actually released the files. It is what stops
-- a sweep asking about the same run on every tick, and it is also the answer to "where did
-- this run's figures go": a run with no row has not been dealt with yet, and `kept` says
-- whether its artefacts outlived it because a proposal references them.

CREATE TABLE api.pipeline_artefact_releases (
  run_id uuid PRIMARY KEY REFERENCES api.pipeline_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
  kept boolean NOT NULL,
  released_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX idx_pipeline_artefact_releases_workspace
  ON api.pipeline_artefact_releases(workspace_id);
--> statement-breakpoint

ALTER TABLE api.pipeline_artefact_releases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY pipeline_artefact_releases_select ON api.pipeline_artefact_releases
  FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON api.pipeline_artefact_releases TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
