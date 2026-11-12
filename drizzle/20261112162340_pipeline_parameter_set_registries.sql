-- The change events parameter sets emit may be named in a webhook subscription
-- and chosen as a pipeline trigger; the save is a pipeline action the database accepts.
INSERT INTO internal.webhook_event_names (name) VALUES
  ('pipeline.parameter_set.created'),
  ('pipeline.parameter_set.updated'),
  ('pipeline.parameter_set.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('pipeline.parameter_set.created'),
  ('pipeline.parameter_set.updated'),
  ('pipeline.parameter_set.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Pipeline actions, as src/features/pipeline-parameter-sets/operations.ts declares them.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('save_pipeline_parameter_set', '{"operation":"save_pipeline_parameter_set","rpc":"save_pipeline_parameter_set","label":"Save a parameter set","description":"Makes a parameter set, or replaces the one with the same key. `p_parameters` is a list of `{name, type, required, default, description}`, judged as a pipeline judges its own. Pipelines include it by key; versions already saved keep the copy they took. Stewards, admins and owners. Returns the set. Sends `pipeline.parameter_set.created` or `pipeline.parameter_set.updated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_key","type":"text","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_parameters","type":"jsonb","required":true,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO NOTHING;
