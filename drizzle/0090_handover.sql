-- Hand over a leaver's work.
--
-- Suspending or removing someone leaves their open work behind with their name
-- on it. These two functions let a lead (or the person themselves, before they
-- go) see what is still theirs and give it to a colleague in one step:
--
--   api.preview_member_handover(workspace, user)
--       what the person still holds, counted by kind of work;
--   api.hand_over_member_work(workspace, from, to, selection)
--       moves the chosen kinds of work to the recipient and reports what moved
--       and what had to stay (for example, work in a project the recipient
--       cannot open).
--
-- Only open work moves: signed (locked), archived and deleted records stay as
-- they were, completed and cancelled tasks stay as they were. A review never
-- moves to the person who wrote it, as the author cannot review their own work.

-- Audit entries for the new kinds of change below.
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK ((entity_type = ANY (ARRAY['project'::text, 'analysis_view'::text, 'folder'::text, 'record'::text, 'block'::text, 'record_link'::text, 'scientific_table'::text, 'scientific_row'::text, 'formula'::text, 'calculation'::text, 'record_field_definition'::text, 'model_field_option'::text, 'file'::text, 'dataset_schema'::text, 'dataset_schema_field'::text, 'dataset_schema_relationship'::text, 'dataset'::text, 'dataset_version'::text, 'sample_event'::text, 'comment'::text, 'review_submission'::text, 'record_model_version'::text, 'protocol_version'::text, 'protocol_deviation'::text, 'signature'::text, 'review_decision'::text, 'storage_site'::text, 'storage_room'::text, 'storage_unit'::text, 'storage_shelf'::text, 'storage_rack'::text, 'storage_box'::text, 'storage_position'::text, 'storage_movement'::text, 'plate_design'::text, 'plate_well'::text, 'plate_layout_template'::text, 'calendar_resource'::text, 'calendar_booking'::text, 'calendar_booking_participant'::text, 'calendar_booking_sample'::text, 'study_workstream'::text, 'study_task'::text, 'study_task_dependency'::text, 'study_task_assignment'::text, 'study_task_resource'::text, 'study_deliverable'::text, 'study_project'::text, 'study_experiment'::text, 'study_plan_snapshot'::text, 'instrument'::text, 'instrument_run'::text, 'instrument_run_stage'::text, 'instrument_observation'::text, 'instrument_plate_snapshot'::text, 'instrument_qc_check'::text, 'instrument_raw_file'::text, 'instrument_run_link'::text, 'report_definition'::text, 'report_section'::text, 'report_generation'::text, 'sheet_instance'::text, 'sheet_definition'::text, 'sheet_definition_version'::text, 'notebook_template'::text, 'notebook_template_version'::text, 'workspace_invitation'::text, 'workspace_settings'::text, 'project_access'::text, 'workspace_group'::text, 'workspace_group_membership'::text, 'project_access_request'::text, 'api_credential'::text, 'connector'::text, 'connector_run'::text, 'pipeline_definition'::text, 'pipeline_definition_version'::text, 'pipeline_run'::text, 'pipeline_schedule'::text, 'webhook_subscription'::text, 'webhook_delivery'::text, 'agent_operation_policy'::text, 'agent_operation_proposal'::text, 'extension'::text, 'dataset_import_file'::text, 'dataset_import'::text, 'parser'::text, 'parser_version'::text, 'system'::text, 'material'::text, 'approval_request'::text, 'member_handover'::text, 'member_absence'::text, 'idp_group_mapping'::text])));
--> statement-breakpoint

