-- Every write is a permission.
--
-- The functions that only asked "can this person write" now ask for a named
-- permission (work.comments, work.samples, work.datasets and so on). Each
-- role's choice is stored with the settings access choices and edited on the
-- Roles page. Until a workspace changes it, everyone who could write before
-- still can, so nothing is locked out; the workspace admin always can.

ALTER TABLE api.settings_access DROP CONSTRAINT chk_settings_access_area;
--> statement-breakpoint
ALTER TABLE api.settings_access ADD CONSTRAINT chk_settings_access_area CHECK (area IN (
      'general', 'ai', 'members', 'signatures', 'clients', 'instruments',
      'integrations', 'storage', 'access', 'audit', 'diagnostics', 'usage',
      'work_comments', 'work_records', 'work_experiments', 'work_sheets', 'work_samples', 'work_datasets', 'work_planning', 'work_protocols', 'work_reports', 'work_approvals', 'work_client_sharing', 'work_runs', 'work_parsers'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text;
  v_mask text;
  v_level text;
BEGIN
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    IF p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage')
       OR p_capability LIKE 'work.%' THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM api.agent_operation_proposals proposal
      WHERE proposal.workspace_id = p_workspace_id
        AND proposal.status = 'executing'
        AND proposal.executed_by_credential_id = api.current_credential_id()
        AND (
          (proposal.operation_kind LIKE 'pipeline_definition.%'
           AND p_capability = 'pipelines.manage'
           AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
          OR (proposal.operation_kind IN (
            'dataset_schema.create',
            'sheet_definition.create',
            'sheet_definition.update_draft'
          ) AND p_capability = 'schema.edit'
          AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
        )
    );
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' AND v_mask IS NOT NULL THEN
    IF p_capability LIKE 'work.%' THEN p_capability := 'record.create'; END IF;
    RETURN p_capability = ANY (
      string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
    );
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN api.has_settings_access(p_workspace_id, 'integrations', 'manage');
    WHEN p_capability ~ '^settings\.[a-z_]+\.(view|manage)$' THEN
      RETURN api.has_settings_access(
        p_workspace_id, split_part(p_capability, '.', 2), split_part(p_capability, '.', 3));
    -- Instrument administration follows the Instruments settings area, so the
    -- Roles page decides who registers, retires and sets up instruments.
    WHEN p_capability = 'instrument.manage' THEN
      RETURN api.has_settings_access(p_workspace_id, 'instruments', 'manage');
    -- Calibrations are recorded by the people who run the instruments, plus
    -- anyone who manages instruments.
    WHEN p_capability = 'calibration.record' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'member')
        OR api.has_settings_access(p_workspace_id, 'instruments', 'manage');
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- LAB-02 step 2: release is the authorised-person QC gate; quarantine and
    -- disposal are scientific actions. api_client stays fail-closed (the
    -- sample RPCs are not in the external allowlist).
    WHEN p_capability = 'sample.release' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'reviewer');
    WHEN p_capability IN ('sample.quarantine', 'sample.dispose') THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist');
    -- Day-to-day work (comments, samples, datasets and so on). Everyone who
    -- could write before still can until the workspace changes a role's choice
    -- on the Roles page; the workspace admin always can.
    WHEN p_capability ~ '^work\.[a-z_]+$' THEN
      IF v_role = 'owner' THEN RETURN true; END IF;
      SELECT s.level INTO v_level FROM api.settings_access s
       WHERE s.workspace_id = p_workspace_id
         AND s.area = 'work_' || substr(p_capability, 6) AND s.role = v_role;
      IF v_level IS NOT NULL THEN RETURN v_level = 'manage'; END IF;
      RETURN v_role IN ('admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION internal.require_capability_in(p_function text, p_capability text)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  r record;
  v_def text;
  v_new text;
  v_guard text;
  v_count integer := 0;
  v_acl aclitem[];
  a record;
  v_sig text;
BEGIN
  v_guard := format(
    ' IF api.has_capability(api.current_workspace_id(), %L) IS NOT TRUE THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; -- capability-guard',
    p_capability, 'not permitted: needs ' || p_capability, '42501');
  FOR r IN
    SELECT p.oid FROM pg_proc p
    WHERE p.pronamespace = 'api'::regnamespace AND p.proname = p_function AND p.prokind = 'f'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF v_def LIKE '%-- capability-guard%' OR v_def LIKE '%' || p_capability || '%' THEN CONTINUE; END IF;
    v_new := regexp_replace(v_def, E'(\\n\\s*BEGIN)\\s', '\1' || replace(v_guard, '\', '\\') || E'\n');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'no BEGIN found in api.%', p_function;
    END IF;
    -- These functions had execute taken back from their owner, which also
    -- stops the owner replacing them; lend it for the replace, then put the
    -- original grants back exactly.
    SELECT p.proacl, p.oid::regprocedure::text INTO v_acl, v_sig FROM pg_proc p WHERE p.oid = r.oid;
    EXECUTE format('GRANT ALL ON FUNCTION %s TO migrator', v_sig);
    EXECUTE v_new;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, migrator, authenticated, service_role', v_sig);
    IF v_acl IS NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC', v_sig);
    END IF;
    FOR a IN SELECT x.grantee FROM aclexplode(v_acl) x LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', v_sig,
        CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END);
    END LOOP;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;
--> statement-breakpoint
DO $$
DECLARE
  m record;
BEGIN
  FOR m IN SELECT * FROM (VALUES
    ('create_comment', 'work.comments'),
    ('create_sheet_comment', 'work.comments'),
    ('create_record_comment', 'work.comments'),
    ('reply_to_comment', 'work.comments'),
    ('resolve_comment_thread', 'work.comments'),
    ('reopen_comment_thread', 'work.comments'),
    ('create_record', 'work.records'),
    ('create_model_record', 'work.records'),
    ('set_model_type', 'work.records'),
    ('add_record_alias', 'work.records'),
    ('remove_record_alias', 'work.records'),
    ('move_record_to_project', 'work.records'),
    ('move_to_folder', 'work.records'),
    ('register_file_version', 'work.records'),
    ('finalize_file_upload', 'work.records'),
    ('record_file_text', 'work.records'),
    ('save_team_layout', 'work.records'),
    ('delete_team_layout', 'work.records'),
    ('create_amendment', 'work.experiments'),
    ('delete_experiment_draft', 'work.experiments'),
    ('set_experiment_decision', 'work.experiments'),
    ('set_experiment_fields', 'work.experiments'),
    ('set_experiment_status', 'work.experiments'),
    ('start_experiment', 'work.experiments'),
    ('request_repeat', 'work.experiments'),
    ('submit_record_revision', 'work.experiments'),
    ('request_signature_witness', 'work.experiments'),
    ('instantiate_notebook_template_version', 'work.experiments'),
    ('instantiate_template', 'work.experiments'),
    ('bind_chart_revision', 'work.experiments'),
    ('freeze_chart', 'work.experiments'),
    ('unfreeze_chart', 'work.experiments'),
    ('freeze_analysis_block', 'work.experiments'),
    ('unfreeze_analysis_block', 'work.experiments'),
    ('record_protocol_deviation_reason', 'work.experiments'),
    ('save_trail_evidence', 'work.experiments'),
    ('resolve_analysis_view_sources', 'work.experiments'),
    ('analysis_evidence_source', 'work.experiments'),
    ('archive_sheet_instance', 'work.sheets'),
    ('restore_sheet_instance', 'work.sheets'),
    ('create_sheet_instance_core0311', 'work.sheets'),
    ('create_sheet_instance_from_definition', 'work.sheets'),
    ('duplicate_sheet_instance', 'work.sheets'),
    ('materialize_sheet_instance', 'work.sheets'),
    ('mutate_sheet_instance_calculations', 'work.sheets'),
    ('mutate_sheet_instance_local_state', 'work.sheets'),
    ('rename_sheet_instance', 'work.sheets'),
    ('resolve_sheet_instance_row_identity', 'work.sheets'),
    ('update_sheet_instance', 'work.sheets'),
    ('create_and_link_sheet_record', 'work.sheets'),
    ('commit_sheet_record_batch', 'work.sheets'),
    ('cancel_sample_reservation', 'work.samples'),
    ('create_sample_reservation', 'work.samples'),
    ('move_sample_to_position', 'work.samples'),
    ('remove_sample_from_position', 'work.samples'),
    ('record_sample_label_print', 'work.samples'),
    ('record_sample_measurement', 'work.samples'),
    ('record_reagent_movement', 'work.samples'),
    ('register_replacement_lot', 'work.samples'),
    ('withdraw_sample', 'work.samples'),
    ('archive_dataset', 'work.datasets'),
    ('restore_dataset', 'work.datasets'),
    ('flag_dataset_value', 'work.datasets'),
    ('clear_dataset_value_flag', 'work.datasets'),
    ('commit_dataset_import', 'work.datasets'),
    ('commit_dataset_row_batch', 'work.datasets'),
    ('commit_dataset_row_batch_atomic', 'work.datasets'),
    ('create_dataset_import_file', 'work.datasets'),
    ('keep_dataset_version', 'work.datasets'),
    ('plan_dataset_row', 'work.datasets'),
    ('recompute_dataset_system_flags', 'work.datasets'),
    ('record_dataset_import_file_parse', 'work.datasets'),
    ('record_intake_failure', 'work.datasets'),
    ('resolve_intake_failure', 'work.datasets'),
    ('resolve_intake_failures_for_file', 'work.datasets'),
    ('set_dataset_column_unit', 'work.datasets'),
    ('snapshot_dataset', 'work.datasets'),
    ('create_plate_design', 'work.datasets'),
    ('save_plate_layout_template', 'work.datasets'),
    ('assign_planner_item_to_study', 'work.planning'),
    ('create_plan_from_project', 'work.planning'),
    ('create_project', 'work.planning'),
    ('create_study', 'work.planning'),
    ('edit_study', 'work.planning'),
    ('create_study_deliverable', 'work.planning'),
    ('update_study_deliverable', 'work.planning'),
    ('reorder_study_deliverables', 'work.planning'),
    ('move_study_task_due', 'work.planning'),
    ('snapshot_study_plan', 'work.planning'),
    ('update_project_details', 'work.planning'),
    ('request_project_edit_access', 'work.planning'),
    ('set_study_task_client_visible', 'work.planning'),
    ('acknowledge_protocol_version', 'work.protocols'),
    ('pin_protocol_reference', 'work.protocols'),
    ('create_protocol_version', 'work.protocols'),
    ('set_protocol_version_status', 'work.protocols'),
    ('assign_protocol_training', 'work.protocols'),
    ('unassign_protocol_training', 'work.protocols'),
    ('record_protocol_trained', 'work.protocols'),
    ('create_report_definition', 'work.reports'),
    ('update_report_definition', 'work.reports'),
    ('submit_approval_request', 'work.approvals'),
    ('approve_approval_request', 'work.approvals'),
    ('return_approval_request', 'work.approvals'),
    ('withdraw_approval_request', 'work.approvals'),
    ('share_record_with_client', 'work.client_sharing'),
    ('unshare_record_with_client', 'work.client_sharing'),
    ('record_client_sharing', 'work.client_sharing'),
    ('append_connector_run_log', 'work.runs'),
    ('append_pipeline_run_log', 'work.runs'),
    ('cancel_pipeline_run', 'work.runs'),
    ('complete_connector_run', 'work.runs'),
    ('complete_pipeline_run', 'work.runs'),
    ('fail_connector_run', 'work.runs'),
    ('fail_pipeline_run', 'work.runs'),
    ('start_connector_run', 'work.runs'),
    ('start_pipeline_run', 'work.runs'),
    ('establish_connector_run_request', 'work.runs'),
    ('record_pipeline_run_output', 'work.runs'),
    ('ensure_builtin_parsers', 'work.parsers'),
    ('ensure_parser', 'work.parsers'),
    ('request_parser_update', 'work.parsers'),
    ('save_parser_mapping', 'work.parsers'),
    ('request_instrument_qualification', 'work.parsers')
  ) AS t(fn, cap)
  LOOP
    PERFORM internal.require_capability_in(m.fn, m.cap);
  END LOOP;
END
$$;
--> statement-breakpoint
DROP FUNCTION internal.require_capability_in(text, text);
