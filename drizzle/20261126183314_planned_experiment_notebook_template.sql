-- A planned experiment can start from a notebook template, so its notebook
-- is not empty when the assistant creates it.
CREATE OR REPLACE FUNCTION api.create_planned_experiment(p_project_id uuid, p_plan jsonb) RETURNS jsonb
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
  v_notebook_version uuid;
  v_has_parts boolean;
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
  v_notebook_version := NULLIF(v_plan #>> '{experiment,notebookTemplateVersionId}', '')::uuid;

  -- A notebook template (TPL-0004) gives the experiment its notebook content,
  -- the same as starting one from the template in the app.
  IF v_notebook_version IS NOT NULL THEN
    v_made := api.instantiate_notebook_template_version(
      v_notebook_version, p_project_id, v_title, '[]'::jsonb, gen_random_uuid()::text);
    SELECT * INTO v_record FROM api.records WHERE id = (v_made #>> '{record,id}')::uuid;
  ELSIF v_template IS NOT NULL THEN
    v_made := api.instantiate_template(v_template, p_project_id, 'experiment', v_title);
    SELECT * INTO v_record FROM api.records WHERE id = (v_made #>> '{record,id}')::uuid;
  ELSE
    v_record := api.create_record(p_project_id, 'experiment', v_title);
  END IF;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'the experiment could not be created' USING ERRCODE = 'SB015';
  END IF;

  -- A template that has parts of its own already made them; the plan's would repeat them.
  v_has_parts := EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = v_record.id);
  FOR v_part IN SELECT * FROM jsonb_array_elements(coalesce(v_plan -> 'parts', '[]'::jsonb))
    WHERE NOT v_has_parts LOOP
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
