-- Sample workflows: the steps a sample moves through in a lab (received, in QC,
-- in stability, released ...), defined by an admin with no code. A workflow has
-- ordered stages; each stage says where a sample may go next, what has to be
-- filled in before it gets there, how long it should stay (a turnaround), and
-- what happens when it arrives (tell someone, set a field, quarantine it, start
-- an experiment from a template). A sample is in a workflow through a run, and
-- every move is written to the run's history together with what the automation
-- did, so nothing happens silently.
--
-- Moves use the existing sample rules: an automation that quarantines a sample
-- goes through api.quarantine_sample, one that starts an experiment goes through
-- api.instantiate_notebook_template_version. An automation that cannot run is
-- recorded as failed in the history and never blocks the move.

CREATE TABLE api.sample_workflows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    -- NULL = any sample type; otherwise the sampleType the workflow applies to.
    sample_type text,
    -- New samples of the type start in the first stage on their own.
    auto_enrol boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    created_by_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sample_workflows_pkey PRIMARY KEY (id),
    CONSTRAINT sample_workflows_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT uq_sample_workflows_name UNIQUE (workspace_id, name),
    CONSTRAINT chk_sample_workflows_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_sample_workflows_status CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE api.sample_workflows OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE api.sample_workflow_stages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workflow_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    position integer NOT NULL,
    name text NOT NULL,
    description text,
    -- How long a sample should stay here; sets its due date on arrival.
    turnaround_days integer,
    -- Arriving here finishes the workflow for that sample.
    is_final boolean DEFAULT false NOT NULL,
    -- Sample fields that must be filled in before a sample can move here.
    required_fields text[] DEFAULT '{}'::text[] NOT NULL,
    -- What happens on arrival: [{kind: notify|set_field|quarantine|start_experiment, ...}]
    actions jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT sample_workflow_stages_pkey PRIMARY KEY (id),
    CONSTRAINT sample_workflow_stages_workflow_fk FOREIGN KEY (workflow_id) REFERENCES api.sample_workflows(id) ON DELETE CASCADE,
    CONSTRAINT chk_sample_workflow_stages_name CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
    CONSTRAINT chk_sample_workflow_stages_turnaround CHECK (turnaround_days IS NULL OR turnaround_days BETWEEN 1 AND 3650),
    CONSTRAINT chk_sample_workflow_stages_actions CHECK (jsonb_typeof(actions) = 'array')
);
--> statement-breakpoint
ALTER TABLE api.sample_workflow_stages OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_sample_workflow_stages_workflow ON api.sample_workflow_stages (workflow_id, position);
--> statement-breakpoint
CREATE TABLE api.sample_workflow_transitions (
    workflow_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    from_stage_id uuid NOT NULL,
    to_stage_id uuid NOT NULL,
    CONSTRAINT sample_workflow_transitions_pkey PRIMARY KEY (from_stage_id, to_stage_id),
    CONSTRAINT sample_workflow_transitions_workflow_fk FOREIGN KEY (workflow_id) REFERENCES api.sample_workflows(id) ON DELETE CASCADE,
    CONSTRAINT sample_workflow_transitions_from_fk FOREIGN KEY (from_stage_id) REFERENCES api.sample_workflow_stages(id) ON DELETE CASCADE,
    CONSTRAINT sample_workflow_transitions_to_fk FOREIGN KEY (to_stage_id) REFERENCES api.sample_workflow_stages(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.sample_workflow_transitions OWNER TO migrator;
--> statement-breakpoint
CREATE TABLE api.sample_workflow_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    workflow_id uuid NOT NULL,
    record_id uuid NOT NULL,
    stage_id uuid NOT NULL,
    entered_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone,
    started_by_user_id text,
    completed_at timestamp with time zone,
    CONSTRAINT sample_workflow_runs_pkey PRIMARY KEY (id),
    CONSTRAINT sample_workflow_runs_workflow_fk FOREIGN KEY (workflow_id) REFERENCES api.sample_workflows(id) ON DELETE CASCADE,
    CONSTRAINT sample_workflow_runs_stage_fk FOREIGN KEY (stage_id) REFERENCES api.sample_workflow_stages(id) ON DELETE RESTRICT,
    CONSTRAINT sample_workflow_runs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.sample_workflow_runs OWNER TO migrator;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_sample_workflow_runs_open ON api.sample_workflow_runs (record_id, workflow_id) WHERE completed_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_sample_workflow_runs_stage ON api.sample_workflow_runs (stage_id) WHERE completed_at IS NULL;
--> statement-breakpoint
CREATE TABLE api.sample_workflow_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    record_id uuid NOT NULL,
    from_stage_name text,
    to_stage_name text,
    notes text,
    -- What each automation did: [{kind, outcome: done|failed, message}]
    automation jsonb DEFAULT '[]'::jsonb NOT NULL,
    actor_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sample_workflow_events_pkey PRIMARY KEY (id),
    CONSTRAINT sample_workflow_events_run_fk FOREIGN KEY (run_id) REFERENCES api.sample_workflow_runs(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.sample_workflow_events OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_sample_workflow_events_record ON api.sample_workflow_events (record_id, created_at);
--> statement-breakpoint
ALTER TABLE api.sample_workflows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.sample_workflow_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.sample_workflow_transitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.sample_workflow_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.sample_workflow_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sample_workflows_select ON api.sample_workflows FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sample_workflow_stages_select ON api.sample_workflow_stages FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sample_workflow_transitions_select ON api.sample_workflow_transitions FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sample_workflow_runs_select ON api.sample_workflow_runs FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY sample_workflow_events_select ON api.sample_workflow_events FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.sample_workflows, api.sample_workflow_stages, api.sample_workflow_transitions, api.sample_workflow_runs, api.sample_workflow_events TO authenticated;
--> statement-breakpoint

-- Run what a stage does on arrival. Each automation is tried on its own; one that
-- cannot run is recorded as failed and the rest still run. `p_safe_only` limits
-- it to telling people (used when a new sample starts a workflow by itself).
CREATE FUNCTION internal.run_sample_workflow_actions(p_run api.sample_workflow_runs, p_stage api.sample_workflow_stages, p_safe_only boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_action jsonb;
  v_kind text;
  v_out jsonb := '[]'::jsonb;
  v_rec api.records;
  v_user text;
  v_msg text;
  v_title text;
  v_version uuid;
  v_project uuid;
  v_result jsonb;
  v_target text;
  v_count int;
BEGIN
  SELECT * INTO v_rec FROM api.records WHERE id = p_run.record_id;
  FOR v_action IN SELECT * FROM jsonb_array_elements(p_stage.actions) LOOP
    v_kind := v_action ->> 'kind';
    BEGIN
      IF p_safe_only AND v_kind <> 'notify' THEN
        CONTINUE;
      END IF;
      IF v_kind = 'notify' THEN
        v_title := coalesce(NULLIF(btrim(v_action ->> 'message'), ''),
                            v_rec.identifier || ' is now ' || p_stage.name);
        v_target := coalesce(v_action ->> 'to', 'owner');
        v_count := 0;
        FOR v_user IN
          SELECT u FROM (
            SELECT v_rec.created_by_user_id AS u WHERE v_target = 'owner'
            UNION
            SELECT m.user_id FROM api.workspace_memberships m
             WHERE v_target LIKE 'role:%' AND m.workspace_id = p_run.workspace_id
               AND m.role = substr(v_target, 6) AND m.suspended_at IS NULL
          ) q
        LOOP
          IF internal.notification_recipient_enabled(v_user, 'workflow_step') THEN
            INSERT INTO internal.notifications
              (workspace_id, user_id, event_type, title, body, record_id, project_id)
            VALUES (p_run.workspace_id, v_user, 'workflow_step', v_title,
                    p_stage.name, v_rec.id, v_rec.project_id);
            v_count := v_count + 1;
          END IF;
        END LOOP;
        v_out := v_out || jsonb_build_object('kind', 'notify', 'outcome', 'done',
                   'message', 'Told ' || v_count || CASE WHEN v_count = 1 THEN ' person' ELSE ' people' END);
      ELSIF v_kind = 'set_field' THEN
        IF coalesce(btrim(v_action ->> 'key'), '') = '' THEN
          RAISE EXCEPTION 'no field named' USING ERRCODE = '22023';
        END IF;
        -- A built-in sample field lives in properties; any other is a model field.
        IF EXISTS (SELECT 1 FROM api.model_base_fields b WHERE b.model_key = 'sample' AND b.field_key = v_action ->> 'key') THEN
          UPDATE api.records
             SET properties = properties || jsonb_build_object(v_action ->> 'key', v_action -> 'value'),
                 metadata_version = metadata_version + 1,
                 updated_by_user_id = api.current_user_id()
           WHERE id = v_rec.id;
        ELSE
          UPDATE api.records
             SET custom_fields = custom_fields || jsonb_build_object(v_action ->> 'key', v_action -> 'value'),
                 metadata_version = metadata_version + 1,
                 updated_by_user_id = api.current_user_id()
           WHERE id = v_rec.id;
        END IF;
        v_out := v_out || jsonb_build_object('kind', 'set_field', 'outcome', 'done',
                   'message', 'Set ' || (v_action ->> 'key'));
      ELSIF v_kind = 'quarantine' THEN
        SELECT * INTO v_rec FROM api.records WHERE id = p_run.record_id;
        PERFORM api.quarantine_sample(v_rec.id, v_rec.metadata_version,
          coalesce(NULLIF(btrim(v_action ->> 'reason'), ''), 'Held by the ' || p_stage.name || ' step'));
        v_out := v_out || jsonb_build_object('kind', 'quarantine', 'outcome', 'done', 'message', 'Quarantined');
      ELSIF v_kind = 'start_experiment' THEN
        SELECT v.id INTO v_version FROM api.notebook_template_versions v
         WHERE v.template_id = (v_action ->> 'templateId')::uuid AND v.lifecycle = 'published'
         ORDER BY v.version DESC LIMIT 1;
        IF v_version IS NULL THEN
          RAISE EXCEPTION 'the template has no published version' USING ERRCODE = 'SB090';
        END IF;
        v_project := coalesce(NULLIF(v_action ->> 'projectId', '')::uuid, v_rec.project_id);
        IF v_project IS NULL THEN
          RAISE EXCEPTION 'no project to start the experiment in' USING ERRCODE = '22023';
        END IF;
        v_result := api.instantiate_notebook_template_version(
          v_version, v_project, v_rec.identifier || ' - ' || p_stage.name, '[]'::jsonb,
          'workflow:' || p_run.id || ':' || p_stage.id || ':' || extract(epoch FROM p_run.entered_at)::text);
        v_out := v_out || jsonb_build_object('kind', 'start_experiment', 'outcome', 'done',
                   'message', 'Started an experiment', 'recordId', v_result -> 'record' ->> 'id');
      ELSE
        RAISE EXCEPTION 'unknown automation %', v_kind USING ERRCODE = '22023';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_out := v_out || jsonb_build_object('kind', v_kind, 'outcome', 'failed', 'message', v_msg);
    END;
  END LOOP;
  RETURN v_out;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.run_sample_workflow_actions(api.sample_workflow_runs, api.sample_workflow_stages, boolean) OWNER TO migrator;
--> statement-breakpoint

-- Put a sample at the first stage of a workflow.
CREATE FUNCTION internal.start_sample_workflow(p_record_id uuid, p_workflow_id uuid, p_safe_only boolean) RETURNS api.sample_workflow_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_wf api.sample_workflows;
  v_stage api.sample_workflow_stages;
  v_run api.sample_workflow_runs;
  v_auto jsonb;
BEGIN
  SELECT * INTO v_wf FROM api.sample_workflows WHERE id = p_workflow_id;
  SELECT * INTO v_stage FROM api.sample_workflow_stages WHERE workflow_id = p_workflow_id ORDER BY position LIMIT 1;
  IF v_wf.id IS NULL OR v_stage.id IS NULL THEN
    RAISE EXCEPTION 'workflow not found' USING ERRCODE = 'SB022';
  END IF;
  INSERT INTO api.sample_workflow_runs
    (workspace_id, workflow_id, record_id, stage_id, due_at, started_by_user_id)
  VALUES
    (v_wf.workspace_id, v_wf.id, p_record_id, v_stage.id,
     CASE WHEN v_stage.turnaround_days IS NULL THEN NULL ELSE now() + make_interval(days => v_stage.turnaround_days) END,
     api.current_user_id())
  RETURNING * INTO v_run;
  v_auto := internal.run_sample_workflow_actions(v_run, v_stage, p_safe_only);
  INSERT INTO api.sample_workflow_events
    (workspace_id, run_id, record_id, from_stage_name, to_stage_name, automation, actor_user_id)
  VALUES (v_wf.workspace_id, v_run.id, p_record_id, NULL, v_stage.name, v_auto, api.current_user_id());
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.start_sample_workflow(uuid, uuid, boolean) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.enrol_sample_in_workflow(p_record_id uuid, p_workflow_id uuid) RETURNS api.sample_workflow_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_rec api.records;
  v_wf api.sample_workflows;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  SELECT * INTO v_rec FROM api.records WHERE id = p_record_id AND kind = 'sample' AND workspace_id = api.current_workspace_id();
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'sample not found in the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_wf FROM api.sample_workflows WHERE id = p_workflow_id AND workspace_id = v_rec.workspace_id;
  IF v_wf.id IS NULL OR v_wf.status <> 'active' THEN
    RAISE EXCEPTION 'workflow not found or archived' USING ERRCODE = 'SB022';
  END IF;
  IF v_wf.sample_type IS NOT NULL AND v_wf.sample_type IS DISTINCT FROM (v_rec.properties ->> 'sampleType') THEN
    RAISE EXCEPTION 'this workflow is for % samples', v_wf.sample_type USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.sample_workflow_runs WHERE record_id = p_record_id AND workflow_id = p_workflow_id AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'the sample is already in this workflow' USING ERRCODE = 'SB004';
  END IF;
  RETURN internal.start_sample_workflow(p_record_id, p_workflow_id, false);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.enrol_sample_in_workflow(uuid, uuid) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.advance_sample_workflow(p_run_id uuid, p_to_stage_id uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_run api.sample_workflow_runs;
  v_from api.sample_workflow_stages;
  v_to api.sample_workflow_stages;
  v_rec api.records;
  v_missing text[];
  v_auto jsonb;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  SELECT * INTO v_run FROM api.sample_workflow_runs
   WHERE id = p_run_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'workflow step not found in the active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF v_run.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'this sample has finished the workflow' USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_from FROM api.sample_workflow_stages WHERE id = v_run.stage_id;
  SELECT * INTO v_to FROM api.sample_workflow_stages WHERE id = p_to_stage_id;
  IF v_to.id IS NULL OR NOT EXISTS (
       SELECT 1 FROM api.sample_workflow_transitions t
        WHERE t.from_stage_id = v_from.id AND t.to_stage_id = v_to.id) THEN
    RAISE EXCEPTION 'a sample cannot move from % to that step', v_from.name USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_rec FROM api.records WHERE id = v_run.record_id;
  SELECT array_agg(f) INTO v_missing FROM unnest(v_to.required_fields) f
   WHERE coalesce(btrim(coalesce(v_rec.properties ->> f, v_rec.custom_fields ->> f)), '') = '';
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'fill in % before moving to %', array_to_string(v_missing, ', '), v_to.name
      USING ERRCODE = 'SB093';
  END IF;

  UPDATE api.sample_workflow_runs
     SET stage_id = v_to.id, entered_at = now(),
         due_at = CASE WHEN v_to.turnaround_days IS NULL OR v_to.is_final THEN NULL
                       ELSE now() + make_interval(days => v_to.turnaround_days) END,
         completed_at = CASE WHEN v_to.is_final THEN now() ELSE NULL END
   WHERE id = v_run.id
   RETURNING * INTO v_run;
  v_auto := internal.run_sample_workflow_actions(v_run, v_to, false);
  INSERT INTO api.sample_workflow_events
    (workspace_id, run_id, record_id, from_stage_name, to_stage_name, notes, automation, actor_user_id)
  VALUES (v_run.workspace_id, v_run.id, v_run.record_id, v_from.name, v_to.name,
          NULLIF(btrim(coalesce(p_notes, '')), ''), v_auto, api.current_user_id());
  RETURN jsonb_build_object('run', to_jsonb(v_run), 'automation', v_auto);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.advance_sample_workflow(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- Take a sample out of a workflow without finishing it.
CREATE FUNCTION api.leave_sample_workflow(p_run_id uuid, p_notes text DEFAULT NULL::text) RETURNS api.sample_workflow_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_run api.sample_workflow_runs;
  v_stage api.sample_workflow_stages;
BEGIN
  IF api.has_capability(api.current_workspace_id(), 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  SELECT * INTO v_run FROM api.sample_workflow_runs
   WHERE id = p_run_id AND workspace_id = api.current_workspace_id() AND completed_at IS NULL FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'workflow step not found in the active workspace' USING ERRCODE = 'SB022';
  END IF;
  SELECT * INTO v_stage FROM api.sample_workflow_stages WHERE id = v_run.stage_id;
  UPDATE api.sample_workflow_runs SET completed_at = now(), due_at = NULL WHERE id = v_run.id RETURNING * INTO v_run;
  INSERT INTO api.sample_workflow_events
    (workspace_id, run_id, record_id, from_stage_name, to_stage_name, notes, actor_user_id)
  VALUES (v_run.workspace_id, v_run.id, v_run.record_id, v_stage.name, NULL,
          coalesce(NULLIF(btrim(coalesce(p_notes, '')), ''), 'Taken out of the workflow'), api.current_user_id());
  RETURN v_run;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.leave_sample_workflow(uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- Save a whole workflow in one go. The definition is
-- {name, description, sampleType, autoEnrol, stages: [{key, id?, name, description,
--  turnaroundDays, final, requiredFields[], actions[], next[keys]}]}; the order of
-- stages is their order in the workflow. Stages that keep their id keep the samples
-- sitting in them; a stage that is dropped must be empty.
CREATE FUNCTION api.save_sample_workflow(p_workflow_id uuid, p_definition jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_id uuid := p_workflow_id;
  v_stage jsonb;
  v_action jsonb;
  v_pos int := 0;
  v_keys text[] := ARRAY[]::text[];
  v_ids uuid[] := ARRAY[]::uuid[];
  v_sid uuid;
  v_next text;
  v_idx int;
  v_name text;
  v_kept uuid[];
  v_count int;
BEGIN
  IF api.has_settings_access(v_ws, 'storage', 'manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs manage access to workflows' USING ERRCODE = '42501';
  END IF;
  v_name := btrim(coalesce(p_definition ->> 'name', ''));
  IF v_name = '' THEN RAISE EXCEPTION 'a workflow needs a name' USING ERRCODE = '22023'; END IF;
  v_count := coalesce(jsonb_array_length(p_definition -> 'stages'), 0);
  IF v_count < 2 OR v_count > 20 THEN
    RAISE EXCEPTION 'a workflow needs between 2 and 20 steps' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO api.sample_workflows (workspace_id, name, description, sample_type, auto_enrol, created_by_user_id)
    VALUES (v_ws, v_name, NULLIF(btrim(coalesce(p_definition ->> 'description', '')), ''),
            NULLIF(btrim(coalesce(p_definition ->> 'sampleType', '')), ''),
            coalesce((p_definition ->> 'autoEnrol')::boolean, false), api.current_user_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE api.sample_workflows
       SET name = v_name, description = NULLIF(btrim(coalesce(p_definition ->> 'description', '')), ''),
           sample_type = NULLIF(btrim(coalesce(p_definition ->> 'sampleType', '')), ''),
           auto_enrol = coalesce((p_definition ->> 'autoEnrol')::boolean, false), updated_at = now()
     WHERE id = v_id AND workspace_id = v_ws;
    IF NOT FOUND THEN RAISE EXCEPTION 'workflow not found' USING ERRCODE = 'SB022'; END IF;
  END IF;

  -- Stages: update those that keep an id, add new ones.
  FOR v_stage IN SELECT * FROM jsonb_array_elements(p_definition -> 'stages') LOOP
    IF btrim(coalesce(v_stage ->> 'name', '')) = '' THEN
      RAISE EXCEPTION 'every step needs a name' USING ERRCODE = '22023';
    END IF;
    FOR v_action IN SELECT * FROM jsonb_array_elements(coalesce(v_stage -> 'actions', '[]'::jsonb)) LOOP
      IF v_action ->> 'kind' NOT IN ('notify', 'set_field', 'quarantine', 'start_experiment') THEN
        RAISE EXCEPTION 'unknown automation %', v_action ->> 'kind' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    v_sid := NULLIF(v_stage ->> 'id', '')::uuid;
    IF v_sid IS NOT NULL AND EXISTS (SELECT 1 FROM api.sample_workflow_stages WHERE id = v_sid AND workflow_id = v_id) THEN
      UPDATE api.sample_workflow_stages
         SET position = v_pos, name = btrim(v_stage ->> 'name'),
             description = NULLIF(btrim(coalesce(v_stage ->> 'description', '')), ''),
             turnaround_days = NULLIF(v_stage ->> 'turnaroundDays', '')::int,
             is_final = coalesce((v_stage ->> 'final')::boolean, false),
             required_fields = coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(v_stage -> 'requiredFields', '[]'::jsonb))), '{}'),
             actions = coalesce(v_stage -> 'actions', '[]'::jsonb)
       WHERE id = v_sid;
    ELSE
      INSERT INTO api.sample_workflow_stages
        (workflow_id, workspace_id, position, name, description, turnaround_days, is_final, required_fields, actions)
      VALUES (v_id, v_ws, v_pos, btrim(v_stage ->> 'name'),
              NULLIF(btrim(coalesce(v_stage ->> 'description', '')), ''),
              NULLIF(v_stage ->> 'turnaroundDays', '')::int,
              coalesce((v_stage ->> 'final')::boolean, false),
              coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(v_stage -> 'requiredFields', '[]'::jsonb))), '{}'),
              coalesce(v_stage -> 'actions', '[]'::jsonb))
      RETURNING id INTO v_sid;
    END IF;
    v_keys := v_keys || coalesce(NULLIF(v_stage ->> 'key', ''), v_sid::text);
    v_ids := v_ids || v_sid;
    v_pos := v_pos + 1;
  END LOOP;

  -- Drop stages that are no longer there, unless a sample is in them.
  IF EXISTS (SELECT 1 FROM api.sample_workflow_runs r
              WHERE r.workflow_id = v_id AND r.completed_at IS NULL AND NOT (r.stage_id = ANY (v_ids))) THEN
    RAISE EXCEPTION 'move the samples out of a step before removing it' USING ERRCODE = 'SB004';
  END IF;
  DELETE FROM api.sample_workflow_stages s
   WHERE s.workflow_id = v_id AND NOT (s.id = ANY (v_ids))
     AND NOT EXISTS (SELECT 1 FROM api.sample_workflow_runs r WHERE r.stage_id = s.id);

  -- Where each step can go next.
  DELETE FROM api.sample_workflow_transitions WHERE workflow_id = v_id;
  v_pos := 0;
  FOR v_stage IN SELECT * FROM jsonb_array_elements(p_definition -> 'stages') LOOP
    FOR v_next IN SELECT jsonb_array_elements_text(coalesce(v_stage -> 'next', '[]'::jsonb)) LOOP
      v_idx := array_position(v_keys, v_next);
      IF v_idx IS NULL THEN
        RAISE EXCEPTION 'a step leads to one that does not exist' USING ERRCODE = '22023';
      END IF;
      IF v_ids[v_idx] <> v_ids[v_pos + 1] THEN
        INSERT INTO api.sample_workflow_transitions (workflow_id, workspace_id, from_stage_id, to_stage_id)
        VALUES (v_id, v_ws, v_ids[v_pos + 1], v_ids[v_idx]) ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
    v_pos := v_pos + 1;
  END LOOP;
  RETURN v_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_sample_workflow(uuid, jsonb) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.set_sample_workflow_status(p_workflow_id uuid, p_status text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
BEGIN
  IF api.has_settings_access(api.current_workspace_id(), 'storage', 'manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs manage access to workflows' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('active', 'archived') THEN RAISE EXCEPTION 'unknown status' USING ERRCODE = '22023'; END IF;
  UPDATE api.sample_workflows SET status = p_status, updated_at = now()
   WHERE id = p_workflow_id AND workspace_id = api.current_workspace_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'workflow not found' USING ERRCODE = 'SB022'; END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_sample_workflow_status(uuid, text) OWNER TO migrator;
--> statement-breakpoint

-- A new sample starts the first matching workflow that asks for it. It must never
-- stop a sample being created, so any problem here is swallowed.
CREATE FUNCTION internal.auto_enrol_sample() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
  v_wf uuid;
BEGIN
  IF NEW.kind <> 'sample' THEN RETURN NEW; END IF;
  BEGIN
    SELECT w.id INTO v_wf FROM api.sample_workflows w
     WHERE w.workspace_id = NEW.workspace_id AND w.status = 'active' AND w.auto_enrol
       AND (w.sample_type IS NULL OR w.sample_type = NEW.properties ->> 'sampleType')
     ORDER BY (w.sample_type IS NULL), w.created_at LIMIT 1;
    IF v_wf IS NOT NULL THEN
      PERFORM internal.start_sample_workflow(NEW.id, v_wf, true);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.auto_enrol_sample() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER trg_auto_enrol_sample AFTER INSERT ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.auto_enrol_sample();
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.enrol_sample_in_workflow(uuid, uuid), api.advance_sample_workflow(uuid, uuid, text), api.leave_sample_workflow(uuid, text), api.save_sample_workflow(uuid, jsonb), api.set_sample_workflow_status(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.enrol_sample_in_workflow(uuid, uuid), api.advance_sample_workflow(uuid, uuid, text), api.leave_sample_workflow(uuid, text), api.save_sample_workflow(uuid, jsonb), api.set_sample_workflow_status(uuid, text) TO authenticated;
