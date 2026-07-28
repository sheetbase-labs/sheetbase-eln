-- OPS-006: Instrument Run Monitor

CREATE TABLE "api"."instruments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "workspace_id" uuid NOT NULL,
  "name" text NOT NULL, "instrument_type" text NOT NULL DEFAULT 'qpcr', "model" text,
  "serial_number" text, "vendor" text, "connection_status" text NOT NULL DEFAULT 'disconnected',
  "last_connected_at" timestamptz, "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "position" integer NOT NULL DEFAULT 0, "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(), "created_by_user_id" text, "updated_by_user_id" text,
  FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  CONSTRAINT chk_instruments_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT chk_instruments_type CHECK (instrument_type IN ('qpcr','sequencer','spectrophotometer','other')),
  CONSTRAINT chk_instruments_connection CHECK (connection_status IN ('connected','disconnected','error')),
  CONSTRAINT chk_instruments_position CHECK (position >= 0)
);
--> statement-breakpoint
CREATE INDEX idx_instruments_workspace ON api.instruments(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instruments_workspace_position ON api.instruments(workspace_id, position);
--> statement-breakpoint

CREATE TABLE api.instrument_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, instrument_id uuid NOT NULL,
  project_id uuid, name text NOT NULL, run_identifier text NOT NULL, protocol_name text,
  status text NOT NULL DEFAULT 'queued', progress_percent integer NOT NULL DEFAULT 0,
  plate_format text NOT NULL DEFAULT '96', started_at timestamptz, completed_at timestamptz,
  estimated_duration_seconds integer, elapsed_seconds integer, operator text, error_message text,
  metadata_version integer NOT NULL DEFAULT 1, queue_position integer NOT NULL DEFAULT 0,
  tags text[] NOT NULL DEFAULT '{}'::text[], created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), created_by_user_id text, updated_by_user_id text,
  FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY (instrument_id) REFERENCES api.instruments(id) ON DELETE cascade,
  FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE set null,
  FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  UNIQUE(workspace_id, run_identifier),
  CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CHECK (status IN ('queued','running','completed','failed','cancelled')),
  CHECK (progress_percent BETWEEN 0 AND 100), CHECK (plate_format IN ('6','24','48','96','384')),
  CHECK (metadata_version > 0), CHECK (queue_position >= 0)
);
--> statement-breakpoint
CREATE INDEX idx_instrument_runs_workspace ON api.instrument_runs(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_runs_instrument ON api.instrument_runs(instrument_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_runs_workspace_status ON api.instrument_runs(workspace_id,status);
--> statement-breakpoint
CREATE INDEX idx_instrument_runs_workspace_queue ON api.instrument_runs(workspace_id,queue_position);
--> statement-breakpoint

CREATE TABLE api.instrument_run_stages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 name text NOT NULL, stage_type text NOT NULL DEFAULT 'cycling', position integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending', cycle_count integer, current_cycle integer NOT NULL DEFAULT 0,
 target_temperature numeric(6,2), started_at timestamptz, completed_at timestamptz, duration_seconds integer,
 config jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 CHECK(length(btrim(name)) BETWEEN 1 AND 200), CHECK(stage_type IN ('hold','cycling','melt','image','custom')),
 CHECK(position >= 0), CHECK(status IN ('pending','running','completed','skipped','failed')),
 CHECK(cycle_count IS NULL OR cycle_count > 0), CHECK(current_cycle >= 0)
);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_stages_workspace ON api.instrument_run_stages(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_stages_run ON api.instrument_run_stages(run_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_stages_run_position ON api.instrument_run_stages(run_id,position);
--> statement-breakpoint

CREATE TABLE api.instrument_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, stage_id uuid,
 source_id text NOT NULL, observation_type text NOT NULL, source_timestamp timestamptz NOT NULL,
 ingestion_status text NOT NULL DEFAULT 'received', payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 error_detail text, ingested_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 FOREIGN KEY(stage_id) REFERENCES api.instrument_run_stages(id) ON DELETE set null,
 UNIQUE(run_id,source_id),
 CHECK(observation_type IN ('telemetry','stage_start','stage_complete','run_start','run_complete','run_fail','plate_snapshot','qc_result','status_change','heartbeat')),
 CHECK(ingestion_status IN ('received','processed','failed','duplicate'))
);
--> statement-breakpoint
CREATE INDEX idx_instrument_observations_workspace ON api.instrument_observations(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_observations_run ON api.instrument_observations(run_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_observations_run_timestamp ON api.instrument_observations(run_id,source_timestamp);
--> statement-breakpoint
CREATE INDEX idx_instrument_observations_run_type ON api.instrument_observations(run_id,observation_type);
--> statement-breakpoint
CREATE INDEX idx_instrument_observations_ingestion ON api.instrument_observations(ingestion_status);
--> statement-breakpoint

CREATE TABLE api.instrument_plate_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, observation_id uuid,
 plate_format text NOT NULL DEFAULT '96', wells jsonb NOT NULL DEFAULT '{}'::jsonb, captured_at timestamptz NOT NULL,
 cycle_number integer, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 FOREIGN KEY(observation_id) REFERENCES api.instrument_observations(id) ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX idx_instrument_plate_snapshots_workspace ON api.instrument_plate_snapshots(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_plate_snapshots_run ON api.instrument_plate_snapshots(run_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_plate_snapshots_run_captured ON api.instrument_plate_snapshots(run_id,captured_at);
--> statement-breakpoint

CREATE TABLE api.instrument_qc_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 check_name text NOT NULL, check_type text NOT NULL DEFAULT 'info', message text, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 checked_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 CHECK(length(btrim(check_name)) BETWEEN 1 AND 200), CHECK(check_type IN ('pass','warning','fail','info'))
);
--> statement-breakpoint
CREATE INDEX idx_instrument_qc_checks_workspace ON api.instrument_qc_checks(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_qc_checks_run ON api.instrument_qc_checks(run_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_qc_checks_run_type ON api.instrument_qc_checks(run_id,check_type);
--> statement-breakpoint

CREATE TABLE api.instrument_raw_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, file_id uuid,
 filename text NOT NULL, media_type text, size_bytes bigint, storage_key text, checksum text,
 ingestion_status text NOT NULL DEFAULT 'pending', error_detail text, received_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 FOREIGN KEY(file_id) REFERENCES api.file_objects(id) ON DELETE set null,
 CHECK(length(btrim(filename)) BETWEEN 1 AND 500), CHECK(ingestion_status IN ('pending','complete','partial','failed'))
);
--> statement-breakpoint
CREATE INDEX idx_instrument_raw_files_workspace ON api.instrument_raw_files(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_raw_files_run ON api.instrument_raw_files(run_id);
--> statement-breakpoint

CREATE TABLE api.instrument_run_links (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, run_id uuid NOT NULL, linked_record_id uuid,
 linked_record_identifier text, linked_record_title text, link_type text NOT NULL DEFAULT 'experiment',
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
 FOREIGN KEY(run_id) REFERENCES api.instrument_runs(id) ON DELETE cascade,
 FOREIGN KEY(linked_record_id) REFERENCES api.records(id) ON DELETE set null,
 CHECK(link_type IN ('experiment','sample','protocol','file'))
);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_links_workspace ON api.instrument_run_links(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_links_run ON api.instrument_run_links(run_id);
--> statement-breakpoint
CREATE INDEX idx_instrument_run_links_record ON api.instrument_run_links(linked_record_id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON api.instruments TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.instruments TO api_client;
--> statement-breakpoint
GRANT SELECT ON api.instrument_runs, api.instrument_run_stages, api.instrument_observations, api.instrument_plate_snapshots, api.instrument_qc_checks, api.instrument_raw_files, api.instrument_run_links TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.instrument_runs, api.instrument_run_stages, api.instrument_observations, api.instrument_plate_snapshots, api.instrument_qc_checks, api.instrument_raw_files, api.instrument_run_links TO api_client;
--> statement-breakpoint

ALTER TABLE api.instruments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_run_stages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_observations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_plate_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_qc_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_raw_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.instrument_run_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY instruments_select ON api.instruments FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instruments_client_select ON api.instruments FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instruments_write ON api.instruments FOR ALL TO authenticated USING (api.storage_member_using(workspace_id)) WITH CHECK (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_runs_select ON api.instrument_runs FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_runs_client_select ON api.instrument_runs FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_run_stages_select ON api.instrument_run_stages FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_run_stages_client_select ON api.instrument_run_stages FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_observations_select ON api.instrument_observations FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_observations_client_select ON api.instrument_observations FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_plate_snapshots_select ON api.instrument_plate_snapshots FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_plate_snapshots_client_select ON api.instrument_plate_snapshots FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_qc_checks_select ON api.instrument_qc_checks FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_qc_checks_client_select ON api.instrument_qc_checks FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_raw_files_select ON api.instrument_raw_files FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_raw_files_client_select ON api.instrument_raw_files FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY instrument_run_links_select ON api.instrument_run_links FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY instrument_run_links_client_select ON api.instrument_run_links FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_instrument(p_workspace_id uuid,p_name text,p_instrument_type text DEFAULT 'qpcr',p_model text DEFAULT NULL,p_serial_number text DEFAULT NULL,p_vendor text DEFAULT NULL,p_config jsonb DEFAULT '{}'::jsonb,p_position integer DEFAULT 0) RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments;
BEGIN
 IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid instrument name' USING ERRCODE='SB034'; END IF;
 IF p_instrument_type NOT IN ('qpcr','sequencer','spectrophotometer','other') THEN RAISE EXCEPTION 'invalid instrument type' USING ERRCODE='SB035'; END IF;
 INSERT INTO api.instruments(workspace_id,name,instrument_type,model,serial_number,vendor,config,position,created_by_user_id,updated_by_user_id) VALUES(p_workspace_id,btrim(p_name),p_instrument_type,p_model,p_serial_number,p_vendor,COALESCE(p_config,'{}'),p_position,api.current_user_id(),api.current_user_id()) RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,jsonb,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_instrument(uuid,text,text,text,text,text,jsonb,integer) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_instrument_connection(p_workspace_id uuid,p_instrument_id uuid,p_connection_status text,p_last_connected_at timestamptz DEFAULT NULL) RETURNS api.instruments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instruments;
BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF;
 IF p_connection_status NOT IN ('connected','disconnected','error') THEN RAISE EXCEPTION 'invalid connection status' USING ERRCODE='SB035'; END IF;
 UPDATE api.instruments SET connection_status=p_connection_status,last_connected_at=p_last_connected_at,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_instrument_id AND workspace_id=p_workspace_id RETURNING * INTO v;
 IF v IS NULL THEN RAISE EXCEPTION 'instrument not found' USING ERRCODE='SB036'; END IF; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_instrument_connection(uuid,uuid,text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_instrument_connection(uuid,uuid,text,timestamptz) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_instrument_run(p_workspace_id uuid,p_name text,p_run_identifier text,p_instrument_id uuid,p_protocol_name text DEFAULT NULL,p_project_id uuid DEFAULT NULL,p_plate_format text DEFAULT '96',p_operator text DEFAULT NULL,p_estimated_duration_seconds integer DEFAULT NULL,p_tags text[] DEFAULT '{}'::text[],p_stages jsonb DEFAULT '[]'::jsonb) RETURNS api.instrument_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instrument_runs; s jsonb; pos integer:=0;
BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR btrim(COALESCE(p_run_identifier,''))='' THEN RAISE EXCEPTION 'invalid run name or identifier' USING ERRCODE='SB034'; END IF;
 IF NOT EXISTS(SELECT 1 FROM api.instruments WHERE id=p_instrument_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'instrument not found' USING ERRCODE='SB036'; END IF;
 IF EXISTS(SELECT 1 FROM api.instrument_runs WHERE workspace_id=p_workspace_id AND run_identifier=p_run_identifier) THEN RAISE EXCEPTION 'run identifier exists' USING ERRCODE='SB037'; END IF;
 IF p_plate_format NOT IN ('6','24','48','96','384') THEN RAISE EXCEPTION 'invalid plate format' USING ERRCODE='SB038'; END IF;
 INSERT INTO api.instrument_runs(workspace_id,instrument_id,project_id,name,run_identifier,protocol_name,plate_format,operator,estimated_duration_seconds,tags,queue_position,created_by_user_id,updated_by_user_id)
 VALUES(p_workspace_id,p_instrument_id,p_project_id,btrim(p_name),p_run_identifier,p_protocol_name,p_plate_format,p_operator,p_estimated_duration_seconds,COALESCE(p_tags,'{}'),COALESCE((SELECT max(queue_position)+1 FROM api.instrument_runs WHERE workspace_id=p_workspace_id AND status='queued'),0),api.current_user_id(),api.current_user_id()) RETURNING * INTO v;
 IF jsonb_typeof(p_stages) <> 'array' THEN RAISE EXCEPTION 'stages must be an array' USING ERRCODE='SB034'; END IF;
 FOR s IN SELECT * FROM jsonb_array_elements(p_stages) LOOP
  INSERT INTO api.instrument_run_stages(workspace_id,run_id,name,stage_type,position,cycle_count,target_temperature,duration_seconds,config) VALUES(p_workspace_id,v.id,s->>'name',COALESCE(s->>'stageType','cycling'),pos,(s->>'cycleCount')::integer,(s->>'targetTemperature')::numeric,(s->>'durationSeconds')::integer,COALESCE(s->'config','{}')); pos:=pos+1;
 END LOOP; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_instrument_run(uuid,text,text,uuid,text,uuid,text,text,integer,text[],jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_instrument_run(uuid,text,text,uuid,text,uuid,text,text,integer,text[],jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.ingest_observation(p_workspace_id uuid,p_run_id uuid,p_source_id text,p_observation_type text,p_source_timestamp timestamptz,p_payload jsonb DEFAULT '{}'::jsonb,p_stage_id uuid DEFAULT NULL) RETURNS api.instrument_observations LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.instrument_observations;
  v_existing api.instrument_observations;
BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF;
 IF NOT EXISTS(SELECT 1 FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF;
 SELECT * INTO v_existing FROM api.instrument_observations WHERE run_id=p_run_id AND source_id=p_source_id;
 IF v_existing.id IS NOT NULL THEN v_existing.ingestion_status:='duplicate'; RETURN v_existing; END IF;
 IF p_observation_type NOT IN ('telemetry','stage_start','stage_complete','run_start','run_complete','run_fail','plate_snapshot','qc_result','status_change','heartbeat') THEN RAISE EXCEPTION 'invalid observation type' USING ERRCODE='SB040'; END IF;
 IF p_stage_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.instrument_run_stages WHERE id=p_stage_id AND run_id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'stage not found' USING ERRCODE='SB041'; END IF;
 INSERT INTO api.instrument_observations(workspace_id,run_id,stage_id,source_id,observation_type,source_timestamp,payload) VALUES(p_workspace_id,p_run_id,p_stage_id,p_source_id,p_observation_type,p_source_timestamp,COALESCE(p_payload,'{}')) RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.ingest_observation(uuid,uuid,text,text,timestamptz,jsonb,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.ingest_observation(uuid,uuid,text,text,timestamptz,jsonb,uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.start_instrument_run(p_workspace_id uuid,p_run_id uuid) RETURNS api.instrument_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_runs; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; SELECT * INTO v FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE; IF v IS NULL THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF v.status<>'queued' THEN RAISE EXCEPTION 'run is not queued' USING ERRCODE='SB042'; END IF; UPDATE api.instrument_runs SET status='running',started_at=now(),updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_run_id RETURNING * INTO v; INSERT INTO api.instrument_observations(workspace_id,run_id,source_id,observation_type,source_timestamp) VALUES(p_workspace_id,p_run_id,'system-run-start-'||v.id,'run_start',now()); RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.start_instrument_run(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.start_instrument_run(uuid,uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.complete_instrument_run(p_workspace_id uuid,p_run_id uuid) RETURNS api.instrument_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_runs; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; SELECT * INTO v FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE; IF v IS NULL THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF v.status<>'running' THEN RAISE EXCEPTION 'run is not running' USING ERRCODE='SB042'; END IF; UPDATE api.instrument_runs SET status='completed',completed_at=now(),progress_percent=100,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_run_id RETURNING * INTO v; INSERT INTO api.instrument_observations(workspace_id,run_id,source_id,observation_type,source_timestamp) VALUES(p_workspace_id,p_run_id,'system-run-complete-'||v.id,'run_complete',now()); RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.complete_instrument_run(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.complete_instrument_run(uuid,uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.fail_instrument_run(p_workspace_id uuid,p_run_id uuid,p_error_message text DEFAULT NULL) RETURNS api.instrument_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_runs; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; SELECT * INTO v FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id FOR UPDATE; IF v IS NULL THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF v.status NOT IN ('running','queued') THEN RAISE EXCEPTION 'run cannot be failed' USING ERRCODE='SB042'; END IF; UPDATE api.instrument_runs SET status='failed',completed_at=now(),error_message=p_error_message,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_run_id RETURNING * INTO v; INSERT INTO api.instrument_observations(workspace_id,run_id,source_id,observation_type,source_timestamp,payload) VALUES(p_workspace_id,p_run_id,'system-run-fail-'||v.id,'run_fail',now(),jsonb_build_object('errorMessage',p_error_message)); RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.fail_instrument_run(uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.fail_instrument_run(uuid,uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_plate_snapshot(p_workspace_id uuid,p_run_id uuid,p_wells jsonb,p_plate_format text DEFAULT '96',p_cycle_number integer DEFAULT NULL,p_captured_at timestamptz DEFAULT NULL,p_observation_id uuid DEFAULT NULL) RETURNS api.instrument_plate_snapshots LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_plate_snapshots; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; IF NOT EXISTS(SELECT 1 FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; INSERT INTO api.instrument_plate_snapshots(workspace_id,run_id,observation_id,plate_format,wells,captured_at,cycle_number) VALUES(p_workspace_id,p_run_id,p_observation_id,p_plate_format,COALESCE(p_wells,'{}'),COALESCE(p_captured_at,now()),p_cycle_number) RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_plate_snapshot(uuid,uuid,jsonb,text,integer,timestamptz,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_plate_snapshot(uuid,uuid,jsonb,text,integer,timestamptz,uuid) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.record_qc_check(p_workspace_id uuid,p_run_id uuid,p_check_name text,p_check_type text DEFAULT 'info',p_message text DEFAULT NULL,p_detail jsonb DEFAULT '{}'::jsonb) RETURNS api.instrument_qc_checks LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_qc_checks; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; IF NOT EXISTS(SELECT 1 FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF p_check_type NOT IN ('pass','warning','fail','info') OR p_check_name IS NULL OR length(btrim(p_check_name)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid QC check' USING ERRCODE='SB043'; END IF; INSERT INTO api.instrument_qc_checks(workspace_id,run_id,check_name,check_type,message,detail) VALUES(p_workspace_id,p_run_id,btrim(p_check_name),p_check_type,p_message,COALESCE(p_detail,'{}')) RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.record_qc_check(uuid,uuid,text,text,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.record_qc_check(uuid,uuid,text,text,text,jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.register_raw_file(p_workspace_id uuid,p_run_id uuid,p_filename text,p_media_type text DEFAULT NULL,p_size_bytes bigint DEFAULT NULL,p_storage_key text DEFAULT NULL,p_checksum text DEFAULT NULL,p_file_id uuid DEFAULT NULL,p_ingestion_status text DEFAULT 'pending',p_error_detail text DEFAULT NULL) RETURNS api.instrument_raw_files LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_raw_files; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; IF NOT EXISTS(SELECT 1 FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF p_ingestion_status NOT IN ('pending','complete','partial','failed') OR p_filename IS NULL OR length(btrim(p_filename)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid raw file' USING ERRCODE='SB043'; END IF; INSERT INTO api.instrument_raw_files(workspace_id,run_id,file_id,filename,media_type,size_bytes,storage_key,checksum,ingestion_status,error_detail) VALUES(p_workspace_id,p_run_id,p_file_id,btrim(p_filename),p_media_type,p_size_bytes,p_storage_key,p_checksum,p_ingestion_status,p_error_detail) RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.register_raw_file(uuid,uuid,text,text,bigint,text,text,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.register_raw_file(uuid,uuid,text,text,bigint,text,text,uuid,text,text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.link_run_record(p_workspace_id uuid,p_run_id uuid,p_linked_record_id uuid,p_link_type text DEFAULT 'experiment') RETURNS api.instrument_run_links LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_run_links; r api.records; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; IF NOT EXISTS(SELECT 1 FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF p_link_type NOT IN ('experiment','sample','protocol','file') THEN RAISE EXCEPTION 'invalid link type' USING ERRCODE='SB043'; END IF; SELECT * INTO r FROM api.records WHERE id=p_linked_record_id AND workspace_id=p_workspace_id; IF r IS NULL THEN RAISE EXCEPTION 'record not found' USING ERRCODE='SB043'; END IF; INSERT INTO api.instrument_run_links(workspace_id,run_id,linked_record_id,linked_record_identifier,linked_record_title,link_type) VALUES(p_workspace_id,p_run_id,r.id,r.identifier,r.title,p_link_type) RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.link_run_record(uuid,uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.link_run_record(uuid,uuid,uuid,text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.update_run_progress(p_workspace_id uuid,p_run_id uuid,p_progress_percent integer,p_elapsed_seconds integer DEFAULT NULL) RETURNS api.instrument_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v api.instrument_runs; BEGIN IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF; SELECT * INTO v FROM api.instrument_runs WHERE id=p_run_id AND workspace_id=p_workspace_id; IF v IS NULL THEN RAISE EXCEPTION 'run not found' USING ERRCODE='SB039'; END IF; IF v.status<>'running' THEN RAISE EXCEPTION 'run is not running' USING ERRCODE='SB042'; END IF; UPDATE api.instrument_runs SET progress_percent=LEAST(GREATEST(p_progress_percent,0),100),elapsed_seconds=p_elapsed_seconds,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE id=p_run_id RETURNING * INTO v; RETURN v; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_run_progress(uuid,uuid,integer,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_run_progress(uuid,uuid,integer,integer) TO authenticated;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.trg_change_event_instrument() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE v_entity text; v_op text; v_payload jsonb; BEGIN v_entity:=TG_ARGV[0]; CASE TG_OP WHEN 'INSERT' THEN v_op:='create';v_payload:=to_jsonb(NEW)-'metadata'; WHEN 'UPDATE' THEN v_op:='update';v_payload:=to_jsonb(NEW)-'metadata'; WHEN 'DELETE' THEN v_op:='delete';v_payload:=to_jsonb(OLD)-'metadata'; END CASE; PERFORM internal.emit_change_event(COALESCE(NEW.workspace_id,OLD.workspace_id),v_entity,COALESCE(NEW.id,OLD.id),v_op,NULL,NULL,v_payload); RETURN NULL; END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_instrument() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_instruments AFTER INSERT OR UPDATE OR DELETE ON api.instruments FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_runs AFTER INSERT OR UPDATE OR DELETE ON api.instrument_runs FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_run');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_run_stages AFTER INSERT OR UPDATE OR DELETE ON api.instrument_run_stages FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_run_stage');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_observations AFTER INSERT ON api.instrument_observations FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_observation');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_plate_snapshots AFTER INSERT OR UPDATE OR DELETE ON api.instrument_plate_snapshots FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_plate_snapshot');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_qc_checks AFTER INSERT OR UPDATE OR DELETE ON api.instrument_qc_checks FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_qc_check');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_raw_files AFTER INSERT OR UPDATE OR DELETE ON api.instrument_raw_files FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_raw_file');
--> statement-breakpoint
CREATE TRIGGER change_event_instrument_run_links AFTER INSERT OR UPDATE OR DELETE ON api.instrument_run_links FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_instrument('instrument_run_link');
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
