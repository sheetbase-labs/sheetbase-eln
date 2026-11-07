-- Campaigns and saved plans are removed. An AI-made plan is no longer an object of
-- its own: the planner's button creates a normal experiment, in one step, with
-- everything the plan describes. The experiments, plates and worklists that
-- campaigns and plans already made stay; they were always ordinary records.
--
--   * drops api.experiment_plans, api.campaigns, api.campaign_rounds, the campaign
--     list tick-box tables and the model features table, with their functions;
--   * adds api.create_planned_experiment(project, plan), which is what applying a
--     plan used to do, without a saved plan;
--   * takes the "propose next campaign round" action out of the pipeline catalogue.

-- A pipeline can no longer ask for a campaign round.
DO $$
DECLARE
  v_def text;
  v_gone text := $gone$,{"operation":"request_campaign_round","rpc":"request_campaign_round","label":"Propose next campaign round","description":"Ask the optimiser for the next batch of conditions. A person approves the round before anything is made.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]}$gone$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(v_gone IN v_def) > 0 THEN
    v_def := replace(v_def, v_gone, '');
    EXECUTE v_def;
  END IF;
END $$;
--> statement-breakpoint

-- Functions first (several take the row type of a table about to go).
DROP FUNCTION internal.emit_plan_event(api.experiment_plans, text);
--> statement-breakpoint
DROP FUNCTION api.create_experiment_plan(uuid, text, jsonb, text);
--> statement-breakpoint
DROP FUNCTION api.dismiss_experiment_plan(uuid);
--> statement-breakpoint
DROP FUNCTION api.apply_experiment_plan(uuid);
--> statement-breakpoint
DROP FUNCTION internal.emit_campaign_event(api.campaigns, text);
--> statement-breakpoint
DROP FUNCTION internal.emit_campaign_round_event(api.campaign_rounds, text);
--> statement-breakpoint
DROP FUNCTION internal.check_campaign_design(jsonb, jsonb);
--> statement-breakpoint
DROP FUNCTION api.configure_campaign(uuid, jsonb, jsonb, integer, integer, integer, text, jsonb, uuid, boolean, integer);
--> statement-breakpoint
DROP FUNCTION internal.campaign_next_batch(api.campaigns);
--> statement-breakpoint
DROP FUNCTION internal.queue_campaign_round(api.campaigns);
--> statement-breakpoint
DROP FUNCTION internal.campaign_for_edit(uuid);
--> statement-breakpoint
DROP FUNCTION api.start_campaign(uuid);
--> statement-breakpoint
DROP FUNCTION api.set_campaign_status(uuid, text);
--> statement-breakpoint
DROP FUNCTION api.request_campaign_round(uuid);
--> statement-breakpoint
DROP FUNCTION internal.claim_campaign_round();
--> statement-breakpoint
DROP FUNCTION internal.fill_campaign_round(uuid, text, text, text, jsonb, jsonb, jsonb, text);
--> statement-breakpoint
DROP FUNCTION api.reject_campaign_round(uuid, text);
--> statement-breakpoint
DROP FUNCTION api.approve_campaign_round(uuid);
--> statement-breakpoint
DROP FUNCTION internal.merge_campaign_results(api.campaign_rounds, jsonb);
--> statement-breakpoint
DROP FUNCTION api.record_campaign_results(uuid, jsonb);
--> statement-breakpoint
DROP FUNCTION api.pull_campaign_round_results(uuid, text);
--> statement-breakpoint
DROP FUNCTION api.set_model_capability(text, text, boolean, jsonb);
--> statement-breakpoint

DROP TABLE api.campaign_rounds;
--> statement-breakpoint
DROP TABLE api.campaigns;
--> statement-breakpoint
DROP TABLE api.experiment_plans;
--> statement-breakpoint
DROP TABLE api.model_capabilities;
--> statement-breakpoint

DELETE FROM internal.webhook_event_names
 WHERE name IN ('plan.proposed', 'plan.applied', 'plan.dismissed',
                'campaign.started', 'campaign.finished',
                'campaign.round.proposed', 'campaign.round.approved',
                'campaign.round.rejected', 'campaign.round.completed',
                'model.feature.enabled', 'model.feature.disabled');
--> statement-breakpoint

-- Create an experiment from a plan: the experiment (from its protocol when the plan
-- names one), the parts with their hands-on time, waits and instruments, the plate
-- run, the worklist, the sample reservations and, when asked, a request for a
-- schedule. Everything is done as the person calling, through the same functions
-- the pages call, so every permission and rule still applies; if any step is
-- refused nothing is created and the reason comes back.
ALTER FUNCTION internal.check_experiment_plan(jsonb) RENAME TO check_planned_experiment;
--> statement-breakpoint

CREATE FUNCTION api.create_planned_experiment(p_project_id uuid, p_plan jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_plan jsonb := p_plan;
  v_title text;
  v_record api.records;
  v_made jsonb;
  v_part jsonb;
  v_part_row jsonb;
  v_prev_part uuid;
  v_run api.plate_runs;
  v_wl api.plate_worklists;
  v_proposal api.schedule_proposals;
  v_sample jsonb;
  v_reservations integer := 0;
  v_template uuid;
  v_wells jsonb;
  v_format text;
  v_result jsonb;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('project', p_project_id, 'edit');
  IF internal.project_is_archived(p_project_id) THEN
    RAISE EXCEPTION 'project is archived' USING ERRCODE = 'SB004';
  END IF;
  PERFORM internal.check_planned_experiment(v_plan);
  v_title := btrim(v_plan #>> '{experiment,title}');
  v_template := NULLIF(v_plan #>> '{experiment,templateRecordId}', '')::uuid;

  IF v_template IS NOT NULL THEN
    v_made := api.instantiate_template(v_template, p_project_id, 'experiment', v_title);
    SELECT * INTO v_record FROM api.records WHERE id = (v_made #>> '{record,id}')::uuid;
  ELSE
    v_record := api.create_record(p_project_id, 'experiment', v_title);
  END IF;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'the experiment could not be created' USING ERRCODE = 'SB015';
  END IF;

  FOR v_part IN SELECT * FROM jsonb_array_elements(coalesce(v_plan -> 'parts', '[]'::jsonb)) LOOP
    v_part_row := api.create_experiment_part(
      v_record.id, btrim(v_part ->> 'title'), NULLIF(v_part ->> 'dayOffset', '')::integer);
    PERFORM api.set_part_plan(
      (v_part_row ->> 'id')::uuid,
      coalesce(NULLIF(v_part ->> 'handsOnMinutes', '')::integer, 60),
      coalesce(NULLIF(v_part ->> 'waitAfterMinutes', '')::integer, 0),
      (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'resourceId', n ->> 'instrumentId',
                'minutes', coalesce(NULLIF(n ->> 'minutes', '')::integer, 30))), '[]'::jsonb)
         FROM jsonb_array_elements(coalesce(v_part -> 'needs', '[]'::jsonb)) n));
    -- A part that opens when the one before it is done (a gate that warns or blocks).
    IF v_prev_part IS NOT NULL AND NULLIF(v_part ->> 'gate', '') IS NOT NULL THEN
      PERFORM api.set_part_gate(
        (v_part_row ->> 'id')::uuid,
        jsonb_build_array(jsonb_build_object('kind', 'part_done', 'partId', v_prev_part)),
        v_part ->> 'gate', NULL);
    END IF;
    v_prev_part := (v_part_row ->> 'id')::uuid;
  END LOOP;

  IF jsonb_typeof(v_plan -> 'plate') = 'object' THEN
    v_wells := v_plan #> '{plate,wells}';
    v_format := coalesce(v_plan #>> '{plate,format}', '96_well');
    v_run := api.create_plate_run(
      coalesce(NULLIF(btrim(v_plan #>> '{plate,name}'), ''), v_title), v_format, v_wells,
      '{}'::jsonb, '{}'::jsonb, p_project_id, v_record.id, NULL);
    IF jsonb_typeof(v_plan -> 'worklist') = 'object'
       AND jsonb_array_length(coalesce(v_plan #> '{worklist,transfers}', '[]'::jsonb)) > 0 THEN
      v_wl := api.create_plate_worklist(
        v_title || ' worklist',
        coalesce(v_plan #>> '{worklist,format}', 'csv'),
        coalesce(v_plan #>> '{worklist,mode}', 'stamp'),
        coalesce(NULLIF(v_plan #>> '{worklist,sourcePlate}', ''), 'Source'),
        coalesce(v_plan #>> '{worklist,sourceFormat}', v_format),
        'PLR-' || lpad(v_run.number::text, 4, '0'),
        v_format,
        v_plan #> '{worklist,transfers}',
        v_run.id, v_record.id, '{}'::jsonb);
    END IF;
  END IF;

  FOR v_sample IN SELECT * FROM jsonb_array_elements(coalesce(v_plan -> 'samples', '[]'::jsonb)) LOOP
    PERFORM api.create_sample_reservation(
      (v_sample ->> 'recordId')::uuid, v_record.id, (v_sample ->> 'quantity')::numeric,
      NULLIF(v_sample ->> 'unit', ''), true, 'Set aside by the experiment planner');
    v_reservations := v_reservations + 1;
  END LOOP;

  IF coalesce((v_plan ->> 'schedule')::boolean, false)
     AND jsonb_array_length(coalesce(v_plan -> 'parts', '[]'::jsonb)) > 0 THEN
    v_proposal := api.request_schedule_proposal(v_record.id);
  END IF;

  v_result := jsonb_build_object(
    'recordId', v_record.id, 'identifier', v_record.identifier,
    'plateRunId', v_run.id, 'worklistId', v_wl.id, 'proposalId', v_proposal.id,
    'parts', jsonb_array_length(coalesce(v_plan -> 'parts', '[]'::jsonb)),
    'reservations', v_reservations);
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_planned_experiment(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_planned_experiment(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_planned_experiment(uuid, jsonb) TO authenticated;
