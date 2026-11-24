-- Pipeline actions now call a sheet definition a sheet layout.
--
-- The labels and descriptions are user-facing, and the database holds the same
-- definitions as the app declares.

INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('create_sheet_definition', '{"operation":"create_sheet_definition","rpc":"create_sheet_definition","label":"Add a sheet layout","description":"Adds a reusable sheet layout (columns, parameters, calculations) with its first draft version. Returns `{ definition, version }`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_key","type":"text","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":true,"nullable":true},{"name":"p_configuration","type":"jsonb","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('update_sheet_definition', '{"operation":"update_sheet_definition","rpc":"update_sheet_definition","label":"Rename a sheet layout","description":"Changes a sheet layout’s name or description. `p_patch` holds only what changes. Returns the definition.","arguments":[{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false},{"name":"p_patch","type":"jsonb","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('create_sheet_definition_version', '{"operation":"create_sheet_definition_version","rpc":"create_sheet_definition_version","label":"Start a new version of a sheet layout","description":"Starts a draft of the next version of a sheet layout. Returns the version.","arguments":[{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_definition_revision","type":"bigint","required":true,"nullable":false},{"name":"p_configuration","type":"jsonb","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('update_sheet_definition_draft', '{"operation":"update_sheet_definition_draft","rpc":"update_sheet_definition_draft","label":"Change a draft sheet layout","description":"Replaces the layout of a draft version. A published version cannot change. Returns the version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false},{"name":"p_configuration","type":"jsonb","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('publish_sheet_definition_version', '{"operation":"publish_sheet_definition_version","rpc":"publish_sheet_definition_version","label":"Publish a sheet layout","description":"Makes a draft version available for new sheets and templates. Needs `schema:publish`. Returns the version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('retire_sheet_definition_version', '{"operation":"retire_sheet_definition_version","rpc":"retire_sheet_definition_version","label":"Retire a version of a sheet layout","description":"Stops a published version being offered for new sheets. Sheets made from it keep working. Returns the version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('retire_sheet_definition', '{"operation":"retire_sheet_definition","rpc":"retire_sheet_definition","label":"Retire a sheet layout","description":"Stops a sheet layout being offered. Sheets made from it keep working, and it can be restored. Returns the definition.","arguments":[{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('restore_sheet_definition', '{"operation":"restore_sheet_definition","rpc":"restore_sheet_definition","label":"Restore a sheet layout","description":"Offers a retired sheet layout again. Returns the definition.","arguments":[{"name":"p_definition_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('extract_sheet_definition_draft', '{"operation":"extract_sheet_definition_draft","rpc":"extract_sheet_definition_draft","label":"Turn a sheet into a definition","description":"Makes a new sheet layout, as a draft, from the chosen columns of a sheet. Returns `{ definition, version }`.","arguments":[{"name":"p_instance_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_instance_revision","type":"bigint","required":true,"nullable":false},{"name":"p_key","type":"text","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":true,"nullable":true},{"name":"p_selection","type":"jsonb","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('retarget_notebook_template_sheet_placement', '{"operation":"retarget_notebook_template_sheet_placement","rpc":"retarget_notebook_template_sheet_placement","label":"Point a template’s sheet at another version","description":"Changes which sheet layout version a sheet in a draft template is made from. Returns the template version.","arguments":[{"name":"p_version_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false},{"name":"p_placement_id","type":"uuid","required":true,"nullable":false},{"name":"p_target_definition_version_id","type":"uuid","required":true,"nullable":false}]}'::jsonb)
ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
