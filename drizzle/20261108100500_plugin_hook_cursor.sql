-- Where plugin event reactions have got to in each workspace. Reactions run on
-- their own, whether or not the workspace has any webhook, and this keeps them
-- from reading the same events twice. A workspace starts from "now", so
-- switching a reaction on never replays old events.
CREATE TABLE IF NOT EXISTS internal.plugin_hook_cursor (
  workspace_id uuid PRIMARY KEY REFERENCES api.workspaces(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
