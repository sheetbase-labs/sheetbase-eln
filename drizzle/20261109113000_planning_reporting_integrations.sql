-- Planning and reporting reach the API, MCP, the assistant, pipelines and
-- webhooks: studies and the planner, reports, plate designs, analysis views.
--
--   * save and delete calls for analysis views and definitions (the app wrote
--     these straight to the tables, which tokens cannot do)
--   * change events for analysis views, and report generations no longer carry
--     the whole generated document
--   * the webhook event names, the pipeline trigger list and the database's
--     copy of the pipeline action catalogue gain the new entries

-- ---------------------------------------------------------------------------
-- Analysis views and definitions
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.save_analysis_view(p_id uuid, p_name text, p_charts jsonb, p_source_revisions jsonb, p_export_settings jsonb DEFAULT NULL)
    RETURNS api.analysis_views
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
  v_view api.analysis_views;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO api.analysis_views (workspace_id, owner_user_id, name, charts, source_revisions, export_settings)
    VALUES (api.current_workspace_id(), api.current_user_id(), p_name, p_charts, p_source_revisions, p_export_settings)
    RETURNING * INTO v_view;
  ELSE
    UPDATE api.analysis_views
       SET name = p_name, charts = p_charts, source_revisions = p_source_revisions, export_settings = p_export_settings
     WHERE id = p_id
    RETURNING * INTO v_view;
    IF v_view.id IS NULL THEN
      RAISE EXCEPTION 'analysis view not found' USING ERRCODE = 'SB015';
    END IF;
  END IF;
  RETURN v_view;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_analysis_view(uuid, text, jsonb, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_analysis_view(uuid, text, jsonb, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_analysis_view(uuid, text, jsonb, jsonb, jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_analysis_view(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM api.analysis_views WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis view not found' USING ERRCODE = 'SB015';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_analysis_view(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_analysis_view(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_analysis_view(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.save_analysis_definition(p_id uuid, p_name text, p_definition jsonb, p_source_revisions jsonb)
    RETURNS api.analysis_definitions
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
DECLARE
  v_definition api.analysis_definitions;
BEGIN
  IF p_id IS NULL THEN
    INSERT INTO api.analysis_definitions (workspace_id, owner_user_id, name, definition, source_revisions)
    VALUES (api.current_workspace_id(), api.current_user_id(), p_name, p_definition, p_source_revisions)
    RETURNING * INTO v_definition;
  ELSE
    UPDATE api.analysis_definitions
       SET name = p_name, definition = p_definition, source_revisions = p_source_revisions
     WHERE id = p_id
    RETURNING * INTO v_definition;
    IF v_definition.id IS NULL THEN
      RAISE EXCEPTION 'analysis definition not found' USING ERRCODE = 'SB015';
    END IF;
  END IF;
  RETURN v_definition;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_analysis_definition(uuid, text, jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_analysis_definition(uuid, text, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_analysis_definition(uuid, text, jsonb, jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_analysis_definition(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY INVOKER
    SET search_path TO ''
    AS $$
BEGIN
  DELETE FROM api.analysis_definitions WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'analysis definition not found' USING ERRCODE = 'SB015';
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_analysis_definition(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_analysis_definition(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_analysis_definition(uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Change events
-- ---------------------------------------------------------------------------
-- An analysis view's charts can be large, so the event carries only who and
-- what. A "resolve" event is written by the function that decides about newer
-- data and is left alone.
CREATE FUNCTION internal.trg_change_event_analysis_view() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.analysis_views;
  v_op text;
BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_row := NEW;
    WHEN 'UPDATE' THEN v_op := 'update'; v_row := NEW;
    ELSE v_op := 'delete'; v_row := OLD;
  END CASE;
  PERFORM internal.emit_change_event(
    v_row.workspace_id, 'analysis_view', v_row.id, v_op, NULL, NULL,
    jsonb_build_object('id', v_row.id, 'displayId', v_row.display_id, 'name', v_row.name,
                       'version', v_row.version, 'ownerUserId', v_row.owner_user_id));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_analysis_view() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_analysis_views AFTER INSERT OR UPDATE OR DELETE ON api.analysis_views
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_analysis_view();
--> statement-breakpoint

-- A generated report's document stays out of its event: it can be megabytes.
CREATE OR REPLACE FUNCTION internal.trg_change_event_report() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_entity text; v_op text; v_payload jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op:='create'; v_payload:=to_jsonb(NEW)-'metadata'-'output_html';
    WHEN 'UPDATE' THEN v_op:='update'; v_payload:=to_jsonb(NEW)-'metadata'-'output_html';
    WHEN 'DELETE' THEN v_op:='delete'; v_payload:=to_jsonb(OLD)-'metadata'-'output_html';
  END CASE;
  PERFORM internal.emit_change_event(COALESCE(NEW.workspace_id,OLD.workspace_id),v_entity,COALESCE(NEW.id,OLD.id),v_op,NULL,NULL,v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Webhook event names, pipeline triggers, pipeline actions
-- ---------------------------------------------------------------------------
INSERT INTO internal.webhook_event_names (name) VALUES
  ('study.workstream.created'),
  ('study.workstream.updated'),
  ('study.workstream.deleted'),
  ('study.task.created'),
  ('study.task.updated'),
  ('study.task.deleted'),
  ('study.deliverable.created'),
  ('study.deliverable.updated'),
  ('study.deliverable.deleted'),
  ('study.plan.snapshotted'),
  ('report.created'),
  ('report.updated'),
  ('report.generated'),
  ('plate_design.created'),
  ('plate_design.updated'),
  ('plate_layout_template.created'),
  ('plate_layout_template.updated'),
  ('analysis_view.created'),
  ('analysis_view.updated'),
  ('analysis_view.deleted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''step.result_added'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''step.result_added'',',
    '''step.result_added'', ''study.workstream.created'', ''study.workstream.updated'', ''study.workstream.deleted'', ''study.task.created'', ''study.task.updated'', ''study.task.deleted'', ''study.deliverable.created'', ''study.deliverable.updated'', ''study.deliverable.deleted'', ''study.plan.snapshotted'', ''report.created'', ''report.updated'', ''report.generated'', ''plate_design.created'', ''plate_design.updated'', ''plate_layout_template.created'', ''plate_layout_template.updated'', ''analysis_view.created'', ''analysis_view.updated'', ''analysis_view.deleted'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"create_study","rpc":"create_study","label":"Create a study","description":"Creates a study: a record that groups projects and experiments and carries the plan. Returns the study record.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_home_project_id","type":"uuid","required":false,"nullable":false},{"name":"p_summary","type":"text","required":false,"nullable":false},{"name":"p_starts_on","type":"date","required":false,"nullable":false},{"name":"p_ends_on","type":"date","required":false,"nullable":false},{"name":"p_custom_fields","type":"jsonb","required":false,"nullable":false}]},{"operation":"link_study_experiment","rpc":"link_study_experiment","label":"Add an experiment to a study","description":"Makes an experiment part of a study. `p_relationship` is `member` by default. Returns the link.","arguments":[{"name":"p_study_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_experiment_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_relationship","type":"text","required":false,"nullable":false}]},{"operation":"create_study_task","rpc":"create_study_task","label":"Add a task or milestone to the planner","description":"Adds a task or milestone to the study planner. `p_task_type` is `task` (default) or `milestone`; `p_status` is `not_started` by default (or `in_progress`, `review`, `completed`, `blocked`, `cancelled`) and `p_priority` is `low`, `medium` (default), `high` or `critical`. Returns the task. Sends `study.task.created`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_task_type","type":"text","required":false,"nullable":false},{"name":"p_workstream_id","type":"uuid","required":false,"nullable":true},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_description","type":"text","required":false,"nullable":true},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_priority","type":"text","required":false,"nullable":false},{"name":"p_starts_at","type":"timestamptz","required":false,"nullable":true},{"name":"p_ends_at","type":"timestamptz","required":false,"nullable":true},{"name":"p_due_at","type":"timestamptz","required":false,"nullable":true},{"name":"p_linked_experiment_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_linked_protocol_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_tags","type":"text[]","required":false,"nullable":false}]},{"operation":"edit_study_task","rpc":"edit_study_task","label":"Change a planner task","description":"Changes a task or milestone: title, description, status (`not_started`, `in_progress`, `review`, `completed`, `blocked`, `cancelled`), priority, dates, progress, links or tags. Leave a field out to keep it. To move a due date that people have been told about, use `move_study_task_due`, which keeps the reason. Returns the task. Sends `study.task.updated`.","arguments":[{"name":"p_task_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":false,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false},{"name":"p_task_type","type":"text","required":false,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_priority","type":"text","required":false,"nullable":false},{"name":"p_starts_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_ends_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":false,"nullable":false},{"name":"p_workstream_id","type":"text","required":false,"nullable":false},{"name":"p_project_id","type":"uuid","required":false,"nullable":false},{"name":"p_progress_percent","type":"integer","required":false,"nullable":false},{"name":"p_linked_experiment_record_id","type":"uuid","required":false,"nullable":false},{"name":"p_linked_protocol_record_id","type":"uuid","required":false,"nullable":false},{"name":"p_tags","type":"text[]","required":false,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":false,"nullable":false}]},{"operation":"delete_study_task","rpc":"delete_study_task","label":"Delete a planner task","description":"Removes a task or milestone from the planner, with its deliverables and dependencies. Sends `study.task.deleted`.","arguments":[{"name":"p_task_id","type":"uuid","required":true,"nullable":false}]},{"operation":"move_study_task_due","rpc":"move_study_task_due","label":"Move a task’s due date","description":"Moves the due date and keeps the reason in the task’s history. `p_notify_client` tells the client when the task is shared with them. Returns the task. Sends `study.task.updated`.","arguments":[{"name":"p_task_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":true,"nullable":true},{"name":"p_reason","type":"text","required":true,"nullable":false},{"name":"p_notify_client","type":"boolean","required":false,"nullable":false}]},{"operation":"delete_dependency","rpc":"delete_dependency","label":"Remove a dependency between tasks","description":"Removes the dependency.","arguments":[{"name":"p_dependency_id","type":"uuid","required":true,"nullable":false}]},{"operation":"create_study_deliverable","rpc":"create_study_deliverable","label":"Add a deliverable to a task","description":"Adds something the task must produce. `p_status` is `planned` (default), `in_progress`, `delivered` or `overdue`. Returns `{ id, taskId, name, status, dueAt, position }`. Sends `study.deliverable.created`.","arguments":[{"name":"p_task_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":false,"nullable":true}]},{"operation":"update_study_deliverable","rpc":"update_study_deliverable","label":"Change a deliverable","description":"Changes a deliverable’s name, description, status or due date. Leave a field out to keep it. Returns the deliverable. Sends `study.deliverable.updated`.","arguments":[{"name":"p_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":false,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_due_at","type":"timestamptz","required":false,"nullable":false}]},{"operation":"snapshot_study_plan","rpc":"snapshot_study_plan","label":"Keep a snapshot of a study’s plan","description":"Saves the whole plan of a study as it stands, with a checksum, so a later change can be compared with it. Returns the snapshot. Sends `study.plan.snapshotted`.","arguments":[{"name":"p_study_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":false}]},{"operation":"create_report_definition","rpc":"create_report_definition","label":"Create a report","description":"Starts a report, optionally in a project and from a template. Returns the report. Sends `report.created`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_subtitle","type":"text","required":false,"nullable":true},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_template_record_id","type":"uuid","required":false,"nullable":true}]},{"operation":"update_report_definition","rpc":"update_report_definition","label":"Change a report","description":"Changes a report’s title, subtitle, status (`draft`, `in_review`, `approved`, `published`, `archived`) or template. Leave a field out to keep it. Returns the report. Sends `report.updated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_report_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":false,"nullable":false},{"name":"p_subtitle","type":"text","required":false,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_template_record_id","type":"uuid","required":false,"nullable":false},{"name":"p_review_submission_id","type":"uuid","required":false,"nullable":false}]},{"operation":"add_report_section","rpc":"add_report_section","label":"Add a section to a report","description":"Adds a section to the end of a report. `p_section_type` is `text` by default; `p_source_type` says where the content comes from (`free_text` by default). Returns the section.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_report_id","type":"uuid","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_description","type":"text","required":false,"nullable":false},{"name":"p_section_type","type":"text","required":false,"nullable":false},{"name":"p_source_type","type":"text","required":false,"nullable":false}]},{"operation":"bind_report_section_source","rpc":"bind_report_section_source","label":"Point a report section at its data","description":"Fills a section from a saved revision (a chart, table or analysis), so the report always shows that exact data. `p_source_ref` says which part. Returns the section.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_section_id","type":"uuid","required":true,"nullable":false},{"name":"p_source_revision_id","type":"uuid","required":true,"nullable":false},{"name":"p_source_ref","type":"jsonb","required":false,"nullable":false}]},{"operation":"validate_report","rpc":"validate_report","label":"Check a report is ready","description":"Checks every section: whether its source still exists and is unchanged. Returns the findings; nothing is changed.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_report_id","type":"uuid","required":true,"nullable":false}]},{"operation":"generate_report","rpc":"generate_report","label":"Generate a report","description":"Builds the report from its sections as they stand now and keeps the result with a checksum. `p_output_format` is `html` (default) or `pdf`. Returns the generation. Sends `report.generated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_report_id","type":"uuid","required":true,"nullable":false},{"name":"p_output_format","type":"text","required":false,"nullable":false}]},{"operation":"create_plate_design","rpc":"create_plate_design","label":"Create a plate design","description":"Starts a plate layout. `p_format` is `96_well` by default (`6_well` to `1536_well`), with `p_rows` and `p_cols` to match. Returns the design. Sends `plate_design.created`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false,"server":"workspace"},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_format","type":"text","required":false,"nullable":false},{"name":"p_rows","type":"integer","required":false,"nullable":false},{"name":"p_cols","type":"integer","required":false,"nullable":false},{"name":"p_validation","type":"jsonb","required":false,"nullable":false}]},{"operation":"save_plate_design","rpc":"save_plate_design","label":"Save a plate design’s wells","description":"Replaces the wells of a design. `p_wells` is a JSON array of `{ wellCode, role, sampleId, sampleLabel, concentration, concentrationUnit, volumeUl }`. Returns the design. Sends `plate_design.updated`.","arguments":[{"name":"p_design_id","type":"uuid","required":true,"nullable":false},{"name":"p_wells","type":"jsonb","required":true,"nullable":false},{"name":"p_validation","type":"jsonb","required":false,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":false,"nullable":false}]},{"operation":"archive_plate_design","rpc":"archive_plate_design","label":"Archive a plate design","description":"Archives a design so it no longer shows in lists. Returns the design. Sends `plate_design.updated`.","arguments":[{"name":"p_design_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false}]},{"operation":"save_analysis_view","rpc":"save_analysis_view","label":"Save an analysis view","description":"Creates a view (leave `p_id` out) or saves a new version of one you own. `p_charts` is a JSON list of one to eight chart specifications and `p_source_revisions` the data versions it was made from, so the view can be reproduced. Returns the view. Sends `analysis_view.created` or `analysis_view.updated`.","arguments":[{"name":"p_id","type":"uuid","required":false,"nullable":true},{"name":"p_name","type":"text","required":true,"nullable":false},{"name":"p_charts","type":"jsonb","required":true,"nullable":false},{"name":"p_source_revisions","type":"jsonb","required":true,"nullable":false},{"name":"p_export_settings","type":"jsonb","required":false,"nullable":true}]},{"operation":"delete_analysis_view","rpc":"delete_analysis_view","label":"Delete an analysis view","description":"Deletes a view you own. A view a notebook cites cannot be deleted. Sends `analysis_view.deleted`.","arguments":[{"name":"p_id","type":"uuid","required":true,"nullable":false}]},{"operation":"delete_analysis_definition","rpc":"delete_analysis_definition","label":"Delete an analysis definition","description":"Deletes a definition you own.","arguments":[{"name":"p_id","type":"uuid","required":true,"nullable":false}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
