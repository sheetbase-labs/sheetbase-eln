-- The AI experiment planner and optimisation campaigns.
--
--   * Plans. A goal becomes one reviewable plan: the protocol it starts from, the
--     parts of the experiment, the plate layout, a worklist, the samples to set
--     aside and whether to ask for a schedule. A plan is a draft. Applying it
--     creates every piece in one step, as the person applying, or none at all.
--       api.experiment_plans
--   * Campaigns. There is no campaign table of records: a campaign is a record
--     of any record model ticked as a campaign list. The campaign says which
--     factors may vary and over what range, what to maximise, minimise or hit,
--     and how many rounds and runs it may spend. Each round an optimiser
--     proposes a batch of conditions, the planner lays them out as a plate and a
--     worklist, a person approves the round, the results come back and the
--     next round is proposed from them.
--       api.model_campaign_lists, api.campaigns, api.campaign_rounds

-- Events -----------------------------------------------------------------------
DO $$
DECLARE
  v_def text;
  v_type text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  FOREACH v_type IN ARRAY ARRAY['experiment_plan', 'campaign', 'campaign_round'] LOOP
    IF position('''' || v_type || '''' IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_type || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('plan.proposed'), ('plan.applied'), ('plan.dismissed'),
  ('campaign.started'), ('campaign.finished'),
  ('campaign.round.proposed'), ('campaign.round.approved'),
  ('campaign.round.rejected'), ('campaign.round.completed')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ===========================================================================
-- Plans
-- ===========================================================================

CREATE TABLE api.experiment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    project_id uuid NOT NULL,
    goal text NOT NULL,
    summary text DEFAULT '' NOT NULL,
    -- proposed: waiting for a person. applied: everything was created.
    -- dismissed: set aside. superseded: a newer plan for the same goal replaced it.
    status text DEFAULT 'proposed' NOT NULL,
    -- 'page', 'assistant' or 'api': where the plan was drawn up.
    source text DEFAULT 'api' NOT NULL,
    -- { summary, rationale, experiment: {title, templateRecordId}, parts: [{title, dayOffset,
    --   handsOnMinutes, waitAfterMinutes, needs: [{instrumentId, minutes}]}],
    --   plate: {name, format, wells: [...]}, worklist: {format, mode, sourcePlate, transfers: [...]},
    --   samples: [{recordId, quantity, unit}], schedule: boolean, warnings: [text] }
    plan jsonb NOT NULL,
    -- What applying created: { recordId, plateRunId, worklistId, proposalId, reservations }.
    result jsonb,
    created_by_user_id text NOT NULL,
    decided_by_user_id text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT experiment_plans_pkey PRIMARY KEY (id),
    CONSTRAINT uq_experiment_plans_number UNIQUE (workspace_id, number),
    CONSTRAINT experiment_plans_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT experiment_plans_project_fk FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE CASCADE,
    CONSTRAINT experiment_plans_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_experiment_plans_status CHECK (status IN ('proposed', 'applied', 'dismissed', 'superseded')),
    CONSTRAINT chk_experiment_plans_source CHECK (source IN ('page', 'assistant', 'api')),
    CONSTRAINT chk_experiment_plans_goal CHECK (char_length(btrim(goal)) BETWEEN 1 AND 2000),
    CONSTRAINT chk_experiment_plans_plan CHECK (jsonb_typeof(plan) = 'object' AND pg_column_size(plan) <= 1048576)
);
--> statement-breakpoint
ALTER TABLE api.experiment_plans OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_experiment_plans_project ON api.experiment_plans (project_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE api.experiment_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experiment_plans_select ON api.experiment_plans FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY experiment_plans_client_select ON api.experiment_plans FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY experiment_plans_live_read ON api.experiment_plans AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('project'::text, project_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.experiment_plans TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION internal.emit_plan_event(p_row api.experiment_plans, p_change text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(p_row.workspace_id, 'experiment_plan', p_row.id,
    CASE p_change WHEN 'proposed' THEN 'create' ELSE 'update' END,
    NULLIF(p_row.result ->> 'recordId', '')::uuid, p_row.project_id,
    jsonb_build_object('change', p_change, 'planId', p_row.id,
                       'reference', 'PLN-' || lpad(p_row.number::text, 4, '0'),
                       'projectId', p_row.project_id, 'goal', left(p_row.goal, 300),
                       'summary', left(p_row.summary, 300), 'status', p_row.status,
                       'source', p_row.source,
                       'recordId', p_row.result ->> 'recordId'));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_plan_event(api.experiment_plans, text) OWNER TO migrator;
--> statement-breakpoint

-- Check the parts of a plan that Apply relies on, so a bad plan is refused when it
-- is saved and not half way through applying it.
CREATE FUNCTION internal.check_experiment_plan(p_plan jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_part jsonb;
  v_need jsonb;
  v_sample jsonb;
BEGIN
  IF jsonb_typeof(p_plan) <> 'object' THEN
    RAISE EXCEPTION 'a plan is a JSON object' USING ERRCODE = '22023';
  END IF;
  IF char_length(btrim(coalesce(p_plan #>> '{experiment,title}', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'give the experiment a title of up to 200 characters' USING ERRCODE = '22023';
  END IF;
  IF p_plan -> 'parts' IS NOT NULL AND jsonb_typeof(p_plan -> 'parts') <> 'array' THEN
    RAISE EXCEPTION 'parts is a list' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(coalesce(p_plan -> 'parts', '[]'::jsonb)) > 60 THEN
    RAISE EXCEPTION 'an experiment can have up to 60 parts' USING ERRCODE = '22023';
  END IF;
  FOR v_part IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'parts', '[]'::jsonb)) LOOP
    IF jsonb_typeof(v_part) <> 'object' OR char_length(btrim(coalesce(v_part ->> 'title', ''))) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'every part needs a title of up to 200 characters' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(coalesce(v_part -> 'needs', '[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'a part''s needs are a list' USING ERRCODE = '22023';
    END IF;
    FOR v_need IN SELECT * FROM jsonb_array_elements(coalesce(v_part -> 'needs', '[]'::jsonb)) LOOP
      IF jsonb_typeof(v_need) <> 'object'
         OR NULLIF(v_need ->> 'instrumentId', '') IS NULL THEN
        RAISE EXCEPTION 'every need names an instrument' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  IF p_plan -> 'plate' IS NOT NULL AND jsonb_typeof(p_plan -> 'plate') = 'object' THEN
    IF jsonb_typeof(coalesce(p_plan #> '{plate,wells}', 'null'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'a plate needs a list of wells' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_plan -> 'worklist' IS NOT NULL AND jsonb_typeof(p_plan -> 'worklist') = 'object' AND p_plan -> 'plate' IS NULL THEN
    RAISE EXCEPTION 'a worklist needs the plate it fills' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_plan -> 'samples', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'samples is a list' USING ERRCODE = '22023';
  END IF;
  FOR v_sample IN SELECT * FROM jsonb_array_elements(coalesce(p_plan -> 'samples', '[]'::jsonb)) LOOP
    IF jsonb_typeof(v_sample) <> 'object'
       OR NULLIF(v_sample ->> 'recordId', '') IS NULL
       OR coalesce((v_sample ->> 'quantity')::numeric, 0) <= 0 THEN
      RAISE EXCEPTION 'every sample names a record and a quantity above zero' USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_experiment_plan(jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_experiment_plan(jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Save a plan. Nothing is created: the plan waits for a person to apply it.
CREATE FUNCTION api.create_experiment_plan(
    p_project_id uuid, p_goal text, p_plan jsonb, p_source text DEFAULT 'api')
RETURNS api.experiment_plans
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_row api.experiment_plans;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('project', p_project_id, 'edit');
  IF coalesce(p_source, 'api') NOT IN ('page', 'assistant', 'api') THEN
    RAISE EXCEPTION 'unknown source' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.check_experiment_plan(p_plan);
  PERFORM pg_advisory_xact_lock(hashtextextended('experiment_plans:' || v_ws::text, 0));
  INSERT INTO api.experiment_plans
    (workspace_id, number, project_id, goal, summary, source, plan, created_by_user_id)
  VALUES
    (v_ws, (SELECT coalesce(max(number), 0) + 1 FROM api.experiment_plans WHERE workspace_id = v_ws),
     p_project_id, btrim(p_goal), left(coalesce(p_plan ->> 'summary', ''), 600),
     coalesce(p_source, 'api'), p_plan, api.current_user_id())
  RETURNING * INTO v_row;
  PERFORM internal.emit_plan_event(v_row, 'proposed');
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_experiment_plan(uuid, text, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_experiment_plan(uuid, text, jsonb, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_experiment_plan(uuid, text, jsonb, text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.dismiss_experiment_plan(p_plan_id uuid) RETURNS api.experiment_plans
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_plans;
BEGIN
  SELECT * INTO v_row FROM api.experiment_plans
   WHERE id = p_plan_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'plan not found in active workspace' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('project', v_row.project_id, 'edit');
  IF v_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'only a plan that is waiting can be dismissed' USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.experiment_plans
     SET status = 'dismissed', decided_by_user_id = api.current_user_id(), decided_at = now()
   WHERE id = p_plan_id RETURNING * INTO v_row;
  PERFORM internal.emit_plan_event(v_row, 'dismissed');
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.dismiss_experiment_plan(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dismiss_experiment_plan(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.dismiss_experiment_plan(uuid) TO authenticated;
--> statement-breakpoint

-- Apply a plan: create the experiment (from its protocol when the plan names one),
-- the parts with their hands-on time, waits and instruments, the plate run, the
-- worklist, the sample reservations and, when asked, a request for a schedule.
-- Everything is done as the person applying, through the same functions the pages
-- call, so every permission and rule still applies; if any step is refused the
-- whole plan is left unapplied and the reason comes back.
CREATE FUNCTION api.apply_experiment_plan(p_plan_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.experiment_plans;
  v_plan jsonb;
  v_title text;
  v_record api.records;
  v_made jsonb;
  v_part jsonb;
  v_part_row jsonb;
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
  SELECT * INTO v_row FROM api.experiment_plans
   WHERE id = p_plan_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'plan not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('project', v_row.project_id, 'edit');
  IF v_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'this plan is already %', v_row.status USING ERRCODE = 'SB004';
  END IF;
  v_plan := v_row.plan;
  PERFORM internal.check_experiment_plan(v_plan);
  v_title := btrim(v_plan #>> '{experiment,title}');
  v_template := NULLIF(v_plan #>> '{experiment,templateRecordId}', '')::uuid;

  IF v_template IS NOT NULL THEN
    v_made := api.instantiate_template(v_template, v_row.project_id, 'experiment', v_title);
    SELECT * INTO v_record FROM api.records WHERE id = (v_made #>> '{record,id}')::uuid;
  ELSE
    v_record := api.create_record(v_row.project_id, 'experiment', v_title);
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
  END LOOP;

  IF jsonb_typeof(v_plan -> 'plate') = 'object' THEN
    v_wells := v_plan #> '{plate,wells}';
    v_format := coalesce(v_plan #>> '{plate,format}', '96_well');
    v_run := api.create_plate_run(
      coalesce(NULLIF(btrim(v_plan #>> '{plate,name}'), ''), v_title), v_format, v_wells,
      '{}'::jsonb, '{}'::jsonb, v_row.project_id, v_record.id, NULL);
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
      NULLIF(v_sample ->> 'unit', ''), true, 'Set aside by plan PLN-' || lpad(v_row.number::text, 4, '0'));
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
  UPDATE api.experiment_plans
     SET status = 'applied', result = v_result,
         decided_by_user_id = api.current_user_id(), decided_at = now()
   WHERE id = p_plan_id RETURNING * INTO v_row;
  PERFORM internal.emit_plan_event(v_row, 'applied');
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.apply_experiment_plan(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.apply_experiment_plan(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.apply_experiment_plan(uuid) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- Campaigns
-- ===========================================================================

-- A campaign is a record of a model with this box ticked, like an incident log.
CREATE TABLE api.model_campaign_lists (
    workspace_id uuid NOT NULL,
    model_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    CONSTRAINT model_campaign_lists_pkey PRIMARY KEY (workspace_id, model_key)
);
--> statement-breakpoint
ALTER TABLE api.model_campaign_lists OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.model_campaign_lists ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY model_campaign_lists_select ON api.model_campaign_lists FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY model_campaign_lists_client_select ON api.model_campaign_lists FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.model_campaign_lists TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_model_campaign_list(p_model_key text, p_enabled boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  IF NOT EXISTS (SELECT 1 FROM api.record_models m
                  WHERE m.workspace_id = v_workspace_id AND m.key = p_model_key) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_enabled, false) THEN
    INSERT INTO api.model_campaign_lists (workspace_id, model_key, created_by_user_id)
    VALUES (v_workspace_id, p_model_key, api.current_user_id())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM api.model_campaign_lists
     WHERE workspace_id = v_workspace_id AND model_key = p_model_key;
  END IF;
  RETURN coalesce(p_enabled, false);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_campaign_list(text, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_campaign_list(text, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_campaign_list(text, boolean) TO authenticated;
--> statement-breakpoint

CREATE TABLE api.campaigns (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    -- [{key, label, kind: 'continuous'|'discrete'|'categorical', min, max, values, unit}]
    factors jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- [{key, label, direction: 'maximise'|'minimise'|'target', target, weight, unit}]
    objectives jsonb DEFAULT '[]'::jsonb NOT NULL,
    batch_size integer DEFAULT 8 NOT NULL,
    max_rounds integer DEFAULT 6 NOT NULL,
    max_runs integer,
    -- 'auto' uses BayBE when the Python runtime has it and the built-in optimiser otherwise.
    engine text DEFAULT 'auto' NOT NULL,
    -- {plateFormat: '96_well'|'384_well'|null, replicates, blanks, positives, negatives, volumeUl,
    --  worklistFormat, sourcePlate}
    layout jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- The protocol each round's experiment starts from (optional).
    template_record_id uuid,
    -- When a round's results are all in, ask for the next round straight away.
    auto_propose boolean DEFAULT true NOT NULL,
    seed integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'draft' NOT NULL,
    -- The experiment that heads the series every round's experiment joins.
    series_record_id uuid,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaigns_pkey PRIMARY KEY (record_id),
    CONSTRAINT campaigns_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT campaigns_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT campaigns_template_fk FOREIGN KEY (template_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT campaigns_series_fk FOREIGN KEY (series_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT campaigns_created_by_fk FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_campaigns_factors CHECK (jsonb_typeof(factors) = 'array' AND jsonb_array_length(factors) <= 24),
    CONSTRAINT chk_campaigns_objectives CHECK (jsonb_typeof(objectives) = 'array' AND jsonb_array_length(objectives) <= 4),
    CONSTRAINT chk_campaigns_batch CHECK (batch_size BETWEEN 1 AND 96),
    CONSTRAINT chk_campaigns_rounds CHECK (max_rounds BETWEEN 1 AND 50),
    CONSTRAINT chk_campaigns_runs CHECK (max_runs IS NULL OR max_runs BETWEEN 1 AND 5000),
    CONSTRAINT chk_campaigns_engine CHECK (engine IN ('auto', 'baybe', 'builtin')),
    CONSTRAINT chk_campaigns_layout CHECK (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) <= 8192),
    CONSTRAINT chk_campaigns_status CHECK (status IN ('draft', 'active', 'paused', 'finished'))
);
--> statement-breakpoint
ALTER TABLE api.campaigns OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaigns_select ON api.campaigns FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY campaigns_client_select ON api.campaigns FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY campaigns_live_read ON api.campaigns AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('record'::text, record_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.campaigns TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.campaign_rounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    campaign_record_id uuid NOT NULL,
    number integer NOT NULL,
    -- requested: waiting for the optimiser. proposing: the optimiser is working.
    -- proposed: a batch waits for a person. approved: the experiment and plate exist and
    -- the results are awaited. completed: every result is in. rejected: set aside, its
    -- conditions teach the optimiser nothing. failed: the optimiser could not answer.
    status text DEFAULT 'requested' NOT NULL,
    batch_size integer NOT NULL,
    engine text,
    engine_version text,
    image_digest text,
    -- [{trial: 1, factors: {key: value}, wells: ['A1'], results: {objective: value} | null}]
    trials jsonb DEFAULT '[]'::jsonb NOT NULL,
    -- {observations, best: {trial, round, values}, strategy, note}
    rationale jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- {format, wells: [...], transfers: [...]}: the layout made for the batch.
    plate jsonb,
    experiment_record_id uuid,
    plate_run_id uuid,
    worklist_id uuid,
    error_message text,
    requested_by_user_id text NOT NULL,
    decided_by_user_id text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    proposed_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT campaign_rounds_pkey PRIMARY KEY (id),
    CONSTRAINT uq_campaign_rounds_number UNIQUE (campaign_record_id, number),
    CONSTRAINT campaign_rounds_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT campaign_rounds_campaign_fk FOREIGN KEY (campaign_record_id) REFERENCES api.campaigns(record_id) ON DELETE CASCADE,
    CONSTRAINT campaign_rounds_experiment_fk FOREIGN KEY (experiment_record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT campaign_rounds_plate_run_fk FOREIGN KEY (plate_run_id) REFERENCES api.plate_runs(id) ON DELETE SET NULL,
    CONSTRAINT campaign_rounds_worklist_fk FOREIGN KEY (worklist_id) REFERENCES api.plate_worklists(id) ON DELETE SET NULL,
    CONSTRAINT campaign_rounds_requested_by_fk FOREIGN KEY (requested_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_campaign_rounds_status CHECK (status IN ('requested', 'proposing', 'proposed', 'approved', 'completed', 'rejected', 'failed')),
    CONSTRAINT chk_campaign_rounds_batch CHECK (batch_size BETWEEN 1 AND 96),
    CONSTRAINT chk_campaign_rounds_trials CHECK (jsonb_typeof(trials) = 'array' AND jsonb_array_length(trials) <= 96),
    CONSTRAINT chk_campaign_rounds_rationale CHECK (jsonb_typeof(rationale) = 'object'),
    CONSTRAINT chk_campaign_rounds_plate CHECK (plate IS NULL OR jsonb_typeof(plate) = 'object')
);
--> statement-breakpoint
ALTER TABLE api.campaign_rounds OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_campaign_rounds_waiting ON api.campaign_rounds (created_at) WHERE status = 'requested';
--> statement-breakpoint
ALTER TABLE api.campaign_rounds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaign_rounds_select ON api.campaign_rounds FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY campaign_rounds_client_select ON api.campaign_rounds FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY campaign_rounds_live_read ON api.campaign_rounds AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('record'::text, campaign_record_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.campaign_rounds TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION internal.emit_campaign_event(p_campaign api.campaigns, p_change text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(p_campaign.workspace_id, 'campaign', p_campaign.record_id,
    CASE p_change WHEN 'started' THEN 'create' ELSE 'update' END, p_campaign.record_id, NULL,
    jsonb_build_object('change', p_change, 'campaignId', p_campaign.record_id,
                       'status', p_campaign.status,
                       'rounds', (SELECT count(*) FROM api.campaign_rounds r WHERE r.campaign_record_id = p_campaign.record_id)));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_campaign_event(api.campaigns, text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.emit_campaign_round_event(p_round api.campaign_rounds, p_change text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(p_round.workspace_id, 'campaign_round', p_round.id,
    CASE p_change WHEN 'proposed' THEN 'create' ELSE 'update' END, p_round.campaign_record_id, NULL,
    jsonb_build_object('change', p_change, 'roundId', p_round.id, 'campaignId', p_round.campaign_record_id,
                       'number', p_round.number, 'status', p_round.status,
                       'trials', jsonb_array_length(p_round.trials), 'engine', p_round.engine,
                       'experimentId', p_round.experiment_record_id, 'plateRunId', p_round.plate_run_id,
                       'best', p_round.rationale -> 'best'));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_campaign_round_event(api.campaign_rounds, text) OWNER TO migrator;
--> statement-breakpoint

-- Check the factors and objectives of a campaign design.
CREATE FUNCTION internal.check_campaign_design(p_factors jsonb, p_objectives jsonb) RETURNS void
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_item jsonb;
  v_keys text[] := '{}';
  v_key text;
  v_kind text;
BEGIN
  IF jsonb_typeof(p_factors) IS DISTINCT FROM 'array' OR jsonb_array_length(p_factors) NOT BETWEEN 1 AND 24 THEN
    RAISE EXCEPTION 'give the campaign between 1 and 24 factors' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_factors) LOOP
    v_key := v_item ->> 'key';
    v_kind := v_item ->> 'kind';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{0,39}$' THEN
      RAISE EXCEPTION 'a factor key is lower case letters, digits and underscores, starting with a letter' USING ERRCODE = '22023';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'two factors are called %', v_key USING ERRCODE = '22023';
    END IF;
    v_keys := v_keys || v_key;
    IF char_length(btrim(coalesce(v_item ->> 'label', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'every factor needs a label' USING ERRCODE = '22023';
    END IF;
    IF v_kind = 'continuous' THEN
      IF jsonb_typeof(v_item -> 'min') IS DISTINCT FROM 'number' OR jsonb_typeof(v_item -> 'max') IS DISTINCT FROM 'number'
         OR (v_item ->> 'min')::numeric >= (v_item ->> 'max')::numeric THEN
        RAISE EXCEPTION 'factor % needs a minimum below its maximum', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_kind = 'discrete' THEN
      IF jsonb_typeof(v_item -> 'values') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item -> 'values') NOT BETWEEN 2 AND 50
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item -> 'values') x WHERE jsonb_typeof(x) <> 'number') THEN
        RAISE EXCEPTION 'factor % needs between 2 and 50 numeric values', v_key USING ERRCODE = '22023';
      END IF;
    ELSIF v_kind = 'categorical' THEN
      IF jsonb_typeof(v_item -> 'values') IS DISTINCT FROM 'array' OR jsonb_array_length(v_item -> 'values') NOT BETWEEN 2 AND 50
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_item -> 'values') x WHERE jsonb_typeof(x) <> 'string') THEN
        RAISE EXCEPTION 'factor % needs between 2 and 50 choices', v_key USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'factor % is continuous, discrete or categorical', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p_objectives) IS DISTINCT FROM 'array' OR jsonb_array_length(p_objectives) NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'give the campaign between 1 and 4 objectives' USING ERRCODE = '22023';
  END IF;
  v_keys := '{}';
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_objectives) LOOP
    v_key := v_item ->> 'key';
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' OR v_key IS NULL OR v_key !~ '^[a-z][a-z0-9_]{0,39}$' THEN
      RAISE EXCEPTION 'an objective key is lower case letters, digits and underscores, starting with a letter' USING ERRCODE = '22023';
    END IF;
    IF v_key = ANY (v_keys) THEN
      RAISE EXCEPTION 'two objectives are called %', v_key USING ERRCODE = '22023';
    END IF;
    v_keys := v_keys || v_key;
    IF char_length(btrim(coalesce(v_item ->> 'label', ''))) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'every objective needs a label' USING ERRCODE = '22023';
    END IF;
    IF coalesce(v_item ->> 'direction', '') NOT IN ('maximise', 'minimise', 'target') THEN
      RAISE EXCEPTION 'objective % is to maximise, minimise or hit a target', v_key USING ERRCODE = '22023';
    END IF;
    IF v_item ->> 'direction' = 'target' AND jsonb_typeof(v_item -> 'target') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'objective % needs a target value', v_key USING ERRCODE = '22023';
    END IF;
    IF v_item ? 'weight' AND (jsonb_typeof(v_item -> 'weight') IS DISTINCT FROM 'number' OR (v_item ->> 'weight')::numeric <= 0) THEN
      RAISE EXCEPTION 'objective % needs a weight above zero', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.check_campaign_design(jsonb, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.check_campaign_design(jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint

-- Make a record a campaign, or change one. The factors and objectives can change
-- until a round has been asked for; everything else can change at any time.
CREATE FUNCTION api.configure_campaign(
    p_record_id uuid, p_factors jsonb, p_objectives jsonb,
    p_batch_size integer DEFAULT 8, p_max_rounds integer DEFAULT 6, p_max_runs integer DEFAULT NULL,
    p_engine text DEFAULT 'auto', p_layout jsonb DEFAULT '{}'::jsonb,
    p_template_record_id uuid DEFAULT NULL, p_auto_propose boolean DEFAULT true, p_seed integer DEFAULT 1)
RETURNS api.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_rec api.records;
  v_existing api.campaigns;
  v_row api.campaigns;
  v_has_rounds boolean;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rec FROM api.records WHERE id = p_record_id AND workspace_id = v_ws AND deleted_at IS NULL;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  IF NOT EXISTS (SELECT 1 FROM api.model_campaign_lists WHERE workspace_id = v_ws AND model_key = v_rec.kind) THEN
    RAISE EXCEPTION 'only a record of a model ticked as a campaign list can be a campaign' USING ERRCODE = 'SB004';
  END IF;
  IF coalesce(p_engine, 'auto') NOT IN ('auto', 'baybe', 'builtin') THEN
    RAISE EXCEPTION 'the engine is auto, baybe or builtin' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_layout ->> 'plateFormat', '96_well') NOT IN ('6_well', '12_well', '24_well', '48_well', '96_well', '384_well') THEN
    RAISE EXCEPTION 'unsupported plate format' USING ERRCODE = 'SB005';
  END IF;
  IF p_template_record_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.records t WHERE t.id = p_template_record_id AND t.workspace_id = v_ws
          AND t.kind = 'protocol_template' AND t.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'protocol not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  SELECT * INTO v_existing FROM api.campaigns WHERE record_id = p_record_id FOR UPDATE;
  v_has_rounds := v_existing.record_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM api.campaign_rounds WHERE campaign_record_id = p_record_id);
  IF v_has_rounds AND (v_existing.factors IS DISTINCT FROM p_factors OR v_existing.objectives IS DISTINCT FROM p_objectives) THEN
    RAISE EXCEPTION 'the factors and objectives cannot change once a round has been asked for' USING ERRCODE = 'SB004';
  END IF;
  IF NOT v_has_rounds THEN
    PERFORM internal.check_campaign_design(p_factors, p_objectives);
  END IF;
  INSERT INTO api.campaigns
    (record_id, workspace_id, factors, objectives, batch_size, max_rounds, max_runs, engine, layout,
     template_record_id, auto_propose, seed, created_by_user_id)
  VALUES
    (p_record_id, v_ws, p_factors, p_objectives, p_batch_size, p_max_rounds, p_max_runs,
     coalesce(p_engine, 'auto'), coalesce(p_layout, '{}'::jsonb), p_template_record_id,
     coalesce(p_auto_propose, true), coalesce(p_seed, 1), api.current_user_id())
  ON CONFLICT (record_id) DO UPDATE
     SET factors = EXCLUDED.factors, objectives = EXCLUDED.objectives, batch_size = EXCLUDED.batch_size,
         max_rounds = EXCLUDED.max_rounds, max_runs = EXCLUDED.max_runs, engine = EXCLUDED.engine,
         layout = EXCLUDED.layout, template_record_id = EXCLUDED.template_record_id,
         auto_propose = EXCLUDED.auto_propose, seed = EXCLUDED.seed, updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.configure_campaign(uuid, jsonb, jsonb, integer, integer, integer, text, jsonb, uuid, boolean, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.configure_campaign(uuid, jsonb, jsonb, integer, integer, integer, text, jsonb, uuid, boolean, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.configure_campaign(uuid, jsonb, jsonb, integer, integer, integer, text, jsonb, uuid, boolean, integer) TO authenticated;
--> statement-breakpoint

-- Whether the campaign can still spend a round and a run, and how big the next batch is.
CREATE FUNCTION internal.campaign_next_batch(p_campaign api.campaigns) RETURNS integer
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN (SELECT count(*) FROM api.campaign_rounds r
           WHERE r.campaign_record_id = p_campaign.record_id AND r.status NOT IN ('rejected', 'failed'))
         >= p_campaign.max_rounds THEN 0
    ELSE least(p_campaign.batch_size,
      CASE WHEN p_campaign.max_runs IS NULL THEN p_campaign.batch_size
           ELSE greatest(p_campaign.max_runs - (
             SELECT coalesce(sum(jsonb_array_length(r.trials)), 0)::integer FROM api.campaign_rounds r
              WHERE r.campaign_record_id = p_campaign.record_id AND r.status IN ('proposed', 'approved', 'completed')), 0)
      END)
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.campaign_next_batch(api.campaigns) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.campaign_next_batch(api.campaigns) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.queue_campaign_round(p_campaign api.campaigns) RETURNS api.campaign_rounds
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaign_rounds;
  v_batch integer := internal.campaign_next_batch(p_campaign);
BEGIN
  IF v_batch < 1 THEN
    RAISE EXCEPTION 'the campaign has used its rounds or runs' USING ERRCODE = 'SB004';
  END IF;
  INSERT INTO api.campaign_rounds
    (workspace_id, campaign_record_id, number, batch_size, requested_by_user_id)
  VALUES
    (p_campaign.workspace_id, p_campaign.record_id,
     (SELECT coalesce(max(number), 0) + 1 FROM api.campaign_rounds WHERE campaign_record_id = p_campaign.record_id),
     v_batch, api.current_user_id())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.queue_campaign_round(api.campaigns) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.queue_campaign_round(api.campaigns) FROM PUBLIC;
--> statement-breakpoint

-- The campaign for a record the caller may edit.
CREATE FUNCTION internal.campaign_for_edit(p_record_id uuid) RETURNS api.campaigns
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaigns;
BEGIN
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM api.campaigns
   WHERE record_id = p_record_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.record_id IS NULL THEN
    RAISE EXCEPTION 'campaign not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.campaign_for_edit(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.campaign_for_edit(uuid) FROM PUBLIC;
--> statement-breakpoint

-- Start a campaign: it becomes active and the first round is asked for.
CREATE FUNCTION api.start_campaign(p_record_id uuid) RETURNS api.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaigns := internal.campaign_for_edit(p_record_id);
BEGIN
  IF v_row.status NOT IN ('draft', 'paused') THEN
    RAISE EXCEPTION 'this campaign is already %', v_row.status USING ERRCODE = 'SB004';
  END IF;
  PERFORM internal.check_campaign_design(v_row.factors, v_row.objectives);
  UPDATE api.campaigns SET status = 'active', updated_at = now() WHERE record_id = p_record_id
  RETURNING * INTO v_row;
  IF NOT EXISTS (SELECT 1 FROM api.campaign_rounds
                  WHERE campaign_record_id = p_record_id
                    AND status IN ('requested', 'proposing', 'proposed', 'approved')) THEN
    PERFORM internal.queue_campaign_round(v_row);
  END IF;
  PERFORM internal.emit_campaign_event(v_row, 'started');
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_campaign(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_campaign(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_campaign(uuid) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.set_campaign_status(p_record_id uuid, p_status text) RETURNS api.campaigns
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaigns := internal.campaign_for_edit(p_record_id);
BEGIN
  IF p_status NOT IN ('paused', 'finished') THEN
    RAISE EXCEPTION 'a campaign can be paused or finished; start it to make it active' USING ERRCODE = '22023';
  END IF;
  IF v_row.status = 'finished' THEN
    RAISE EXCEPTION 'this campaign is finished' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.status = 'draft' THEN
    RAISE EXCEPTION 'this campaign has not started' USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.campaigns SET status = p_status, updated_at = now() WHERE record_id = p_record_id
  RETURNING * INTO v_row;
  IF p_status = 'finished' THEN
    UPDATE api.campaign_rounds SET status = 'rejected', decided_at = now(), decided_by_user_id = api.current_user_id()
     WHERE campaign_record_id = p_record_id AND status IN ('requested', 'proposing', 'proposed');
    PERFORM internal.emit_campaign_event(v_row, 'finished');
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_campaign_status(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_campaign_status(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_campaign_status(uuid, text) TO authenticated;
--> statement-breakpoint

-- Ask for the next round. One round is open at a time.
CREATE FUNCTION api.request_campaign_round(p_record_id uuid) RETURNS api.campaign_rounds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_campaign api.campaigns := internal.campaign_for_edit(p_record_id);
  v_open api.campaign_rounds;
BEGIN
  IF v_campaign.status <> 'active' THEN
    RAISE EXCEPTION 'start the campaign before asking for a round' USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_open FROM api.campaign_rounds
   WHERE campaign_record_id = p_record_id AND status IN ('requested', 'proposing', 'proposed', 'approved')
   ORDER BY number DESC LIMIT 1;
  IF v_open.id IS NOT NULL THEN
    IF v_open.status IN ('requested', 'proposing') THEN RETURN v_open; END IF;
    RAISE EXCEPTION 'round % is still open: approve or reject it, or enter its results, first', v_open.number
      USING ERRCODE = 'SB004';
  END IF;
  RETURN internal.queue_campaign_round(v_campaign);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_campaign_round(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_campaign_round(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_campaign_round(uuid) TO authenticated;
--> statement-breakpoint

-- Server side: claim the oldest waiting round, read what the optimiser needs, and
-- write its answer.
CREATE FUNCTION internal.claim_campaign_round() RETURNS api.campaign_rounds
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaign_rounds;
BEGIN
  SELECT * INTO v_row FROM api.campaign_rounds WHERE status = 'requested'
   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  UPDATE api.campaign_rounds SET status = 'proposing' WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.claim_campaign_round() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_campaign_round() FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.fill_campaign_round(
    p_id uuid, p_engine text, p_engine_version text, p_image_digest text,
    p_trials jsonb, p_rationale jsonb, p_plate jsonb, p_error text)
RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.campaign_rounds;
BEGIN
  SELECT * INTO v_row FROM api.campaign_rounds WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN; END IF;
  -- Emit as the person who asked, so the event carries who it was for.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_row.requested_by_user_id,
                                                              'workspace_id', v_row.workspace_id)::text, true);
  IF p_error IS NOT NULL THEN
    UPDATE api.campaign_rounds SET status = 'failed', error_message = left(p_error, 500), proposed_at = now()
     WHERE id = p_id;
    RETURN;
  END IF;
  UPDATE api.campaign_rounds
     SET status = 'proposed', engine = p_engine, engine_version = p_engine_version,
         image_digest = p_image_digest, trials = coalesce(p_trials, '[]'::jsonb),
         rationale = coalesce(p_rationale, '{}'::jsonb), plate = p_plate, proposed_at = now()
   WHERE id = p_id RETURNING * INTO v_row;
  PERFORM internal.emit_campaign_round_event(v_row, 'proposed');
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.fill_campaign_round(uuid, text, text, text, jsonb, jsonb, jsonb, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.fill_campaign_round(uuid, text, text, text, jsonb, jsonb, jsonb, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.reject_campaign_round(p_round_id uuid, p_reason text DEFAULT NULL) RETURNS api.campaign_rounds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_round api.campaign_rounds;
  v_campaign api.campaigns;
BEGIN
  SELECT * INTO v_round FROM api.campaign_rounds
   WHERE id = p_round_id AND workspace_id = api.current_workspace_id();
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'round not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_campaign := internal.campaign_for_edit(v_round.campaign_record_id);
  SELECT * INTO v_round FROM api.campaign_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.status NOT IN ('proposed', 'failed') THEN
    RAISE EXCEPTION 'only a round that waits for a decision can be rejected' USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.campaign_rounds
     SET status = 'rejected', decided_by_user_id = api.current_user_id(), decided_at = now(),
         error_message = coalesce(left(NULLIF(btrim(p_reason), ''), 500), error_message)
   WHERE id = p_round_id RETURNING * INTO v_round;
  PERFORM internal.emit_campaign_round_event(v_round, 'rejected');
  RETURN v_round;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.reject_campaign_round(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.reject_campaign_round(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.reject_campaign_round(uuid, text) TO authenticated;
--> statement-breakpoint

-- Approve a round: create the experiment (from the campaign's protocol when it has
-- one) in the campaign's project, group it in the campaign's series, and make the
-- plate run and worklist the planner laid out. Then the results are awaited.
CREATE FUNCTION api.approve_campaign_round(p_round_id uuid) RETURNS api.campaign_rounds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_round api.campaign_rounds;
  v_campaign api.campaigns;
  v_rec api.records;
  v_exp api.records;
  v_made jsonb;
  v_title text;
  v_run api.plate_runs;
  v_wl api.plate_worklists;
  v_format text;
  v_trials jsonb;
BEGIN
  SELECT * INTO v_round FROM api.campaign_rounds
   WHERE id = p_round_id AND workspace_id = api.current_workspace_id();
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'round not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_campaign := internal.campaign_for_edit(v_round.campaign_record_id);
  SELECT * INTO v_round FROM api.campaign_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.status <> 'proposed' THEN
    RAISE EXCEPTION 'only a proposed round can be approved' USING ERRCODE = 'SB004';
  END IF;
  IF v_campaign.status <> 'active' THEN
    RAISE EXCEPTION 'the campaign is %', v_campaign.status USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_rec FROM api.records WHERE id = v_campaign.record_id;
  IF v_rec.project_id IS NULL THEN
    RAISE EXCEPTION 'the campaign record is not in a project' USING ERRCODE = 'SB015';
  END IF;
  v_title := v_rec.identifier || ' round ' || v_round.number;

  IF v_campaign.template_record_id IS NOT NULL THEN
    v_made := api.instantiate_template(v_campaign.template_record_id, v_rec.project_id, 'experiment', v_title);
    SELECT * INTO v_exp FROM api.records WHERE id = (v_made #>> '{record,id}')::uuid;
  ELSE
    v_exp := api.create_record(v_rec.project_id, 'experiment', v_title);
  END IF;

  IF v_campaign.series_record_id IS NULL THEN
    UPDATE api.campaigns SET series_record_id = v_exp.id, updated_at = now() WHERE record_id = v_campaign.record_id;
  ELSE
    PERFORM api.add_series_member(v_campaign.series_record_id, v_exp.id);
  END IF;

  v_trials := v_round.trials;
  IF v_round.plate IS NOT NULL AND jsonb_array_length(coalesce(v_round.plate -> 'wells', '[]'::jsonb)) > 0 THEN
    v_format := coalesce(v_round.plate ->> 'format', '96_well');
    v_run := api.create_plate_run(v_title, v_format, v_round.plate -> 'wells', '{}'::jsonb, '{}'::jsonb,
                                  v_rec.project_id, v_exp.id, NULL);
    IF jsonb_array_length(coalesce(v_round.plate -> 'transfers', '[]'::jsonb)) > 0 THEN
      v_wl := api.create_plate_worklist(
        v_title || ' worklist',
        coalesce(v_campaign.layout ->> 'worklistFormat', 'csv'), 'stamp',
        coalesce(NULLIF(v_campaign.layout ->> 'sourcePlate', ''), 'Source'), v_format,
        'PLR-' || lpad(v_run.number::text, 4, '0'), v_format,
        v_round.plate -> 'transfers', v_run.id, v_exp.id, '{}'::jsonb);
    END IF;
  END IF;

  UPDATE api.campaign_rounds
     SET status = 'approved', experiment_record_id = v_exp.id, plate_run_id = v_run.id, worklist_id = v_wl.id,
         decided_by_user_id = api.current_user_id(), decided_at = now()
   WHERE id = p_round_id RETURNING * INTO v_round;
  PERFORM internal.emit_campaign_round_event(v_round, 'approved');
  RETURN v_round;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.approve_campaign_round(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.approve_campaign_round(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.approve_campaign_round(uuid) TO authenticated;
--> statement-breakpoint

-- Merge results into a round's trials. When every trial has a value for every
-- objective the round is complete, and the next round is asked for (if the
-- campaign says so and still has rounds and runs) or the campaign finishes.
CREATE FUNCTION internal.merge_campaign_results(p_round api.campaign_rounds, p_results jsonb)
RETURNS api.campaign_rounds
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_campaign api.campaigns;
  v_round api.campaign_rounds := p_round;
  v_item jsonb;
  v_pair record;
  v_trials jsonb := p_round.trials;
  v_idx integer;
  v_keys text[];
  v_complete boolean;
  v_next api.campaign_rounds;
BEGIN
  SELECT * INTO v_campaign FROM api.campaigns WHERE record_id = p_round.campaign_record_id;
  SELECT array_agg(o ->> 'key') INTO v_keys FROM jsonb_array_elements(v_campaign.objectives) o;
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'results is a list of {trial, results}' USING ERRCODE = '22023';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_results) LOOP
    SELECT i - 1 INTO v_idx
      FROM jsonb_array_elements(v_trials) WITH ORDINALITY AS t(trial, i)
     WHERE (t.trial ->> 'trial') = (v_item ->> 'trial');
    IF v_idx IS NULL THEN
      RAISE EXCEPTION 'trial % is not in round %', v_item ->> 'trial', p_round.number USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_item -> 'results') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'trial % needs its results as {objective: value}', v_item ->> 'trial' USING ERRCODE = '22023';
    END IF;
    FOR v_pair IN SELECT key, value FROM jsonb_each(v_item -> 'results') LOOP
      IF NOT (v_pair.key = ANY (v_keys)) THEN
        RAISE EXCEPTION '% is not an objective of this campaign', v_pair.key USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_pair.value) <> 'number' THEN
        RAISE EXCEPTION 'the result for % must be a number', v_pair.key USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_trials := jsonb_set(v_trials, ARRAY[v_idx::text, 'results'],
      coalesce(NULLIF(v_trials -> v_idx -> 'results', 'null'::jsonb), '{}'::jsonb) || (v_item -> 'results'));
  END LOOP;

  SELECT bool_and(coalesce(
           (SELECT bool_and(t.trial -> 'results' ? k) FROM unnest(v_keys) k), false))
    INTO v_complete FROM jsonb_array_elements(v_trials) t(trial);
  UPDATE api.campaign_rounds
     SET trials = v_trials,
         status = CASE WHEN coalesce(v_complete, false) THEN 'completed' ELSE status END,
         completed_at = CASE WHEN coalesce(v_complete, false) THEN now() ELSE completed_at END
   WHERE id = p_round.id RETURNING * INTO v_round;
  IF coalesce(v_complete, false) THEN
    PERFORM internal.emit_campaign_round_event(v_round, 'completed');
    IF internal.campaign_next_batch(v_campaign) < 1 THEN
      UPDATE api.campaigns SET status = 'finished', updated_at = now() WHERE record_id = v_campaign.record_id
      RETURNING * INTO v_campaign;
      PERFORM internal.emit_campaign_event(v_campaign, 'finished');
    ELSIF v_campaign.auto_propose AND v_campaign.status = 'active' THEN
      v_next := internal.queue_campaign_round(v_campaign);
    END IF;
  END IF;
  RETURN v_round;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.merge_campaign_results(api.campaign_rounds, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.merge_campaign_results(api.campaign_rounds, jsonb) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.record_campaign_results(p_round_id uuid, p_results jsonb) RETURNS api.campaign_rounds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_round api.campaign_rounds;
BEGIN
  SELECT * INTO v_round FROM api.campaign_rounds
   WHERE id = p_round_id AND workspace_id = api.current_workspace_id();
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'round not found in active workspace' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.campaign_for_edit(v_round.campaign_record_id);
  SELECT * INTO v_round FROM api.campaign_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.status <> 'approved' THEN
    RAISE EXCEPTION 'results can be entered for an approved round, not a % one', v_round.status USING ERRCODE = 'SB004';
  END IF;
  RETURN internal.merge_campaign_results(v_round, p_results);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_campaign_results(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_campaign_results(uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_campaign_results(uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- Take an objective's results from the round's plate run: the reading of each
-- trial's wells (the mean when it has replicates).
CREATE FUNCTION api.pull_campaign_round_results(p_round_id uuid, p_objective_key text) RETURNS api.campaign_rounds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_round api.campaign_rounds;
  v_campaign api.campaigns;
  v_run api.plate_runs;
  v_trial jsonb;
  v_vals numeric[];
  v_well text;
  v_val jsonb;
  v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_round FROM api.campaign_rounds
   WHERE id = p_round_id AND workspace_id = api.current_workspace_id();
  IF v_round.id IS NULL THEN
    RAISE EXCEPTION 'round not found in active workspace' USING ERRCODE = '42501';
  END IF;
  v_campaign := internal.campaign_for_edit(v_round.campaign_record_id);
  SELECT * INTO v_round FROM api.campaign_rounds WHERE id = p_round_id FOR UPDATE;
  IF v_round.status <> 'approved' THEN
    RAISE EXCEPTION 'results can be read for an approved round, not a % one', v_round.status USING ERRCODE = 'SB004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_campaign.objectives) o WHERE o ->> 'key' = p_objective_key) THEN
    RAISE EXCEPTION '% is not an objective of this campaign', p_objective_key USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM api.plate_runs WHERE id = v_round.plate_run_id;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'this round has no plate run to read' USING ERRCODE = 'SB015';
  END IF;
  FOR v_trial IN SELECT * FROM jsonb_array_elements(v_round.trials) LOOP
    v_vals := '{}';
    FOR v_well IN SELECT jsonb_array_elements_text(coalesce(v_trial -> 'wells', '[]'::jsonb)) LOOP
      v_val := v_run.readout -> v_well;
      IF v_val IS NOT NULL AND jsonb_typeof(v_val) = 'number' THEN
        v_vals := v_vals || (v_val #>> '{}')::numeric;
      END IF;
    END LOOP;
    IF coalesce(array_length(v_vals, 1), 0) > 0 THEN
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'trial', (v_trial ->> 'trial')::integer,
        'results', jsonb_build_object(p_objective_key, (SELECT avg(x) FROM unnest(v_vals) x))));
    END IF;
  END LOOP;
  IF jsonb_array_length(v_results) = 0 THEN
    RAISE EXCEPTION 'the plate run has no readings for this round''s wells yet' USING ERRCODE = 'SB004';
  END IF;
  RETURN internal.merge_campaign_results(v_round, v_results);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.pull_campaign_round_results(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.pull_campaign_round_results(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.pull_campaign_round_results(uuid, text) TO authenticated;
--> statement-breakpoint

-- A pipeline can ask for the next round of a campaign. The database's copy of the
-- action catalogue (checked when a pipeline is saved) gains the action.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"request_campaign_round","rpc":"request_campaign_round","label":"Propose next campaign round","description":"Ask the optimiser for the next batch of conditions. A person approves the round before anything is made.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
