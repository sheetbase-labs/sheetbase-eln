-- Pipelines and plugins in the shared registries (docs/development/features.md):
-- the pipeline, run, schedule and plugin events that can start a pipeline;
-- the run, retry, cancel and schedule switch actions a pipeline step may take;
-- deleting a schedule, which agents may do behind a confirmation; and the
-- steward reporting views.
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('extension.disabled'),
  ('extension.enabled'),
  ('extension.installed'),
  ('extension.removed'),
  ('extension.updated'),
  ('pipeline.created'),
  ('pipeline.deleted'),
  ('pipeline.run.cancelled'),
  ('pipeline.run.created'),
  ('pipeline.run.failed'),
  ('pipeline.run.succeeded'),
  ('pipeline.run.updated'),
  ('pipeline.run.waiting'),
  ('pipeline.schedule.created'),
  ('pipeline.schedule.deleted'),
  ('pipeline.schedule.updated'),
  ('pipeline.updated'),
  ('pipeline.version.created'),
  ('pipeline.version.published'),
  ('pipeline.version.retired'),
  ('pipeline.version.updated')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('run_pipeline_version', $action${"operation": "run_pipeline_version", "rpc": "run_pipeline_version", "label": "Run a pipeline version", "description": "Starts a run of one exact published version, as the person the token belongs to, so a script that tested version 4 runs version 4 even after a newer one is published. `p_parameters` sets the pipeline’s parameters and `p_input_versions` maps each input name to the dataset version to read. Returns the run straight away; follow it on `pipeline_runs`. Sends `pipeline.run.created`, then `pipeline.run.succeeded` or `pipeline.run.failed`.", "arguments": [{"name": "p_version_id", "type": "uuid", "required": true, "nullable": false}, {"name": "p_parameters", "type": "jsonb", "required": false, "nullable": false}, {"name": "p_input_versions", "type": "jsonb", "required": false, "nullable": false}]}$action$::jsonb),
  ('retry_pipeline_run', $action${"operation": "retry_pipeline_run", "rpc": "retry_pipeline_run", "label": "Retry a pipeline run", "description": "Runs a failed or cancelled run again, on the same version with the same parameters and inputs, as the Retry button does. The new run points back at the old one (`retry_of_run_id`). Returns the new run. Sends `pipeline.run.created`.", "arguments": [{"name": "p_run_id", "type": "uuid", "required": true, "nullable": false}]}$action$::jsonb),
  ('cancel_pipeline_run', $action${"operation": "cancel_pipeline_run", "rpc": "cancel_pipeline_run", "label": "Cancel a pipeline run", "description": "Stops a running run. The person who started it, or a steward, admin or owner, can cancel it. Returns the run. Sends `pipeline.run.cancelled`.", "arguments": [{"name": "p_workspace_id", "type": "uuid", "required": true, "nullable": false, "server": "workspace"}, {"name": "p_run_id", "type": "uuid", "required": true, "nullable": false}]}$action$::jsonb),
  ('update_pipeline_schedule', $action${"operation": "update_pipeline_schedule", "rpc": "update_pipeline_schedule", "label": "Change a pipeline schedule", "description": "Changes when a schedule runs (`p_kind` and `p_spec`, as for `create_pipeline_schedule`) or switches it off and on (`p_enabled`). Leave a field out to keep it. Returns the schedule. Sends `pipeline.schedule.updated`.", "arguments": [{"name": "p_workspace_id", "type": "uuid", "required": true, "nullable": false, "server": "workspace"}, {"name": "p_schedule_id", "type": "uuid", "required": true, "nullable": false}, {"name": "p_kind", "type": "text", "required": false, "nullable": false}, {"name": "p_spec", "type": "jsonb", "required": false, "nullable": false}, {"name": "p_enabled", "type": "boolean", "required": false, "nullable": false}]}$action$::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.agent_allowed_deletes (action_key) VALUES ('delete_pipeline_schedule')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
SELECT internal.register_reporting_view('pipelines', 'pipelines', 'Pipelines',
  'Pipelines with their key, name and whether they are active or retired.',
  'pipeline_definitions',
  ARRAY['id','display_id','key','name','description','lifecycle','created_at','updated_at','created_by_user_id','updated_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('pipeline_versions', 'pipeline_versions', 'Pipeline versions',
  'Each saved version of a pipeline: draft, published or retired, with its steps and who published it.',
  'pipeline_definition_versions',
  ARRAY['id','definition_id','version','lifecycle','configuration','created_at','created_by_user_id','published_at','published_by_user_id','retired_at','retired_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('pipeline_runs', 'pipeline_runs', 'Pipeline runs',
  'Every pipeline run: how it started, its status, inputs, parameters, result or error, and who ran it.',
  'pipeline_runs',
  ARRAY['id','definition_version_id','trigger_kind','status','attempt','retry_of_run_id','schedule_id','parameters','input_versions','result','error_code','error_message','started_at','finished_at','actor_user_id','created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('pipeline_schedules', 'pipeline_schedules', 'Pipeline schedules',
  'When each pipeline runs by itself, whether the schedule is on, and when it last and next runs.',
  'pipeline_schedules',
  ARRAY['id','definition_id','kind','spec','enabled','last_run_at','next_run_at','created_at','updated_at','created_by_user_id']);
--> statement-breakpoint
SELECT internal.register_reporting_view('pipeline_schedule_activity', 'pipeline_schedule_activity', 'Schedule activity',
  'Times a schedule did not run when it might have, and why.',
  'pipeline_schedule_activity',
  ARRAY['id','schedule_id','kind','message','detail','occurred_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('pipeline_trigger_failures', 'pipeline_trigger_failures', 'Schedule failures',
  'Times a schedule could not start its pipeline, and whether it is still trying.',
  'pipeline_trigger_failures',
  ARRAY['id','schedule_id','error_code','error_message','attempt','status','created_at','updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view('plugins', 'plugins', 'Plugins',
  'The plugins installed in the workspace, their version, whether they are on, and the parts switched off.',
  'extensions',
  ARRAY['id','key','name','version','source','status','disabled_points','manifest','created_at','updated_at','created_by_user_id','updated_by_user_id']);
