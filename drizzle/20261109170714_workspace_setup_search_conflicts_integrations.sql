-- Workspace set-up, join domains, the regulated-lab switch, cell conflicts
-- and planner filing for webhooks and pipelines
-- (src/features/workspace/feature.ts).
--
-- 1. Webhook names for the set-up, join domain and regulated-lab changes.
-- 2. Those three may start a pipeline.
-- 3. Pipeline step actions, as src/features/workspace/operations.ts declares them.

INSERT INTO internal.webhook_event_names (name) VALUES
  ('workspace.setup.completed'),
  ('workspace.join_domains.changed'),
  ('workspace.regulated_lab.changed')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('workspace.setup.completed'),
  ('workspace.join_domains.changed'),
  ('workspace.regulated_lab.changed')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('complete_workspace_setup', '{"operation":"complete_workspace_setup","rpc":"complete_workspace_setup","label":"Finish setting up the workspace","description":"The first set-up: the lab’s name (1 to 120 characters), its IANA time zone and which starter tables to add (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`). Marks the workspace set up. Needs workspace admin. Returns `{ installed }`. Sends `workspace.setup.completed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_timezone","type":"text","required":true,"nullable":false},{"name":"p_starter_keys","type":"text[]","required":false,"nullable":false}]}'::jsonb),
  ('install_starter_structures', '{"operation":"install_starter_structures","rpc":"install_starter_structures","label":"Add starter tables","description":"Adds the starter measurement tables the workspace does not have yet (`plate_reader`, `qpcr`, `chromatography`, `cell_counts`, `general`); leave the list out for all of them. They are ordinary tables people can change. Needs to edit tables. Returns the keys added.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_keys","type":"text[]","required":false,"nullable":true}]}'::jsonb),
  ('set_join_domains', '{"operation":"set_join_domains","rpc":"set_join_domains","label":"Set who can join by email domain","description":"Replaces the list of email domains whose people can join the workspace themselves, and the role they join as (`scientist`, `analyst`, `reviewer` or `viewer`). An empty list turns it off. You can only add your own verified email domain; public mail domains and domains another workspace has are refused. Needs to manage members. Returns `{ domains, role }`. Sends `workspace.join_domains.changed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_domains","type":"text[]","required":true,"nullable":false},{"name":"p_role","type":"text","required":false,"nullable":false}]}'::jsonb),
  ('set_regulated_lab', '{"operation":"set_regulated_lab","rpc":"set_regulated_lab","label":"Turn regulated-lab rules on or off","description":"Turns on or off the rules regulated labs need (such as approving parsers before regulated data uses them). Needs to manage General settings. Returns the settings. Sends `workspace.regulated_lab.changed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_regulated","type":"boolean","required":true,"nullable":false}]}'::jsonb),
  ('resolve_cell_conflict', '{"operation":"resolve_cell_conflict","rpc":"resolve_cell_conflict","label":"Settle a cell conflict","description":"Settles a cell that changed in two places while one was offline: the value to keep (either side’s, or another) and why. The decision goes into the sheet’s history under your name. Needs to edit the sheet. Returns the conflict.","arguments":[{"name":"p_conflict_id","type":"uuid","required":true,"nullable":false},{"name":"p_value","type":"jsonb","required":true,"nullable":true},{"name":"p_reason","type":"text","required":true,"nullable":false}]}'::jsonb),
  ('assign_planner_item_to_study', '{"operation":"assign_planner_item_to_study","rpc":"assign_planner_item_to_study","label":"File planner work under a study","description":"Puts a workstream (with its tasks that have no study) or a single task under a study. Give exactly one of the workstream and the task. Needs to edit both.","arguments":[{"name":"p_study_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_workstream_id","type":"uuid","required":false,"nullable":true},{"name":"p_task_id","type":"uuid","required":false,"nullable":true}]}'::jsonb)
  ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
