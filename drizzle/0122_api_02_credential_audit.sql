-- API-02 completion: credential lifecycle joins the workspace activity
-- stream. api_credentials is an internal table with no PostgREST exposure
-- and no trigger surface; the application writes create / rotate / revoke
-- events through the trusted emitter internal.emit_change_event_as_actor,
-- which allocates the per-workspace sequence and NOTIFYs sheetbase_change.
--
-- The actor on each event is the owner who performed the mutation (the
-- emitter validates the user exists); entity_type 'api_credential' carries
-- the credential id in entity_uuid. Rotation emits create(new) + revoke(old)
-- so the pair is reconstructable from the stream alone. Payloads carry only
-- display metadata (name, prefix, kind, rotation linkage) — never secrets.

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','model_field_option','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','study_project','study_experiment','study_plan_snapshot','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation','workspace_invitation','workspace_settings','project_access','api_credential'));
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
