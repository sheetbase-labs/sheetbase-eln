-- Projects, folders, the Inbox and the audit log for the API, webhooks,
-- pipelines and steward SQL.
--
-- 1. A record that changes project or folder now says so: its change event is
--    `move` (webhook `record.moved`) instead of a plain update.
-- 2. The audit log search answers personal tokens. It asked for a browser
--    session, which only attestation needs; who may read what is unchanged.
-- 3. Webhook names for folders, audit checks and SQL logins.
-- 4. Steward SQL views: folders, what is filed in them, project follows, kept
--    audit trails and the audit log itself (without payloads).
-- 5-7. Registry rows: a delete agents may do, pipeline triggers and actions.

-- 1. Record moves.
DO $$
DECLARE
  v_def text;
  v_old text := $old$    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'title', NEW.title, 'status', NEW.status,$old$;
  v_new text := $new$    ELSIF OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
      v_op := 'move';
    ELSE
      v_op := 'update';
    END IF;
    v_payload := jsonb_build_object(
      'title', NEW.title, 'status', NEW.status,
      'fromProjectId', CASE WHEN OLD.project_id IS DISTINCT FROM NEW.project_id THEN OLD.project_id END,$new$;
BEGIN
  SELECT pg_get_functiondef('internal.trg_change_event_records()'::regprocedure) INTO v_def;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.trg_change_event_records';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END $$;
--> statement-breakpoint

-- 2. Audit log search for personal tokens.
DO $$
DECLARE
  v_def text;
  v_old text := $old$     OR nullif(v_claims->>'session_id', '') IS NULL
$old$;
BEGIN
  SELECT pg_get_functiondef('api.audit_events(text, text, text, timestamp with time zone, timestamp with time zone, text, uuid, bigint, integer, uuid)'::regprocedure) INTO v_def;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.audit_events';
  END IF;
  EXECUTE replace(v_def, v_old, '');
END $$;
--> statement-breakpoint

-- 3. Webhook names.
INSERT INTO internal.webhook_event_names (name) VALUES
  ('folder.created'), ('folder.updated'), ('folder.deleted'), ('folder.items_moved'),
  ('audit.verified'),
  ('sql_login.created'), ('sql_login.revoked')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 4. Steward SQL views.
SELECT internal.register_reporting_view(
  'folders', 'folders', 'Folders',
  'The folders in each project, with the folder they sit in.',
  'folders',
  ARRAY['id', 'project_id', 'parent_id', 'identifier', 'name', 'archived_at', 'created_at', 'updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view(
  'folder_items', 'folder_items', 'Filed in folders',
  'Datasets, sheets, analysis views and pipelines filed in a folder. Records name their folder themselves.',
  'folder_items',
  ARRAY['id', 'folder_id', 'object_kind', 'object_id', 'created_by_user_id', 'created_at', 'updated_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view(
  'project_follows', 'project_follows', 'Project followers',
  'Who follows which project.',
  'project_follows',
  ARRAY['project_id', 'user_id', 'created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view(
  'trail_evidence', 'trail_evidence', 'Kept audit trails',
  'Steps of a record''s history kept as evidence, with who kept them and why.',
  'trail_evidence',
  ARRAY['id', 'record_id', 'steps', 'note', 'saved_by_user_id', 'created_at']);
--> statement-breakpoint
SELECT internal.register_reporting_view(
  'audit_log', 'audit_log', 'Audit log',
  'Every change, in order: what kind of thing, which one, what happened, who did it and when, with the fingerprint chain. Payloads are left out; read them through the audit log search.',
  'change_events',
  ARRAY['sequence', 'id', 'entity_type', 'entity_uuid', 'operation', 'record_id', 'project_id', 'actor_user_id', 'actor_credential_id', 'created_at', 'previous_hash', 'entry_hash']);
--> statement-breakpoint

-- 5. An agent may delete a folder, behind a confirmation like any other write:
-- what was in it stays (records must be moved out first, folders inside move
-- up a level). Mirrors agentMayDelete in src/features/projects/feature.ts.
INSERT INTO internal.agent_allowed_deletes (action_key) VALUES ('delete_project_folder')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 6. Events that may start a pipeline.
INSERT INTO internal.pipeline_trigger_events (name) VALUES
  ('project.created'),
  ('project.updated'),
  ('project.deleted'),
  ('project.archived'),
  ('project.restored'),
  ('folder.created'),
  ('folder.updated'),
  ('folder.deleted'),
  ('folder.items_moved'),
  ('audit.verified'),
  ('sql_login.created'),
  ('sql_login.revoked')
  ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 7. Pipeline step actions, as src/features/projects/operations.ts declares them.
INSERT INTO internal.pipeline_actions (operation, definition) VALUES
  ('update_project_details', '{"operation":"update_project_details","rpc":"update_project_details","label":"Edit a project","description":"Leave out what stays. `p_expected_revision` is the project’s `revision` as you read it, so two edits cannot overwrite each other. Needs to manage the project. Returns the project. Sends `project.updated`.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false},{"name":"p_title","type":"text","required":false,"nullable":true},{"name":"p_client_id","type":"uuid","required":false,"nullable":true},{"name":"p_modality","type":"text","required":false,"nullable":true},{"name":"p_stage","type":"text","required":false,"nullable":true},{"name":"p_lead_user_id","type":"text","required":false,"nullable":true},{"name":"p_default_reviewer_user_id","type":"text","required":false,"nullable":true},{"name":"p_agreement_reference","type":"text","required":false,"nullable":true},{"name":"p_started_on","type":"date","required":false,"nullable":true}]}'::jsonb),
  ('archive_project', '{"operation":"archive_project","rpc":"archive_project","label":"Archive a project","description":"Hides the project from everyday lists. Nothing is deleted and it can be restored. Needs to manage the project. Returns the project. Sends `project.archived`.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('unarchive_project', '{"operation":"unarchive_project","rpc":"unarchive_project","label":"Restore a project","description":"Brings an archived project back. Needs to manage the project. Returns the project. Sends `project.restored`.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('create_project_from_structure', '{"operation":"create_project_from_structure","rpc":"create_project_from_structure","label":"Start a project like another","description":"Makes a project with the source project’s plan (its tasks and deliverables, all set back to not started) and none of its records. Needs to manage the source. `p_expected_source_revision` is the source’s `revision`. Returns the new project. Sends `project.created`.","arguments":[{"name":"p_source_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_source_revision","type":"bigint","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_client_id","type":"uuid","required":false,"nullable":true},{"name":"p_modality","type":"text","required":false,"nullable":true},{"name":"p_stage","type":"text","required":false,"nullable":true},{"name":"p_lead_user_id","type":"text","required":false,"nullable":true},{"name":"p_default_reviewer_user_id","type":"text","required":false,"nullable":true},{"name":"p_agreement_reference","type":"text","required":false,"nullable":true},{"name":"p_started_on","type":"date","required":false,"nullable":true}]}'::jsonb),
  ('create_plan_from_project', '{"operation":"create_plan_from_project","rpc":"create_plan_from_project","label":"Copy a project’s plan","description":"Copies the phases, milestones and their conditions from the source project into the target, moved so the first starts on `p_start_date`. Needs to be able to write in the workspace. Returns the counts of what was copied.","arguments":[{"name":"p_target_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_source_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_start_date","type":"date","required":true,"nullable":false}]}'::jsonb),
  ('move_record_to_project', '{"operation":"move_record_to_project","rpc":"move_record_to_project","label":"Move a record to another project","description":"Moves the record and everything in it. `p_expected_metadata_version` is the record’s `metadata_version`. Needs to edit both projects. Returns the record. Sends `record.moved`.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"bigint","required":true,"nullable":false}]}'::jsonb),
  ('create_project_folder', '{"operation":"create_project_folder","rpc":"create_project_folder","label":"Make a folder","description":"Optionally inside another folder. Needs to edit the project. Returns the folder. Sends `folder.created`.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_parent_id","type":"uuid","required":false,"nullable":true}]}'::jsonb),
  ('rename_project_folder', '{"operation":"rename_project_folder","rpc":"rename_project_folder","label":"Rename a folder","description":"Returns the folder. Sends `folder.updated`.","arguments":[{"name":"p_folder_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false}]}'::jsonb),
  ('delete_project_folder', '{"operation":"delete_project_folder","rpc":"delete_project_folder","label":"Delete a folder","description":"A folder that still holds records cannot be deleted; move them first. Folders inside it move up one level. Needs to edit the project. Sends `folder.deleted`.","arguments":[{"name":"p_folder_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('move_records_to_folder', '{"operation":"move_records_to_folder","rpc":"move_records_to_folder","label":"Put records in a folder","description":"Moves records of one project into a folder of that project; leave the folder out to take them out of their folder. Returns how many moved. Sends `record.moved` for each.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_record_ids","type":"uuid[]","required":true,"nullable":false},{"name":"p_folder_id","type":"uuid","required":true,"nullable":true}]}'::jsonb),
  ('move_to_folder', '{"operation":"move_to_folder","rpc":"move_to_folder","label":"Put datasets, sheets and pipelines in a folder","description":"A JSON array of `{ \"kind\": \"dataset\" | \"sheet_instance\" | \"analysis_view\" | \"pipeline_definition\", \"id\": \"…\" }`; leave the folder out to take them out of their folder. Returns how many moved. Sends `folder.item_placed` or `folder.item_removed` for each.","arguments":[{"name":"p_items","type":"jsonb","required":true,"nullable":false},{"name":"p_folder_id","type":"uuid","required":true,"nullable":true}]}'::jsonb),
  ('follow_record', '{"operation":"follow_record","rpc":"follow_record","label":"Follow a record","description":"Its changes show in your Inbox under Following. Needs a personal token. Returns when you started following.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('unfollow_record', '{"operation":"unfollow_record","rpc":"unfollow_record","label":"Stop following a record","description":"Needs a personal token.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('run_audit_verification', '{"operation":"run_audit_verification","rpc":"run_audit_verification","label":"Check the audit log and signatures now","description":"Runs the full check the nightly job runs and adds its result to the audit log. Changes nothing else. Needs to manage audit settings. Returns the result. Sends `audit.verified`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false}]}'::jsonb),
  ('save_trail_evidence', '{"operation":"save_trail_evidence","rpc":"save_trail_evidence","label":"Keep a trail as evidence","description":"Saves the steps you picked from a record’s history, with a note, so they can be shown later. Saved evidence cannot be changed. Returns what was saved.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_steps","type":"jsonb","required":true,"nullable":false},{"name":"p_note","type":"text","required":false,"nullable":true}]}'::jsonb),
  ('revoke_sql_login', '{"operation":"revoke_sql_login","rpc":"revoke_sql_login","label":"Revoke a SQL login","description":"The login stops working at once. Your own, or anyone’s for an owner or admin. Sends `sql_login.revoked`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_login_id","type":"uuid","required":true,"nullable":false}]}'::jsonb)
  ON CONFLICT (operation) DO UPDATE SET definition = EXCLUDED.definition;
--> statement-breakpoint
