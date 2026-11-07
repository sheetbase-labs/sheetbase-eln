-- Robots, the lab scheduler and notebook code cells.
--
--   * Send a worklist to a robot. An instrument can be a robot (Opentrons over
--     its HTTP API, or any robot that reads a worklist file from a folder). A
--     job takes a worklist to it, waits for a person to start it, and reads the
--     robot's log back as the worklist's completed transfers, which withdraw the
--     samples drawn for the experiment.
--       api.instrument_robot_settings, api.instrument_jobs
--   * Plan the parts of a multi-part experiment onto instruments and people.
--     Each part can say how long it takes, which instruments it needs and how
--     long to wait before the next part; the planner proposes bookings that
--     respect working hours, absences, booking rules and other bookings.
--       api.scheduler_settings, api.part_plans, api.part_resource_needs,
--       api.schedule_proposals, api.schedule_proposal_bookings
--   * Code cells: a Python or SQL block bound to dataset versions. Every run is
--     kept with the code, the inputs it read, the image it ran in and a digest
--     of the output, and can be reproduced.
--       api.code_cell_runs, a code_cell block type, api.dataset_version_rows_json

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
  FOREACH v_type IN ARRAY ARRAY['instrument_job', 'schedule_proposal', 'code_cell_run'] LOOP
    IF position('''' || v_type || '''' IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_type || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint
INSERT INTO internal.webhook_event_names (name) VALUES
  ('instrument.job.queued'), ('instrument.job.staged'), ('instrument.job.started'),
  ('instrument.job.completed'), ('instrument.job.failed'), ('instrument.job.cancelled'),
  ('schedule.proposed'), ('schedule.accepted'), ('schedule.dismissed'),
  ('code_cell.run'), ('code_cell.reproduced')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- The code cell block type ------------------------------------------------------
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.blocks'::regclass AND conname = 'chk_blocks_type';
  IF v_def IS NULL OR position('::text])' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_blocks_type';
  END IF;
  IF position('''code_cell''' IN v_def) = 0 THEN
    v_def := replace(v_def, '::text])', '::text, ''code_cell''::text])');
    EXECUTE 'ALTER TABLE api.blocks DROP CONSTRAINT chk_blocks_type';
    EXECUTE 'ALTER TABLE api.blocks ADD CONSTRAINT chk_blocks_type ' || v_def;
  END IF;
END $$;
--> statement-breakpoint

-- ===========================================================================
-- Robots
-- ===========================================================================

-- An instrument that takes jobs: how Sheetbase talks to it, and the labware the
-- worklist file should name. The robot's address stays on the lab computer that
-- runs the folder agent; Sheetbase never reaches into the lab network.
CREATE TABLE api.instrument_robot_settings (
    instrument_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    driver text NOT NULL,
    worklist_format text NOT NULL,
    labware jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT instrument_robot_settings_pkey PRIMARY KEY (instrument_id),
    CONSTRAINT instrument_robot_settings_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT instrument_robot_settings_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_instrument_robot_settings_driver CHECK (driver IN ('opentrons', 'file')),
    CONSTRAINT chk_instrument_robot_settings_format CHECK (worklist_format IN ('csv', 'echo', 'tecan_gwl', 'hamilton', 'opentrons')),
    CONSTRAINT chk_instrument_robot_settings_labware CHECK (jsonb_typeof(labware) = 'object' AND pg_column_size(labware) <= 4096)
);
--> statement-breakpoint
ALTER TABLE api.instrument_robot_settings OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.instrument_robot_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_robot_settings_select ON api.instrument_robot_settings FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_robot_settings_client_select ON api.instrument_robot_settings FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_robot_settings TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_instrument_robot(
    p_instrument_id uuid, p_driver text, p_worklist_format text DEFAULT NULL,
    p_labware jsonb DEFAULT '{}'::jsonb)
RETURNS api.instrument_robot_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_format text;
  r api.instrument_robot_settings;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.has_capability(v_instrument.workspace_id, 'instrument.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs instrument.manage' USING ERRCODE = '42501';
  END IF;
  IF p_driver IS NULL OR p_driver NOT IN ('opentrons', 'file') THEN
    RAISE EXCEPTION 'choose how Sheetbase reaches this robot' USING ERRCODE = '22023';
  END IF;
  v_format := coalesce(nullif(btrim(p_worklist_format), ''), CASE p_driver WHEN 'opentrons' THEN 'opentrons' ELSE 'csv' END);
  IF p_driver = 'opentrons' AND v_format <> 'opentrons' THEN
    RAISE EXCEPTION 'an Opentrons robot runs an Opentrons protocol' USING ERRCODE = '22023';
  END IF;
  IF v_format NOT IN ('csv', 'echo', 'tecan_gwl', 'hamilton', 'opentrons') THEN
    RAISE EXCEPTION 'unknown worklist format' USING ERRCODE = '22023';
  END IF;
  IF p_labware IS NULL OR jsonb_typeof(p_labware) <> 'object' THEN
    RAISE EXCEPTION 'the labware must be an object' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.instrument_robot_settings
    (instrument_id, workspace_id, driver, worklist_format, labware, updated_by_user_id)
  VALUES (v_instrument.id, v_instrument.workspace_id, p_driver, v_format, p_labware, api.current_user_id())
  ON CONFLICT (instrument_id) DO UPDATE
     SET driver = EXCLUDED.driver, worklist_format = EXCLUDED.worklist_format,
         labware = EXCLUDED.labware, updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id
  RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_instrument_robot(uuid, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_instrument_robot(uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_instrument_robot(uuid, text, text, jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.clear_instrument_robot(p_instrument_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF api.has_capability(v_instrument.workspace_id, 'instrument.manage') IS NOT TRUE THEN
    RAISE EXCEPTION 'not permitted: needs instrument.manage' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM api.instrument_jobs
              WHERE instrument_id = p_instrument_id AND status IN ('queued', 'staged', 'starting', 'running')) THEN
    RAISE EXCEPTION 'this robot still has a job in progress' USING ERRCODE = 'SB004';
  END IF;
  DELETE FROM api.instrument_robot_settings WHERE instrument_id = p_instrument_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.clear_instrument_robot(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.clear_instrument_robot(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.clear_instrument_robot(uuid) TO authenticated;
--> statement-breakpoint

-- A worklist on its way to a robot. queued -> staged (the agent has put it on the
-- robot) -> starting (a person pressed Start) -> running -> complete. A person
-- always starts it; nothing runs on its own.
CREATE TABLE api.instrument_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    instrument_id uuid NOT NULL,
    worklist_id uuid NOT NULL,
    record_id uuid,
    driver text NOT NULL,
    worklist_format text NOT NULL,
    labware jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'queued' NOT NULL,
    cancel_requested boolean DEFAULT false NOT NULL,
    note text,
    -- The robot's own id for the run (an Opentrons run id).
    remote_ref text,
    -- [{at, status, message}] in the order they happened.
    log jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_message text,
    -- What reading the robot's log back recorded: counts per transfer status and the samples withdrawn.
    result jsonb,
    agent_seen_at timestamp with time zone,
    queued_by_user_id text NOT NULL,
    started_by_user_id text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT instrument_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT uq_instrument_jobs_number UNIQUE (workspace_id, number),
    CONSTRAINT instrument_jobs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT instrument_jobs_instrument_fk FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE CASCADE,
    CONSTRAINT instrument_jobs_worklist_fk FOREIGN KEY (worklist_id) REFERENCES api.plate_worklists(id) ON DELETE CASCADE,
    CONSTRAINT instrument_jobs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE SET NULL,
    CONSTRAINT instrument_jobs_queued_by_fk FOREIGN KEY (queued_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT instrument_jobs_started_by_fk FOREIGN KEY (started_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL,
    CONSTRAINT chk_instrument_jobs_status CHECK (status IN ('queued', 'staged', 'starting', 'running', 'complete', 'failed', 'cancelled')),
    CONSTRAINT chk_instrument_jobs_driver CHECK (driver IN ('opentrons', 'file')),
    CONSTRAINT chk_instrument_jobs_note CHECK (note IS NULL OR length(note) <= 500),
    CONSTRAINT chk_instrument_jobs_log CHECK (jsonb_typeof(log) = 'array' AND jsonb_array_length(log) <= 500)
);
--> statement-breakpoint
ALTER TABLE api.instrument_jobs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_instrument_jobs_instrument ON api.instrument_jobs (instrument_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_instrument_jobs_open ON api.instrument_jobs (instrument_id) WHERE status IN ('queued', 'staged', 'starting', 'running');
--> statement-breakpoint
CREATE INDEX idx_instrument_jobs_worklist ON api.instrument_jobs (worklist_id);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_instrument_jobs_one_open_per_worklist ON api.instrument_jobs (worklist_id)
    WHERE status IN ('queued', 'staged', 'starting', 'running');
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON api.instrument_jobs FOR EACH ROW EXECUTE FUNCTION internal.set_updated_at();
--> statement-breakpoint
ALTER TABLE api.instrument_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY instrument_jobs_select ON api.instrument_jobs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_jobs_client_select ON api.instrument_jobs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.instrument_jobs TO authenticated, api_client;
--> statement-breakpoint

-- Put a line in a job's log and, when the status changes, say so on the stream.
CREATE FUNCTION internal.instrument_job_note(p_job api.instrument_jobs, p_status text, p_message text)
RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT (CASE WHEN jsonb_array_length(p_job.log) >= 500 THEN p_job.log - 0 ELSE p_job.log END)
         || jsonb_build_array(jsonb_build_object('at', now(), 'status', p_status, 'message', left(coalesce(p_message, ''), 500)))
$$;
--> statement-breakpoint
ALTER FUNCTION internal.instrument_job_note(api.instrument_jobs, text, text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION internal.emit_instrument_job_event(p_job api.instrument_jobs, p_change text, p_operation text)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text;
BEGIN
  SELECT i.name INTO v_name FROM api.instruments i WHERE i.id = p_job.instrument_id;
  PERFORM internal.emit_change_event(p_job.workspace_id, 'instrument_job', p_job.id, p_operation, p_job.record_id, NULL,
    jsonb_build_object('change', p_change, 'jobId', p_job.id,
                       'reference', 'IJ-' || lpad(p_job.number::text, 4, '0'),
                       'instrumentId', p_job.instrument_id, 'instrument', v_name,
                       'worklistId', p_job.worklist_id, 'recordId', p_job.record_id,
                       'status', p_job.status, 'driver', p_job.driver,
                       'error', p_job.error_message, 'result', p_job.result));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_instrument_job_event(api.instrument_jobs, text, text) OWNER TO migrator;
--> statement-breakpoint

CREATE FUNCTION api.queue_instrument_job(p_instrument_id uuid, p_worklist_id uuid, p_note text DEFAULT NULL)
RETURNS api.instrument_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_instrument api.instruments;
  v_settings api.instrument_robot_settings;
  v_wl api.plate_worklists;
  v_job api.instrument_jobs;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_instrument FROM api.instruments WHERE id = p_instrument_id AND workspace_id = v_ws;
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settings FROM api.instrument_robot_settings WHERE instrument_id = p_instrument_id;
  IF v_settings.instrument_id IS NULL THEN
    RAISE EXCEPTION 'this instrument has not been set up as a robot' USING ERRCODE = 'SB004';
  END IF;
  IF v_instrument.retired_at IS NOT NULL OR v_instrument.out_of_service_at IS NOT NULL THEN
    RAISE EXCEPTION 'this robot is out of service' USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_wl FROM api.plate_worklists WHERE id = p_worklist_id AND workspace_id = v_ws;
  IF v_wl.id IS NULL THEN
    RAISE EXCEPTION 'worklist not found' USING ERRCODE = 'SB015';
  END IF;
  IF v_wl.status <> 'planned' THEN
    RAISE EXCEPTION 'this worklist is already %', v_wl.status USING ERRCODE = 'SB004';
  END IF;
  IF v_wl.record_id IS NOT NULL THEN
    PERFORM internal.assert_object_access('record', v_wl.record_id, 'edit');
  END IF;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'keep the note under 500 characters' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM api.instrument_jobs
              WHERE worklist_id = p_worklist_id AND status IN ('queued', 'staged', 'starting', 'running')) THEN
    RAISE EXCEPTION 'this worklist is already on its way to a robot' USING ERRCODE = 'SB004';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('instrument_jobs:' || v_ws::text, 0));
  INSERT INTO api.instrument_jobs
    (workspace_id, number, instrument_id, worklist_id, record_id, driver, worklist_format, labware, note, queued_by_user_id, log)
  VALUES
    (v_ws, (SELECT coalesce(max(number), 0) + 1 FROM api.instrument_jobs WHERE workspace_id = v_ws),
     p_instrument_id, p_worklist_id, v_wl.record_id, v_settings.driver, v_settings.worklist_format,
     v_settings.labware, nullif(btrim(coalesce(p_note, '')), ''), api.current_user_id(),
     jsonb_build_array(jsonb_build_object('at', now(), 'status', 'queued', 'message', 'Queued for ' || v_instrument.name)))
  RETURNING * INTO v_job;
  PERFORM internal.emit_instrument_job_event(v_job, 'queued', 'create');
  RETURN v_job;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.queue_instrument_job(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.queue_instrument_job(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.queue_instrument_job(uuid, uuid, text) TO authenticated;
--> statement-breakpoint

-- A person presses Start. Only a job the agent has put on the robot can be started.
CREATE FUNCTION api.start_instrument_job(p_job_id uuid) RETURNS api.instrument_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_job api.instrument_jobs;
BEGIN
  SELECT * INTO v_job FROM api.instrument_jobs
   WHERE id = p_job_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'SB015';
  END IF;
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_job.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_job.status <> 'staged' THEN
    IF v_job.status = 'queued' THEN
      RAISE EXCEPTION 'the robot has not received this job yet' USING ERRCODE = 'SB004';
    END IF;
    RAISE EXCEPTION 'this job is %', v_job.status USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.instrument_jobs
     SET status = 'starting', started_by_user_id = api.current_user_id(), started_at = now(),
         log = internal.instrument_job_note(v_job, 'starting', 'Started by a person')
   WHERE id = p_job_id RETURNING * INTO v_job;
  PERFORM internal.emit_instrument_job_event(v_job, 'started', 'update');
  RETURN v_job;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.start_instrument_job(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.start_instrument_job(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.start_instrument_job(uuid) TO authenticated;
--> statement-breakpoint

-- Stop a job. One that has not started is cancelled at once; one that is running
-- is asked to stop and the agent confirms when the robot has.
CREATE FUNCTION api.cancel_instrument_job(p_job_id uuid) RETURNS api.instrument_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_job api.instrument_jobs;
BEGIN
  SELECT * INTO v_job FROM api.instrument_jobs
   WHERE id = p_job_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'SB015';
  END IF;
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_job.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_job.status IN ('complete', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'this job is already %', v_job.status USING ERRCODE = 'SB004';
  END IF;
  IF v_job.status = 'queued' THEN
    UPDATE api.instrument_jobs
       SET status = 'cancelled', finished_at = now(),
           log = internal.instrument_job_note(v_job, 'cancelled', 'Cancelled before the robot received it')
     WHERE id = p_job_id RETURNING * INTO v_job;
    PERFORM internal.emit_instrument_job_event(v_job, 'cancelled', 'update');
  ELSE
    UPDATE api.instrument_jobs
       SET cancel_requested = true,
           log = internal.instrument_job_note(v_job, v_job.status, 'Stop requested')
     WHERE id = p_job_id RETURNING * INTO v_job;
  END IF;
  RETURN v_job;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.cancel_instrument_job(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.cancel_instrument_job(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.cancel_instrument_job(uuid) TO authenticated;
--> statement-breakpoint

-- What the lab computer should do for one robot: the jobs that are not finished,
-- with the worklist each carries.
CREATE FUNCTION api.agent_instrument_jobs(p_instrument_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.instruments WHERE id = p_instrument_id AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  UPDATE api.instrument_jobs SET agent_seen_at = now()
   WHERE instrument_id = p_instrument_id AND status IN ('queued', 'staged', 'starting', 'running');
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'id', j.id, 'number', j.number, 'status', j.status, 'driver', j.driver,
             'format', j.worklist_format, 'labware', j.labware, 'remoteRef', j.remote_ref,
             'cancelRequested', j.cancel_requested, 'recordId', j.record_id,
             'worklist', jsonb_build_object(
               'id', w.id, 'number', w.number, 'name', w.name, 'sourcePlate', w.source_plate,
               'sourceFormat', w.source_format, 'destPlate', w.dest_plate, 'destFormat', w.dest_format,
               'transfers', w.transfers, 'options', w.options))
           ORDER BY j.created_at)
      FROM api.instrument_jobs j
      JOIN api.plate_worklists w ON w.id = j.worklist_id
     WHERE j.instrument_id = p_instrument_id AND j.workspace_id = v_ws
       AND j.status IN ('queued', 'staged', 'starting', 'running')), '[]'::jsonb);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.agent_instrument_jobs(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.agent_instrument_jobs(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.agent_instrument_jobs(uuid) TO authenticated;
--> statement-breakpoint

-- The lab computer says where a job has got to. p_reconciled (the planned
-- transfers each with a status and the volume moved) comes with 'complete' and
-- completes the worklist, which withdraws the samples for the experiment.
CREATE FUNCTION api.agent_report_instrument_job(
    p_job_id uuid, p_status text, p_remote_ref text DEFAULT NULL,
    p_message text DEFAULT NULL, p_reconciled jsonb DEFAULT NULL)
RETURNS api.instrument_jobs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_job api.instrument_jobs;
  v_wl api.plate_worklists;
  v_change text;
  v_allowed boolean;
  v_result jsonb;
  v_counts jsonb;
BEGIN
  SELECT * INTO v_job FROM api.instrument_jobs
   WHERE id = p_job_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'job not found' USING ERRCODE = 'SB015';
  END IF;
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_job.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('staged', 'running', 'complete', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'unknown job status' USING ERRCODE = '22023';
  END IF;
  IF v_job.status IN ('complete', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'this job is already %', v_job.status USING ERRCODE = 'SB004';
  END IF;
  v_allowed := CASE p_status
    WHEN 'staged' THEN v_job.status IN ('queued', 'staged')
    WHEN 'running' THEN v_job.status IN ('staged', 'starting', 'running')
    WHEN 'complete' THEN v_job.status IN ('staged', 'starting', 'running')
    ELSE true END;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'a % job cannot become %', v_job.status, p_status USING ERRCODE = 'SB004';
  END IF;

  v_change := CASE p_status WHEN 'staged' THEN 'staged' WHEN 'running' THEN NULL ELSE p_status END;

  IF p_status = 'complete' THEN
    IF p_reconciled IS NULL OR jsonb_typeof(p_reconciled) <> 'array' THEN
      RAISE EXCEPTION 'completing a job needs the robot''s log, matched to the worklist' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_wl FROM api.plate_worklists WHERE id = v_job.worklist_id FOR UPDATE;
    IF v_wl.status = 'planned' THEN
      PERFORM set_config('sheetbase.job_completing', v_job.id::text, true);
      v_wl := api.complete_plate_worklist(v_wl.id, p_reconciled, v_job.record_id, v_job.record_id IS NOT NULL);
    END IF;
    SELECT jsonb_object_agg(s, n) INTO v_counts
      FROM (SELECT coalesce(t ->> 'status', 'unknown') AS s, count(*) AS n
              FROM jsonb_array_elements(p_reconciled) t GROUP BY 1) c;
    v_result := jsonb_build_object('transfers', jsonb_array_length(p_reconciled),
                                   'byStatus', coalesce(v_counts, '{}'::jsonb),
                                   'withdrawals', v_wl.withdrawals);
  END IF;

  UPDATE api.instrument_jobs
     SET status = p_status,
         remote_ref = coalesce(nullif(btrim(p_remote_ref), ''), remote_ref),
         error_message = CASE WHEN p_status = 'failed' THEN left(coalesce(p_message, 'The robot reported a problem'), 500) ELSE error_message END,
         result = coalesce(v_result, result),
         finished_at = CASE WHEN p_status IN ('complete', 'failed', 'cancelled') THEN now() ELSE finished_at END,
         started_at = CASE WHEN p_status = 'running' AND started_at IS NULL THEN now() ELSE started_at END,
         agent_seen_at = now(),
         log = internal.instrument_job_note(v_job, p_status, p_message)
   WHERE id = p_job_id RETURNING * INTO v_job;
  IF v_change IS NOT NULL THEN
    PERFORM internal.emit_instrument_job_event(v_job, CASE v_change WHEN 'complete' THEN 'completed' ELSE v_change END, 'update');
  END IF;
  RETURN v_job;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.agent_report_instrument_job(uuid, text, text, text, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.agent_report_instrument_job(uuid, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.agent_report_instrument_job(uuid, text, text, text, jsonb) TO authenticated;
--> statement-breakpoint

-- A worklist completed by hand (from a log a person uploads) closes the job that
-- was waiting on it, so the two never disagree.
CREATE FUNCTION internal.close_job_on_worklist_complete() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_job api.instrument_jobs;
BEGIN
  IF NEW.status = 'complete' AND OLD.status IS DISTINCT FROM 'complete'
     AND coalesce(current_setting('sheetbase.job_completing', true), '') = '' THEN
    FOR v_job IN SELECT * FROM api.instrument_jobs
                  WHERE worklist_id = NEW.id AND status IN ('queued', 'staged', 'starting', 'running') LOOP
      UPDATE api.instrument_jobs
         SET status = 'complete', finished_at = now(),
             log = internal.instrument_job_note(v_job, 'complete', 'Completed from the worklist'),
             result = jsonb_build_object('transfers', jsonb_array_length(NEW.transfers), 'byStatus', '{}'::jsonb,
                                         'withdrawals', NEW.withdrawals, 'manual', true)
       WHERE id = v_job.id RETURNING * INTO v_job;
      PERFORM internal.emit_instrument_job_event(v_job, 'completed', 'update');
    END LOOP;
  ELSIF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    FOR v_job IN SELECT * FROM api.instrument_jobs
                  WHERE worklist_id = NEW.id AND status IN ('queued', 'staged') LOOP
      UPDATE api.instrument_jobs
         SET status = 'cancelled', finished_at = now(),
             log = internal.instrument_job_note(v_job, 'cancelled', 'The worklist was cancelled')
       WHERE id = v_job.id RETURNING * INTO v_job;
      PERFORM internal.emit_instrument_job_event(v_job, 'cancelled', 'update');
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.close_job_on_worklist_complete() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER close_job_on_worklist_complete AFTER UPDATE OF status ON api.plate_worklists
    FOR EACH ROW EXECUTE FUNCTION internal.close_job_on_worklist_complete();
--> statement-breakpoint

-- ===========================================================================
-- Scheduler
-- ===========================================================================

-- When the lab works. One row per workspace; none means the defaults (Monday to
-- Friday, 09:00 to 17:00, UTC).
CREATE TABLE api.scheduler_settings (
    workspace_id uuid NOT NULL,
    timezone text DEFAULT 'UTC' NOT NULL,
    work_start_minute integer DEFAULT 540 NOT NULL,
    work_end_minute integer DEFAULT 1020 NOT NULL,
    -- ISO weekdays: 1 is Monday, 7 is Sunday.
    work_days integer[] DEFAULT ARRAY[1, 2, 3, 4, 5] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT scheduler_settings_pkey PRIMARY KEY (workspace_id),
    CONSTRAINT scheduler_settings_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_scheduler_settings_hours CHECK (work_start_minute BETWEEN 0 AND 1439 AND work_end_minute BETWEEN 1 AND 1440 AND work_end_minute > work_start_minute),
    CONSTRAINT chk_scheduler_settings_days CHECK (cardinality(work_days) BETWEEN 1 AND 7 AND work_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]),
    CONSTRAINT chk_scheduler_settings_timezone CHECK (length(timezone) BETWEEN 1 AND 64)
);
--> statement-breakpoint
ALTER TABLE api.scheduler_settings OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.scheduler_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY scheduler_settings_select ON api.scheduler_settings FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY scheduler_settings_client_select ON api.scheduler_settings FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.scheduler_settings TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_scheduler_settings(
    p_workspace_id uuid, p_timezone text, p_work_start_minute integer, p_work_end_minute integer, p_work_days integer[])
RETURNS api.scheduler_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.scheduler_settings;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'general settings access required' USING ERRCODE = 'SB060';
  END IF;
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'choose a time zone from the list' USING ERRCODE = '22023';
  END IF;
  IF p_work_start_minute IS NULL OR p_work_end_minute IS NULL OR p_work_start_minute < 0
     OR p_work_end_minute > 1440 OR p_work_end_minute <= p_work_start_minute THEN
    RAISE EXCEPTION 'working hours must end after they start' USING ERRCODE = '22023';
  END IF;
  IF p_work_days IS NULL OR cardinality(p_work_days) = 0 OR NOT (p_work_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]) THEN
    RAISE EXCEPTION 'choose at least one working day' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.scheduler_settings
    (workspace_id, timezone, work_start_minute, work_end_minute, work_days, updated_by_user_id)
  VALUES (p_workspace_id, p_timezone, p_work_start_minute, p_work_end_minute,
          (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(p_work_days) d), api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE
     SET timezone = EXCLUDED.timezone, work_start_minute = EXCLUDED.work_start_minute,
         work_end_minute = EXCLUDED.work_end_minute, work_days = EXCLUDED.work_days,
         updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id
  RETURNING * INTO r;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_scheduler_settings(uuid, text, integer, integer, integer[]) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_scheduler_settings(uuid, text, integer, integer, integer[]) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_scheduler_settings(uuid, text, integer, integer, integer[]) TO authenticated;
--> statement-breakpoint

-- What a part of an experiment needs: hands-on time for its assignee, the
-- instruments it occupies and how long to wait after it (an incubation) before
-- the next part can begin.
CREATE TABLE api.part_plans (
    part_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    hands_on_minutes integer DEFAULT 60 NOT NULL,
    wait_after_minutes integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by_user_id text,
    CONSTRAINT part_plans_pkey PRIMARY KEY (part_id),
    CONSTRAINT part_plans_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE,
    CONSTRAINT part_plans_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_part_plans_hands_on CHECK (hands_on_minutes BETWEEN 0 AND 1440),
    CONSTRAINT chk_part_plans_wait CHECK (wait_after_minutes BETWEEN 0 AND 525600)
);
--> statement-breakpoint
ALTER TABLE api.part_plans OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.part_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY part_plans_select ON api.part_plans FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY part_plans_client_select ON api.part_plans FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.part_plans TO authenticated, api_client;
--> statement-breakpoint

CREATE TABLE api.part_resource_needs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    part_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    minutes integer NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    CONSTRAINT part_resource_needs_pkey PRIMARY KEY (id),
    CONSTRAINT part_resource_needs_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE CASCADE,
    CONSTRAINT part_resource_needs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT part_resource_needs_resource_fk FOREIGN KEY (resource_id) REFERENCES api.calendar_resources(id) ON DELETE CASCADE,
    CONSTRAINT uq_part_resource_needs UNIQUE (part_id, resource_id),
    CONSTRAINT chk_part_resource_needs_minutes CHECK (minutes BETWEEN 5 AND 10080)
);
--> statement-breakpoint
ALTER TABLE api.part_resource_needs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_part_resource_needs_resource ON api.part_resource_needs (resource_id);
--> statement-breakpoint
ALTER TABLE api.part_resource_needs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY part_resource_needs_select ON api.part_resource_needs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY part_resource_needs_client_select ON api.part_resource_needs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
GRANT SELECT ON TABLE api.part_resource_needs TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.set_part_plan(
    p_part_id uuid, p_hands_on_minutes integer DEFAULT 60, p_wait_after_minutes integer DEFAULT 0,
    p_needs jsonb DEFAULT '[]'::jsonb)
RETURNS api.part_plans
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_need jsonb;
  v_pos integer := 0;
  r api.part_plans;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id AND workspace_id = api.current_workspace_id();
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', v_part.record_id, 'edit');
  IF NOT api.is_workspace_writer(v_part.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_hands_on_minutes, -1) NOT BETWEEN 0 AND 1440 THEN
    RAISE EXCEPTION 'hands-on time must be between 0 and 24 hours' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_wait_after_minutes, -1) NOT BETWEEN 0 AND 525600 THEN
    RAISE EXCEPTION 'the wait after a part must be between 0 minutes and a year' USING ERRCODE = '22023';
  END IF;
  IF p_needs IS NULL OR jsonb_typeof(p_needs) <> 'array' OR jsonb_array_length(p_needs) > 20 THEN
    RAISE EXCEPTION 'needs must be a list of up to 20 instruments' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.part_plans (part_id, workspace_id, hands_on_minutes, wait_after_minutes, updated_by_user_id)
  VALUES (v_part.id, v_part.workspace_id, p_hands_on_minutes, p_wait_after_minutes, api.current_user_id())
  ON CONFLICT (part_id) DO UPDATE
     SET hands_on_minutes = EXCLUDED.hands_on_minutes, wait_after_minutes = EXCLUDED.wait_after_minutes,
         updated_at = now(), updated_by_user_id = EXCLUDED.updated_by_user_id
  RETURNING * INTO r;
  DELETE FROM api.part_resource_needs WHERE part_id = v_part.id;
  FOR v_need IN SELECT * FROM jsonb_array_elements(p_needs) LOOP
    IF jsonb_typeof(v_need) <> 'object' OR nullif(v_need ->> 'resourceId', '') IS NULL
       OR coalesce((v_need ->> 'minutes')::integer, 0) NOT BETWEEN 5 AND 10080 THEN
      RAISE EXCEPTION 'each instrument needs a resourceId and between 5 minutes and a week' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM api.calendar_resources
                    WHERE id = (v_need ->> 'resourceId')::uuid AND workspace_id = v_part.workspace_id) THEN
      RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB015';
    END IF;
    INSERT INTO api.part_resource_needs (part_id, workspace_id, resource_id, minutes, "position")
    VALUES (v_part.id, v_part.workspace_id, (v_need ->> 'resourceId')::uuid, (v_need ->> 'minutes')::integer, v_pos)
    ON CONFLICT (part_id, resource_id) DO UPDATE SET minutes = EXCLUDED.minutes, "position" = EXCLUDED."position";
    v_pos := v_pos + 1;
  END LOOP;
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_part_plan(uuid, integer, integer, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_part_plan(uuid, integer, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_part_plan(uuid, integer, integer, jsonb) TO authenticated;
--> statement-breakpoint

-- A proposed schedule for one experiment. The planner (a worker on the server)
-- fills `items` and `conflicts`; nothing is booked until a person accepts it.
CREATE TABLE api.schedule_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    record_id uuid NOT NULL,
    status text DEFAULT 'requested' NOT NULL,
    -- 'plan' for a first plan, 'slip' when it was re-planned because a part ran late.
    reason text DEFAULT 'plan' NOT NULL,
    slipped_part_id uuid,
    -- The calendar day that day 0 of the experiment falls on.
    anchor_on date NOT NULL,
    -- [{partId, partNumber, title, kind: 'instrument'|'hands_on', resourceId, resourceName, assigneeUserId,
    --   startsAt, endsAt, minutes, plannedOn, conflicts: [{code, message}]}]
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    conflict_count integer DEFAULT 0 NOT NULL,
    error_message text,
    requested_by_user_id text NOT NULL,
    decided_by_user_id text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    planned_at timestamp with time zone,
    CONSTRAINT schedule_proposals_pkey PRIMARY KEY (id),
    CONSTRAINT uq_schedule_proposals_number UNIQUE (workspace_id, number),
    CONSTRAINT schedule_proposals_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT schedule_proposals_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT schedule_proposals_requested_by_fk FOREIGN KEY (requested_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_schedule_proposals_status CHECK (status IN ('requested', 'planning', 'proposed', 'accepted', 'dismissed', 'superseded', 'failed')),
    CONSTRAINT chk_schedule_proposals_reason CHECK (reason IN ('plan', 'slip')),
    CONSTRAINT chk_schedule_proposals_items CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 400)
);
--> statement-breakpoint
ALTER TABLE api.schedule_proposals OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_schedule_proposals_record ON api.schedule_proposals (record_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_schedule_proposals_waiting ON api.schedule_proposals (created_at) WHERE status = 'requested';
--> statement-breakpoint
ALTER TABLE api.schedule_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_proposals_select ON api.schedule_proposals FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY schedule_proposals_client_select ON api.schedule_proposals FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY schedule_proposals_live_read ON api.schedule_proposals AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('record'::text, record_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.schedule_proposals TO authenticated, api_client;
--> statement-breakpoint

-- Which bookings an accepted proposal made, so a later plan can replace them.
CREATE TABLE api.schedule_proposal_bookings (
    proposal_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    part_id uuid,
    booking_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    CONSTRAINT schedule_proposal_bookings_pkey PRIMARY KEY (proposal_id, booking_id),
    CONSTRAINT schedule_proposal_bookings_proposal_fk FOREIGN KEY (proposal_id) REFERENCES api.schedule_proposals(id) ON DELETE CASCADE,
    CONSTRAINT schedule_proposal_bookings_booking_fk FOREIGN KEY (booking_id) REFERENCES api.calendar_bookings(id) ON DELETE CASCADE,
    CONSTRAINT schedule_proposal_bookings_part_fk FOREIGN KEY (part_id) REFERENCES api.experiment_parts(id) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE api.schedule_proposal_bookings OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE api.schedule_proposal_bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY schedule_proposal_bookings_select ON api.schedule_proposal_bookings FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.schedule_proposal_bookings TO authenticated;
--> statement-breakpoint

CREATE FUNCTION internal.emit_schedule_event(p_row api.schedule_proposals, p_change text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.emit_change_event(p_row.workspace_id, 'schedule_proposal', p_row.id,
    CASE p_change WHEN 'proposed' THEN 'create' ELSE 'update' END, p_row.record_id, NULL,
    jsonb_build_object('change', p_change, 'proposalId', p_row.id,
                       'reference', 'SP-' || lpad(p_row.number::text, 4, '0'),
                       'recordId', p_row.record_id, 'reason', p_row.reason, 'status', p_row.status,
                       'items', jsonb_array_length(p_row.items), 'conflicts', p_row.conflict_count));
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.emit_schedule_event(api.schedule_proposals, text) OWNER TO migrator;
--> statement-breakpoint

-- Ask for a plan. The planner picks it up within seconds. One open request per
-- experiment: asking again while one waits returns it.
CREATE FUNCTION api.request_schedule_proposal(p_record_id uuid, p_reason text DEFAULT 'plan', p_slipped_part_id uuid DEFAULT NULL)
RETURNS api.schedule_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_rec api.records;
  v_row api.schedule_proposals;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rec FROM api.records
   WHERE id = p_record_id AND workspace_id = v_ws AND kind = 'experiment' AND deleted_at IS NULL;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'experiment not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  IF p_reason IS NULL OR p_reason NOT IN ('plan', 'slip') THEN
    RAISE EXCEPTION 'unknown reason' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.experiment_parts WHERE record_id = p_record_id AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'this experiment has no parts left to plan' USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_row FROM api.schedule_proposals
   WHERE record_id = p_record_id AND status IN ('requested', 'planning') ORDER BY created_at DESC LIMIT 1;
  IF v_row.id IS NOT NULL THEN RETURN v_row; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('schedule_proposals:' || v_ws::text, 0));
  INSERT INTO api.schedule_proposals
    (workspace_id, number, record_id, reason, slipped_part_id, anchor_on, requested_by_user_id)
  VALUES
    (v_ws, (SELECT coalesce(max(number), 0) + 1 FROM api.schedule_proposals WHERE workspace_id = v_ws),
     p_record_id, p_reason, p_slipped_part_id, v_rec.created_at::date, api.current_user_id())
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.request_schedule_proposal(uuid, text, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_schedule_proposal(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_schedule_proposal(uuid, text, uuid) TO authenticated;
--> statement-breakpoint

-- Server side: claim the oldest waiting request, and write the planner's answer.
CREATE FUNCTION internal.claim_schedule_proposal() RETURNS api.schedule_proposals
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.schedule_proposals;
BEGIN
  SELECT * INTO v_row FROM api.schedule_proposals WHERE status = 'requested'
   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_row.id IS NULL THEN RETURN NULL; END IF;
  UPDATE api.schedule_proposals SET status = 'planning' WHERE id = v_row.id RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.claim_schedule_proposal() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.claim_schedule_proposal() FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.fill_schedule_proposal(p_id uuid, p_anchor_on date, p_items jsonb, p_conflicts integer, p_error text)
RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.schedule_proposals;
  v_user text;
BEGIN
  SELECT * INTO v_row FROM api.schedule_proposals WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN; END IF;
  -- Emit as the person who asked, so the event carries who it was for.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', v_row.requested_by_user_id,
                                                              'workspace_id', v_row.workspace_id)::text, true);
  IF p_error IS NOT NULL THEN
    UPDATE api.schedule_proposals SET status = 'failed', error_message = left(p_error, 500), planned_at = now()
     WHERE id = p_id RETURNING * INTO v_row;
    RETURN;
  END IF;
  -- A newer plan replaces an older one nobody has decided on.
  UPDATE api.schedule_proposals SET status = 'superseded', decided_at = now()
   WHERE record_id = v_row.record_id AND status = 'proposed' AND id <> p_id;
  UPDATE api.schedule_proposals
     SET status = 'proposed', anchor_on = p_anchor_on, items = coalesce(p_items, '[]'::jsonb),
         conflict_count = coalesce(p_conflicts, 0), planned_at = now()
   WHERE id = p_id RETURNING * INTO v_row;
  PERFORM internal.emit_schedule_event(v_row, 'proposed');
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.fill_schedule_proposal(uuid, date, jsonb, integer, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.fill_schedule_proposal(uuid, date, jsonb, integer, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.dismiss_schedule_proposal(p_proposal_id uuid) RETURNS api.schedule_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.schedule_proposals;
BEGIN
  SELECT * INTO v_row FROM api.schedule_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', v_row.record_id, 'edit');
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_row.status NOT IN ('requested', 'planning', 'proposed', 'failed') THEN
    RAISE EXCEPTION 'this proposal is already %', v_row.status USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.schedule_proposals
     SET status = 'dismissed', decided_by_user_id = api.current_user_id(), decided_at = now()
   WHERE id = p_proposal_id RETURNING * INTO v_row;
  PERFORM internal.emit_schedule_event(v_row, 'dismissed');
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.dismiss_schedule_proposal(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dismiss_schedule_proposal(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.dismiss_schedule_proposal(uuid) TO authenticated;
--> statement-breakpoint

-- Accept: book each instrument slot (the booking rules still apply, and a slot the
-- database refuses is listed, not hidden), move each part to the day it landed on,
-- and cancel the bookings an earlier accepted plan made for the same parts.
CREATE FUNCTION api.accept_schedule_proposal(p_proposal_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.schedule_proposals;
  v_rec api.records;
  v_item jsonb;
  v_booking api.calendar_bookings;
  v_old record;
  v_booked jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_status text;
  v_day integer;
  v_part uuid;
BEGIN
  SELECT * INTO v_row FROM api.schedule_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', v_row.record_id, 'edit');
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'this proposal is %', v_row.status USING ERRCODE = 'SB004';
  END IF;
  SELECT * INTO v_rec FROM api.records WHERE id = v_row.record_id;

  -- Release what an earlier accepted plan booked for the parts this one covers.
  FOR v_old IN
    SELECT b.booking_id FROM api.schedule_proposal_bookings b
      JOIN api.schedule_proposals p ON p.id = b.proposal_id
     WHERE p.record_id = v_row.record_id AND p.status = 'accepted' AND p.id <> v_row.id
       AND b.part_id IN (SELECT (i ->> 'partId')::uuid FROM jsonb_array_elements(v_row.items) i)
  LOOP
    BEGIN
      PERFORM api.cancel_booking(v_old.booking_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_row.items) LOOP
    IF v_item ->> 'kind' = 'instrument' AND nullif(v_item ->> 'resourceId', '') IS NOT NULL
       AND nullif(v_item ->> 'startsAt', '') IS NOT NULL THEN
      BEGIN
        v_booking := api.create_booking(
          v_row.workspace_id, (v_item ->> 'resourceId')::uuid,
          left(coalesce(v_item ->> 'title', v_rec.identifier || ' · ' || (v_item ->> 'partTitle')), 200),
          (v_item ->> 'startsAt')::timestamptz, (v_item ->> 'endsAt')::timestamptz,
          'UTC', 'confirmed', false, NULL, NULL, NULL, NULL, v_row.record_id,
          CASE WHEN nullif(v_item ->> 'assigneeUserId', '') IS NULL THEN '[]'::jsonb
               ELSE jsonb_build_array(jsonb_build_object('userId', v_item ->> 'assigneeUserId', 'role', 'owner')) END,
          '[]'::jsonb);
        INSERT INTO api.schedule_proposal_bookings (proposal_id, workspace_id, part_id, booking_id, resource_id)
        VALUES (v_row.id, v_row.workspace_id, nullif(v_item ->> 'partId', '')::uuid, v_booking.id, v_booking.resource_id);
        v_booked := v_booked || jsonb_build_array(jsonb_build_object(
          'bookingId', v_booking.id, 'resourceId', v_booking.resource_id, 'partId', v_item ->> 'partId'));
      EXCEPTION WHEN OTHERS THEN
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'partId', v_item ->> 'partId', 'resourceId', v_item ->> 'resourceId',
          'resourceName', v_item ->> 'resourceName', 'reason', left(SQLERRM, 300)));
      END;
    END IF;
  END LOOP;

  -- Each part falls on the day the plan put it.
  FOR v_item IN SELECT DISTINCT ON (i ->> 'partId') i FROM jsonb_array_elements(v_row.items) i
                 ORDER BY i ->> 'partId', i ->> 'startsAt' LOOP
    v_part := nullif(v_item ->> 'partId', '')::uuid;
    IF v_part IS NOT NULL AND nullif(v_item ->> 'plannedOn', '') IS NOT NULL THEN
      v_day := greatest((v_item ->> 'plannedOn')::date - v_rec.created_at::date, 0);
      UPDATE api.experiment_parts SET day_offset = least(v_day, 3650)
       WHERE id = v_part AND record_id = v_row.record_id AND completed_at IS NULL AND day_offset <> least(v_day, 3650);
    END IF;
  END LOOP;

  UPDATE api.schedule_proposals
     SET status = 'accepted', decided_by_user_id = api.current_user_id(), decided_at = now()
   WHERE id = p_proposal_id RETURNING * INTO v_row;
  PERFORM internal.emit_schedule_event(v_row, 'accepted');
  RETURN jsonb_build_object('proposalId', v_row.id, 'booked', v_booked, 'skipped', v_skipped);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.accept_schedule_proposal(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.accept_schedule_proposal(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.accept_schedule_proposal(uuid) TO authenticated;
--> statement-breakpoint

-- A part is running late: push it and every part after it back by some days and ask
-- for a new plan. Bookings made earlier stay until the new plan is accepted.
CREATE FUNCTION api.slip_experiment_part(p_part_id uuid, p_days integer) RETURNS api.schedule_proposals
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_part api.experiment_parts;
  v_row api.schedule_proposals;
BEGIN
  SELECT * INTO v_part FROM api.experiment_parts WHERE id = p_part_id AND workspace_id = api.current_workspace_id();
  IF v_part.id IS NULL THEN
    RAISE EXCEPTION 'part not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', v_part.record_id, 'edit');
  IF api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_part.workspace_id) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_days, 0) NOT BETWEEN 1 AND 365 THEN
    RAISE EXCEPTION 'a part can slip by between 1 and 365 days' USING ERRCODE = '22023';
  END IF;
  IF v_part.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'this part is already done' USING ERRCODE = 'SB004';
  END IF;
  UPDATE api.experiment_parts p SET day_offset = least(p.day_offset + p_days, 3650)
   WHERE p.record_id = v_part.record_id AND p.completed_at IS NULL
     AND (p."position", p.id) >= (v_part."position", v_part.id);
  RETURN api.request_schedule_proposal(v_part.record_id, 'slip', v_part.id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.slip_experiment_part(uuid, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.slip_experiment_part(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.slip_experiment_part(uuid, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- Code cells
-- ===========================================================================

-- The rows of a dataset version as a list of objects keyed by field, for code to
-- read. A flagged value is left out, as it is for pipelines.
CREATE FUNCTION api.dataset_version_rows_json(p_version_id uuid, p_limit integer DEFAULT 50000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.dataset_versions;
  v_total bigint;
  v_rows jsonb;
  v_columns jsonb;
BEGIN
  SELECT * INTO v_version FROM api.dataset_versions
   WHERE id = p_version_id AND workspace_id = api.current_workspace_id();
  IF v_version.id IS NULL OR NOT api.is_workspace_member(v_version.workspace_id) THEN
    RAISE EXCEPTION 'dataset version not found' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('dataset', v_version.dataset_id, 'view');
  IF coalesce(p_limit, 0) NOT BETWEEN 1 AND 100000 THEN
    RAISE EXCEPTION 'ask for between 1 and 100000 rows' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_total FROM api.dataset_version_rows WHERE dataset_version_id = p_version_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label, 'type', f.logical_type)
                            ORDER BY f.display_order, f.key), '[]'::jsonb)
    INTO v_columns
    FROM api.dataset_schema_version_fields f
   WHERE f.schema_version_id = v_version.schema_version_id AND f.lifecycle = 'active';
  SELECT coalesce(jsonb_agg(row_doc ORDER BY row_id), '[]'::jsonb) INTO v_rows FROM (
    SELECT r.row_id,
           coalesce(jsonb_object_agg(f.key,
             CASE f.logical_type
               WHEN 'text' THEN to_jsonb(v.text_value)
               WHEN 'integer' THEN to_jsonb(v.integer_value)
               WHEN 'decimal' THEN to_jsonb(v.numeric_value)
               WHEN 'boolean' THEN to_jsonb(v.boolean_value)
               WHEN 'date' THEN to_jsonb(v.date_value)
               WHEN 'timestamp' THEN to_jsonb(v.timestamp_value)
               WHEN 'category' THEN to_jsonb(v.category_option_id)
               ELSE to_jsonb(v.reference_id) END
           ) FILTER (WHERE f.key IS NOT NULL), '{}'::jsonb) AS row_doc
      FROM (SELECT row_id FROM api.dataset_version_rows
             WHERE dataset_version_id = p_version_id ORDER BY row_id LIMIT p_limit) r
      LEFT JOIN api.dataset_version_values v
        ON v.dataset_version_id = p_version_id AND v.row_id = r.row_id
       AND NOT EXISTS (SELECT 1 FROM api.dataset_version_flags fl
                        WHERE fl.dataset_version_id = v.dataset_version_id
                          AND fl.row_id = v.row_id AND fl.field_id = v.field_id)
      LEFT JOIN api.dataset_schema_version_fields f
        ON f.schema_version_id = v_version.schema_version_id AND f.field_id = v.field_id AND f.lifecycle = 'active'
     GROUP BY r.row_id
  ) q;
  RETURN jsonb_build_object('versionId', v_version.id, 'datasetId', v_version.dataset_id,
                            'label', v_version.label, 'columns', v_columns,
                            'rowCount', v_total, 'truncated', v_total > p_limit, 'rows', v_rows);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.dataset_version_rows_json(uuid, integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.dataset_version_rows_json(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.dataset_version_rows_json(uuid, integer) TO authenticated, api_client;
--> statement-breakpoint

-- Every run of a code cell, kept with everything needed to run it again.
CREATE TABLE api.code_cell_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    number integer NOT NULL,
    block_id uuid,
    record_id uuid NOT NULL,
    language text NOT NULL,
    source text NOT NULL,
    source_sha256 text NOT NULL,
    -- [{alias, datasetId, datasetVersionId, label, rowCount, digest}]
    inputs jsonb DEFAULT '[]'::jsonb NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text NOT NULL,
    -- {columns: [{name, type}], rows: [first rows], rowCount, truncated}
    output jsonb,
    output_digest text,
    -- The image the code ran in, pinned by digest (Python), or 'postgres-sandbox' for SQL.
    runtime text,
    environment jsonb,
    logs jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_message text,
    duration_ms integer,
    -- Set on a reproduction: the run it re-ran, and whether the output came out the same.
    reproduces_run_id uuid,
    matches boolean,
    diff jsonb,
    ran_by_user_id text NOT NULL,
    ran_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_cell_runs_pkey PRIMARY KEY (id),
    CONSTRAINT uq_code_cell_runs_number UNIQUE (workspace_id, number),
    CONSTRAINT code_cell_runs_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT code_cell_runs_block_fk FOREIGN KEY (block_id) REFERENCES api.blocks(id) ON DELETE SET NULL,
    CONSTRAINT code_cell_runs_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT code_cell_runs_reproduces_fk FOREIGN KEY (reproduces_run_id) REFERENCES api.code_cell_runs(id) ON DELETE SET NULL,
    CONSTRAINT code_cell_runs_user_fk FOREIGN KEY (ran_by_user_id) REFERENCES internal."user"(id) ON DELETE CASCADE,
    CONSTRAINT chk_code_cell_runs_language CHECK (language IN ('python', 'sql')),
    CONSTRAINT chk_code_cell_runs_status CHECK (status IN ('succeeded', 'failed')),
    CONSTRAINT chk_code_cell_runs_source CHECK (length(source) BETWEEN 1 AND 40000),
    CONSTRAINT chk_code_cell_runs_digest CHECK (source_sha256 ~ '^[0-9a-f]{64}$' AND (output_digest IS NULL OR output_digest ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
ALTER TABLE api.code_cell_runs OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_code_cell_runs_block ON api.code_cell_runs (block_id, ran_at DESC);
--> statement-breakpoint
CREATE INDEX idx_code_cell_runs_record ON api.code_cell_runs (record_id, ran_at DESC);
--> statement-breakpoint
ALTER TABLE api.code_cell_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY code_cell_runs_select ON api.code_cell_runs FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY code_cell_runs_client_select ON api.code_cell_runs FOR SELECT TO api_client
    USING (workspace_id = api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY code_cell_runs_live_read ON api.code_cell_runs AS RESTRICTIVE FOR SELECT TO authenticated, api_client
    USING (internal.can_access_object('record'::text, record_id, 'view'::text));
--> statement-breakpoint
GRANT SELECT ON TABLE api.code_cell_runs TO authenticated, api_client;
--> statement-breakpoint

CREATE FUNCTION api.record_code_cell_run(
    p_record_id uuid, p_block_id uuid, p_language text, p_source text, p_source_sha256 text,
    p_inputs jsonb, p_parameters jsonb, p_status text, p_output jsonb, p_output_digest text,
    p_runtime text, p_environment jsonb, p_logs jsonb, p_error text, p_duration_ms integer,
    p_reproduces_run_id uuid DEFAULT NULL, p_matches boolean DEFAULT NULL, p_diff jsonb DEFAULT NULL)
RETURNS api.code_cell_runs
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_ws uuid := api.current_workspace_id();
  v_rec api.records;
  v_block api.blocks;
  v_orig api.code_cell_runs;
  r api.code_cell_runs;
BEGIN
  IF v_ws IS NULL OR api.current_user_id() IS NULL OR NOT api.is_workspace_writer(v_ws) THEN
    RAISE EXCEPTION 'not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_rec FROM api.records WHERE id = p_record_id AND workspace_id = v_ws AND deleted_at IS NULL;
  IF v_rec.id IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = 'SB015';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  IF p_block_id IS NOT NULL THEN
    SELECT * INTO v_block FROM api.blocks WHERE id = p_block_id AND record_id = p_record_id;
    IF v_block.id IS NULL OR v_block.type <> 'code_cell' THEN
      RAISE EXCEPTION 'code cell not found on this record' USING ERRCODE = 'SB015';
    END IF;
  END IF;
  IF p_reproduces_run_id IS NOT NULL THEN
    SELECT * INTO v_orig FROM api.code_cell_runs WHERE id = p_reproduces_run_id AND workspace_id = v_ws;
    IF v_orig.id IS NULL THEN
      RAISE EXCEPTION 'run not found' USING ERRCODE = 'SB015';
    END IF;
  END IF;
  IF p_language IS NULL OR p_language NOT IN ('python', 'sql') THEN
    RAISE EXCEPTION 'code cells run Python or SQL' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('code_cell_runs:' || v_ws::text, 0));
  INSERT INTO api.code_cell_runs
    (workspace_id, number, block_id, record_id, language, source, source_sha256, inputs, parameters, status,
     output, output_digest, runtime, environment, logs, error_message, duration_ms,
     reproduces_run_id, matches, diff, ran_by_user_id)
  VALUES
    (v_ws, (SELECT coalesce(max(number), 0) + 1 FROM api.code_cell_runs WHERE workspace_id = v_ws),
     p_block_id, p_record_id, p_language, p_source, p_source_sha256, coalesce(p_inputs, '[]'::jsonb),
     coalesce(p_parameters, '{}'::jsonb), p_status, p_output, p_output_digest, p_runtime, p_environment,
     coalesce(p_logs, '[]'::jsonb), left(p_error, 2000), p_duration_ms, p_reproduces_run_id, p_matches, p_diff,
     api.current_user_id())
  RETURNING * INTO r;
  PERFORM internal.emit_change_event(r.workspace_id, 'code_cell_run', r.id,
    CASE WHEN r.reproduces_run_id IS NULL THEN 'create' ELSE 'update' END, r.record_id, NULL,
    jsonb_build_object('change', CASE WHEN r.reproduces_run_id IS NULL THEN 'run' ELSE 'reproduced' END,
                       'runId', r.id, 'reference', 'CC-' || lpad(r.number::text, 4, '0'),
                       'recordId', r.record_id, 'blockId', r.block_id, 'language', r.language,
                       'status', r.status, 'matches', r.matches, 'reproducesRunId', r.reproduces_run_id,
                       'runtime', r.runtime));
  RETURN r;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_code_cell_run(uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text, jsonb, jsonb, text, integer, uuid, boolean, jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_code_cell_run(uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text, jsonb, jsonb, text, integer, uuid, boolean, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_code_cell_run(uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb, text, text, jsonb, jsonb, text, integer, uuid, boolean, jsonb) TO authenticated;
--> statement-breakpoint

-- Search reads a code cell's code and the names of what it reads.
CREATE OR REPLACE FUNCTION internal.block_search_text(p_type text, p_payload jsonb, p_record_id uuid DEFAULT NULL)
    RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_p jsonb := coalesce(p_payload, '{}'::jsonb);
  v_text text := '';
  v_id uuid;
  v_ref text;
BEGIN
  CASE p_type
    WHEN 'rich_text' THEN
      v_text := internal.rich_text_plain(v_p -> 'doc');

    WHEN 'checklist' THEN
      v_text := internal.jsonb_path_text(v_p, '$.items[*].text');

    WHEN 'callout' THEN
      v_text := coalesce(v_p ->> 'text', '');

    WHEN 'conclusion' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'basis',
        replace(coalesce(v_p ->> 'verdict', ''), '_', ' '));

    WHEN 'metric' THEN
      v_text := concat_ws(' ', v_p ->> 'label', v_p ->> 'value', v_p ->> 'unit',
        v_p ->> 'provenance');

    WHEN 'table' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.columns[*]'),
        internal.jsonb_path_text(v_p, '$.rows[*][*]'));

    WHEN 'procedure_step' THEN
      v_text := concat_ws(' ', v_p ->> 'text', v_p ->> 'note');

    WHEN 'signature_request' THEN
      v_text := concat_ws(' ', v_p ->> 'requestedUserName',
        replace(coalesce(v_p ->> 'meaning', ''), '-', ' '), v_p ->> 'note');

    WHEN 'corrective_actions' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].action'),
        internal.jsonb_path_text(v_p, '$.items[*].ownerName'),
        replace(internal.jsonb_path_text(v_p, '$.items[*].status'), '-', ' '));

    WHEN 'materials' THEN
      v_text := concat_ws(' ',
        internal.jsonb_path_text(v_p, '$.items[*].identifier'),
        internal.jsonb_path_text(v_p, '$.items[*].title'),
        internal.jsonb_path_text(v_p, '$.items[*].note'),
        internal.jsonb_path_text(v_p, '$.items[*].unit.symbol'));

    WHEN 'linked_record' THEN
      v_text := concat_ws(' ', v_p ->> 'targetIdentifier', v_p ->> 'label',
        replace(coalesce(v_p ->> 'linkType', ''), '_', ' '), v_p ->> 'targetKind');
      v_id := internal.search_uuid(v_p ->> 'targetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', r.identifier, r.title) INTO v_ref
          FROM api.records r
         WHERE r.id = v_id AND r.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, r.project_id);
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'protocol_reference' THEN
      v_text := concat_ws(' ', v_p ->> 'protocolIdentifier', v_p ->> 'protocolTitle',
        v_p ->> 'version', replace(coalesce(v_p ->> 'approvalStatus', ''), '_', ' '));

    WHEN 'file' THEN
      v_text := concat_ws(' ', v_p ->> 'displayName', v_p ->> 'fileIdentifier',
        v_p ->> 'mediaType');
      v_id := internal.search_uuid(v_p ->> 'fileRecordId');
      IF v_id IS NOT NULL THEN
        -- What is written inside the attached file, so a notebook is found by
        -- the report it attaches. Only the version the block shows (its
        -- fileVersion, else the newest), capped, and only from a file in the
        -- notebook's own project.
        SELECT left(fo.extracted_text, 100000) INTO v_ref
          FROM api.file_objects fo
          JOIN api.records fr ON fr.id = fo.record_id
         WHERE fo.record_id = v_id AND fo.deleted_at IS NULL
           AND internal.search_scope_ok(p_record_id, fr.project_id)
         ORDER BY (fo.version = internal.search_int(v_p ->> 'fileVersion')) DESC NULLS LAST,
                  fo.version DESC
         LIMIT 1;
        v_text := concat_ws(' ', v_text, v_ref);
      END IF;

    WHEN 'sheet' THEN
      v_id := internal.search_uuid(v_p ->> 'instanceId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', si.display_id, si.name,
                 internal.jsonb_path_text(si.state, '$.localFields[*].label'))
          INTO v_text
          FROM api.sheet_instances si
         WHERE si.id = v_id AND si.lifecycle IN ('active', 'archived')
           AND internal.search_scope_ok(p_record_id, si.project_id);
      END IF;

    WHEN 'chart' THEN
      v_text := concat_ws(' ', v_p ->> 'title',
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.label'),
        internal.jsonb_path_text(v_p, '$.spec.display.axes.*.unit'),
        internal.jsonb_path_text(v_p, '$.spec.display.series[*].label'),
        internal.jsonb_path_text(v_p, '$.spec.display.annotations[*].label'),
        v_p #>> '{spec,display,caption}');
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.datasets[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT f.label, ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.spec.fields.*.fieldId') x
        JOIN api.dataset_schema_version_fields f ON f.field_id = internal.search_uuid(x #>> '{}');

    WHEN 'analysis' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        v_p #>> '{frozen,definitionName}',
        internal.jsonb_path_text(v_p, '$.frozen.columns[*].label'));
      SELECT concat_ws(' ', v_text, string_agg(DISTINCT concat_ws(' ', d.display_id, d.name), ' '))
        INTO v_text
        FROM jsonb_path_query(v_p, '$.frozen.datasetProvenance[*].datasetId') x
        JOIN api.datasets d ON d.id = internal.search_uuid(x #>> '{}')
       WHERE internal.search_scope_ok(p_record_id, d.primary_project_id);
      v_id := internal.search_uuid(v_p ->> 'definitionId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, ad.name) INTO v_text
          FROM api.analysis_definitions ad WHERE ad.id = v_id;
      END IF;

    WHEN 'plate_map' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'provenance',
        internal.jsonb_path_text(v_p, '$.spec.wells[*].wellCode'),
        replace(internal.jsonb_path_text(v_p, '$.spec.wells[*].role'), '_', ' '),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.identifier'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].sampleRef.title'),
        internal.jsonb_path_text(v_p, '$.spec.wells[*].notes'));

    WHEN 'pipeline_output' THEN
      v_text := coalesce(v_p ->> 'label', '');
      v_id := internal.search_uuid(v_p ->> 'runId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, pd.display_id, pd.name) INTO v_text
          FROM api.pipeline_runs pr
          JOIN api.pipeline_definition_versions pv ON pv.id = pr.definition_version_id
          JOIN api.pipeline_definitions pd ON pd.id = pv.definition_id
         WHERE pr.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'dataset_import' THEN
      v_text := coalesce(v_p ->> 'sheetName', '');
      v_id := internal.search_uuid(v_p ->> 'fileId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, f.filename) INTO v_text
          FROM api.dataset_import_files f WHERE f.id = v_id;
      END IF;
      v_id := internal.search_uuid(v_p ->> 'datasetId');
      IF v_id IS NOT NULL THEN
        SELECT concat_ws(' ', v_text, d.display_id, d.name) INTO v_text
          FROM api.datasets d
         WHERE d.id = v_id AND internal.search_scope_ok(p_record_id, d.primary_project_id);
      END IF;

    WHEN 'structure' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'name',
        v_p ->> 'formula', v_p ->> 'smiles');

    WHEN 'reaction' THEN
      v_text := concat_ws(' ', v_p ->> 'title', v_p ->> 'caption', v_p ->> 'smiles',
        internal.jsonb_path_text(v_p, '$.rows[*].name'),
        internal.jsonb_path_text(v_p, '$.rows[*].formula'),
        internal.jsonb_path_text(v_p, '$.rows[*].note'));

    WHEN 'code_cell' THEN
      -- The code and the names of what it reads; never the output rows.
      v_text := concat_ws(' ', v_p ->> 'source',
        internal.jsonb_path_text(v_p, '$.inputs[*].alias'),
        internal.jsonb_path_text(v_p, '$.inputs[*].label'));

    ELSE
      -- A type this migration has no rule for: the payload's string values,
      -- which never include keys.
      v_text := internal.extract_jsonb_text(v_p);
  END CASE;
  RETURN btrim(coalesce(v_text, ''));
END;
$$;

--> statement-breakpoint

-- A pipeline can send a worklist to a robot and ask for a schedule. The
-- database's copy of the action catalogue (checked when a pipeline is saved)
-- gains both actions.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"queue_instrument_job","rpc":"queue_instrument_job","label":"Send worklist to instrument","description":"Queue a planned worklist for a robot. The agent puts it on the robot and a person presses Start in Sheetbase.","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_worklist_id","type":"uuid","required":true,"nullable":false},{"name":"p_note","type":"text","required":false,"nullable":true}]},{"operation":"request_schedule_proposal","rpc":"request_schedule_proposal","label":"Request a schedule","description":"Ask the scheduler to propose bookings for the parts of an experiment. Nothing is booked until a person accepts the proposal.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":true},{"name":"p_slipped_part_id","type":"uuid","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
