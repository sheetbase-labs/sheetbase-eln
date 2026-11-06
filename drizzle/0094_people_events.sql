-- Webhook events for people and continuity, and passkey events.
--
-- Handing work over, setting or cancelling an out of office, mapping a sign-in
-- group, and a role changing from groups already land on the change feed
-- (migrations 0090 to 0092). This makes them subscribable as webhook events,
-- and adds passkeys: when someone adds or removes a passkey, every workspace
-- they belong to hears about it. The event carries the passkey's name only,
-- never the key.

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK ((entity_type = ANY (ARRAY['project'::text, 'analysis_view'::text, 'folder'::text, 'record'::text, 'block'::text, 'record_link'::text, 'scientific_table'::text, 'scientific_row'::text, 'formula'::text, 'calculation'::text, 'record_field_definition'::text, 'model_field_option'::text, 'file'::text, 'dataset_schema'::text, 'dataset_schema_field'::text, 'dataset_schema_relationship'::text, 'dataset'::text, 'dataset_version'::text, 'sample_event'::text, 'comment'::text, 'review_submission'::text, 'record_model_version'::text, 'protocol_version'::text, 'protocol_deviation'::text, 'signature'::text, 'review_decision'::text, 'storage_site'::text, 'storage_room'::text, 'storage_unit'::text, 'storage_shelf'::text, 'storage_rack'::text, 'storage_box'::text, 'storage_position'::text, 'storage_movement'::text, 'plate_design'::text, 'plate_well'::text, 'plate_layout_template'::text, 'calendar_resource'::text, 'calendar_booking'::text, 'calendar_booking_participant'::text, 'calendar_booking_sample'::text, 'study_workstream'::text, 'study_task'::text, 'study_task_dependency'::text, 'study_task_assignment'::text, 'study_task_resource'::text, 'study_deliverable'::text, 'study_project'::text, 'study_experiment'::text, 'study_plan_snapshot'::text, 'instrument'::text, 'instrument_run'::text, 'instrument_run_stage'::text, 'instrument_observation'::text, 'instrument_plate_snapshot'::text, 'instrument_qc_check'::text, 'instrument_raw_file'::text, 'instrument_run_link'::text, 'report_definition'::text, 'report_section'::text, 'report_generation'::text, 'sheet_instance'::text, 'sheet_definition'::text, 'sheet_definition_version'::text, 'notebook_template'::text, 'notebook_template_version'::text, 'workspace_invitation'::text, 'workspace_settings'::text, 'project_access'::text, 'workspace_group'::text, 'workspace_group_membership'::text, 'project_access_request'::text, 'api_credential'::text, 'connector'::text, 'connector_run'::text, 'pipeline_definition'::text, 'pipeline_definition_version'::text, 'pipeline_run'::text, 'pipeline_schedule'::text, 'webhook_subscription'::text, 'webhook_delivery'::text, 'agent_operation_policy'::text, 'agent_operation_proposal'::text, 'extension'::text, 'dataset_import_file'::text, 'dataset_import'::text, 'parser'::text, 'parser_version'::text, 'system'::text, 'material'::text, 'approval_request'::text, 'member_handover'::text, 'member_absence'::text, 'idp_group_mapping'::text, 'member_passkey'::text])));
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('member.work_handed_over'), ('member.absence_set'), ('member.absence_cancelled'),
  ('workspace.group_role.mapped'), ('workspace.group_role.removed'), ('workspace.group_role.adopted'),
  ('member.role_changed_by_groups'), ('member.passkey_added'), ('member.passkey_removed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

CREATE FUNCTION internal.record_passkey_event(p_user_id text, p_action text, p_passkey_id text, p_name text)
    RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r record;
  v_count integer := 0;
BEGIN
  IF p_action NOT IN ('added', 'removed') THEN
    RAISE EXCEPTION 'unknown passkey action' USING ERRCODE = '22023';
  END IF;
  FOR r IN SELECT workspace_id FROM api.workspace_memberships WHERE user_id = p_user_id LOOP
    PERFORM internal.emit_change_event_as_actor(
      p_user_id, r.workspace_id, 'member_passkey', gen_random_uuid(),
      CASE p_action WHEN 'added' THEN 'create' ELSE 'delete' END, NULL, NULL,
      jsonb_build_object('action', 'passkey-' || p_action, 'userId', p_user_id,
                         'passkeyId', p_passkey_id, 'name', p_name));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_passkey_event(text, text, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_passkey_event(text, text, text, text) FROM PUBLIC;