CREATE FUNCTION internal.member_handover_items(p_workspace_id uuid, p_user_id text)
    RETURNS TABLE(category text, record_kind text, n integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT 'record'::text, r.kind, count(*)::integer
    FROM api.records r
   WHERE r.workspace_id = p_workspace_id
     AND r.assignee_user_id = p_user_id
     AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL
   GROUP BY r.kind
  UNION ALL
  SELECT 'record_reviewer'::text, NULL::text, count(*)::integer
    FROM api.records r
   WHERE r.workspace_id = p_workspace_id
     AND r.reviewer_user_id = p_user_id
     AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL
  HAVING count(*) > 0
  UNION ALL
  SELECT 'task'::text, NULL::text, count(DISTINCT a.id)::integer
    FROM api.study_task_assignments a
    JOIN api.study_tasks t ON t.id = a.task_id
   WHERE a.workspace_id = p_workspace_id
     AND a.user_id = p_user_id
     AND t.status NOT IN ('completed', 'cancelled')
  HAVING count(DISTINCT a.id) > 0
  UNION ALL
  SELECT 'review'::text, NULL::text, count(*)::integer
    FROM api.review_submissions s
   WHERE s.workspace_id = p_workspace_id
     AND s.state IN ('submitted', 'approved')
     AND p_user_id = ANY (s.assigned_reviewer_user_ids)
  HAVING count(*) > 0
  UNION ALL
  SELECT 'instrument'::text, NULL::text, count(*)::integer
    FROM api.instruments i
   WHERE i.workspace_id = p_workspace_id
     AND i.owner_id = p_user_id
     AND i.retired_at IS NULL
  HAVING count(*) > 0
  UNION ALL
  SELECT 'project_reviewer'::text, NULL::text, count(*)::integer
    FROM api.projects p
   WHERE p.workspace_id = p_workspace_id
     AND p.default_reviewer_user_id = p_user_id
     AND p.archived_at IS NULL
  HAVING count(*) > 0;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.member_handover_items(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.member_handover_items(uuid, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.preview_member_handover(p_workspace_id uuid, p_user_id text)
    RETURNS TABLE(category text, record_kind text, n integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR api.current_user_id() IS NULL
     OR NOT (api.has_settings_access(p_workspace_id, 'members', 'manage')
             OR p_user_id = api.current_user_id()) THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  RETURN QUERY SELECT * FROM internal.member_handover_items(p_workspace_id, p_user_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.preview_member_handover(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.preview_member_handover(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.preview_member_handover(uuid, text) TO authenticated;
--> statement-breakpoint

-- p_selection names what to move: 'record:<kind>' for each kind of record,
-- 'record_reviewer', 'task', 'review', 'instrument' and 'project_reviewer'.
-- The result is {"moved": {<name>: n}, "kept": {<name>: n}}.
CREATE FUNCTION api.hand_over_member_work(
    p_workspace_id uuid, p_from_user_id text, p_to_user_id text, p_selection text[]
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_to api.workspace_memberships;
  v_moved jsonb := '{}'::jsonb;
  v_kept jsonb := '{}'::jsonb;
  v_sel text;
  v_total integer;
  v_done integer;
  v_kind text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR v_actor IS NULL
     OR NOT (api.has_settings_access(p_workspace_id, 'members', 'manage')
             OR p_from_user_id = v_actor) THEN
    RAISE EXCEPTION 'members access required' USING ERRCODE = 'SB052';
  END IF;
  IF p_to_user_id IS NULL OR p_to_user_id = p_from_user_id THEN
    RAISE EXCEPTION 'choose someone else to hand the work to' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_to FROM api.workspace_memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_to_user_id;
  IF v_to.id IS NULL OR v_to.suspended_at IS NOT NULL
     OR v_to.role IN ('viewer', 'client_viewer') THEN
    RAISE EXCEPTION 'the recipient must be an active member who can do work' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships
                  WHERE workspace_id = p_workspace_id AND user_id = p_from_user_id) THEN
    RAISE EXCEPTION 'member not found' USING ERRCODE = 'SB052';
  END IF;

  FOREACH v_sel IN ARRAY coalesce(p_selection, '{}'::text[]) LOOP
    v_done := 0;
    IF v_sel LIKE 'record:%' THEN
      v_kind := substr(v_sel, 8);
      SELECT count(*) INTO v_total FROM api.records r
       WHERE r.workspace_id = p_workspace_id AND r.assignee_user_id = p_from_user_id
         AND r.kind = v_kind
         AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL;
      WITH moved AS (
        UPDATE api.records r
           SET assignee_user_id = p_to_user_id,
               metadata_version = r.metadata_version + 1,
               updated_at = now(), updated_by_user_id = v_actor
         WHERE r.workspace_id = p_workspace_id AND r.assignee_user_id = p_from_user_id
           AND r.kind = v_kind
           AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL
           AND (r.project_id IS NULL OR EXISTS (
                 SELECT 1 FROM internal.project_permissions_for(r.project_id, p_to_user_id) pp
                  WHERE pp.can_view))
        RETURNING 1)
      SELECT count(*) INTO v_done FROM moved;
    ELSIF v_sel = 'record_reviewer' THEN
      SELECT count(*) INTO v_total FROM api.records r
       WHERE r.workspace_id = p_workspace_id AND r.reviewer_user_id = p_from_user_id
         AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL;
      WITH moved AS (
        UPDATE api.records r
           SET reviewer_user_id = p_to_user_id,
               metadata_version = r.metadata_version + 1,
               updated_at = now(), updated_by_user_id = v_actor
         WHERE r.workspace_id = p_workspace_id AND r.reviewer_user_id = p_from_user_id
           AND r.deleted_at IS NULL AND r.archived_at IS NULL AND r.locked_at IS NULL
           AND r.created_by_user_id <> p_to_user_id
           AND (r.project_id IS NULL OR EXISTS (
                 SELECT 1 FROM internal.project_permissions_for(r.project_id, p_to_user_id) pp
                  WHERE pp.can_review))
        RETURNING 1)
      SELECT count(*) INTO v_done FROM moved;
    ELSIF v_sel = 'task' THEN
      SELECT count(*) INTO v_total
        FROM api.study_task_assignments a JOIN api.study_tasks t ON t.id = a.task_id
       WHERE a.workspace_id = p_workspace_id AND a.user_id = p_from_user_id
         AND t.status NOT IN ('completed', 'cancelled');
      -- Someone already on the task simply drops the leaver; otherwise the
      -- leaver's line passes to the recipient with the same role and effort.
      WITH leaver AS (
        SELECT a.id, a.task_id, a.role,
               EXISTS (SELECT 1 FROM api.study_task_assignments b
                        WHERE b.task_id = a.task_id AND b.user_id = p_to_user_id) AS already
          FROM api.study_task_assignments a JOIN api.study_tasks t ON t.id = a.task_id
         WHERE a.workspace_id = p_workspace_id AND a.user_id = p_from_user_id
           AND t.status NOT IN ('completed', 'cancelled')
           AND (t.project_id IS NULL OR EXISTS (
                 SELECT 1 FROM internal.project_permissions_for(t.project_id, p_to_user_id) pp
                  WHERE pp.can_view))),
      gone AS (
        DELETE FROM api.study_task_assignments a USING leaver l
         WHERE a.id = l.id AND l.already RETURNING 1),
      moved AS (
        UPDATE api.study_task_assignments a
           SET user_id = p_to_user_id, display_name = NULL
          FROM leaver l WHERE a.id = l.id AND NOT l.already RETURNING 1)
      SELECT (SELECT count(*) FROM gone) + (SELECT count(*) FROM moved) INTO v_done;
    ELSIF v_sel = 'review' THEN
      SELECT count(*) INTO v_total FROM api.review_submissions s
       WHERE s.workspace_id = p_workspace_id AND s.state IN ('submitted', 'approved')
         AND p_from_user_id = ANY (s.assigned_reviewer_user_ids);
      WITH moved AS (
        UPDATE api.review_submissions s
           SET assigned_reviewer_user_ids = CASE
                 WHEN p_to_user_id = ANY (s.assigned_reviewer_user_ids)
                   THEN array_remove(s.assigned_reviewer_user_ids, p_from_user_id)
                 ELSE array_replace(s.assigned_reviewer_user_ids, p_from_user_id, p_to_user_id)
               END,
               updated_at = now()
         WHERE s.workspace_id = p_workspace_id AND s.state IN ('submitted', 'approved')
           AND p_from_user_id = ANY (s.assigned_reviewer_user_ids)
           AND s.submitted_by_user_id <> p_to_user_id
           AND EXISTS (
             SELECT 1 FROM api.records r
              WHERE r.id = s.record_id
                AND (r.project_id IS NULL OR EXISTS (
                      SELECT 1 FROM internal.project_permissions_for(r.project_id, p_to_user_id) pp
                       WHERE pp.can_review)))
        RETURNING 1)
      SELECT count(*) INTO v_done FROM moved;
    ELSIF v_sel = 'instrument' THEN
      SELECT count(*) INTO v_total FROM api.instruments i
       WHERE i.workspace_id = p_workspace_id AND i.owner_id = p_from_user_id AND i.retired_at IS NULL;
      WITH moved AS (
        UPDATE api.instruments i
           SET owner_id = p_to_user_id, updated_at = now(), updated_by_user_id = v_actor
         WHERE i.workspace_id = p_workspace_id AND i.owner_id = p_from_user_id AND i.retired_at IS NULL
        RETURNING 1)
      SELECT count(*) INTO v_done FROM moved;
    ELSIF v_sel = 'project_reviewer' THEN
      SELECT count(*) INTO v_total FROM api.projects p
       WHERE p.workspace_id = p_workspace_id AND p.default_reviewer_user_id = p_from_user_id
         AND p.archived_at IS NULL;
      WITH moved AS (
        UPDATE api.projects p
           SET default_reviewer_user_id = p_to_user_id, updated_at = now()
         WHERE p.workspace_id = p_workspace_id AND p.default_reviewer_user_id = p_from_user_id
           AND p.archived_at IS NULL
           AND EXISTS (SELECT 1 FROM internal.project_permissions_for(p.id, p_to_user_id) pp
                        WHERE pp.can_review)
        RETURNING 1)
      SELECT count(*) INTO v_done FROM moved;
    ELSE
      RAISE EXCEPTION 'unknown kind of work: %', v_sel USING ERRCODE = '22023';
    END IF;

    IF v_done > 0 THEN
      v_moved := v_moved || jsonb_build_object(v_sel, v_done);
    END IF;
    IF v_total - v_done > 0 THEN
      v_kept := v_kept || jsonb_build_object(v_sel, v_total - v_done);
    END IF;
  END LOOP;

  PERFORM internal.emit_change_event(
    p_workspace_id, 'member_handover', v_to.id, 'update', NULL, NULL,
    jsonb_build_object('action', 'work-handed-over',
                       'fromUserId', p_from_user_id, 'toUserId', p_to_user_id,
                       'moved', v_moved, 'kept', v_kept));
  RETURN jsonb_build_object('moved', v_moved, 'kept', v_kept);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.hand_over_member_work(uuid, text, text, text[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.hand_over_member_work(uuid, text, text, text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.hand_over_member_work(uuid, text, text, text[]) TO authenticated;
