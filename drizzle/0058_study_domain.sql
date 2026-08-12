-- STUDY-001: first-class Study identity and audited planner ownership.

ALTER TABLE api.records DROP CONSTRAINT chk_records_kind;
ALTER TABLE api.records ADD CONSTRAINT chk_records_kind CHECK(kind IN (
  'experiment','protocol_template','report','sample','reagent','file',
  'notebook_template','study'
));
CREATE UNIQUE INDEX uq_records_workspace_study_identifier
  ON api.records(workspace_id,identifier) WHERE kind='study';
--> statement-breakpoint

CREATE TABLE api.studies (
  record_id uuid PRIMARY KEY REFERENCES api.records(id) ON DELETE cascade,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  summary text,
  starts_on date,
  ends_on date,
  plan_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  updated_by_user_id text REFERENCES internal."user"(id) ON DELETE set null,
  CONSTRAINT chk_studies_date_range CHECK(ends_on IS NULL OR starts_on IS NULL OR ends_on>=starts_on),
  CONSTRAINT chk_studies_plan_version CHECK(plan_version>0)
);
CREATE INDEX idx_studies_workspace ON api.studies(workspace_id);

CREATE TABLE api.study_projects (
  study_record_id uuid NOT NULL REFERENCES api.studies(record_id) ON DELETE cascade,
  project_id uuid NOT NULL REFERENCES api.projects(id) ON DELETE cascade,
  relationship text NOT NULL DEFAULT 'participating',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  PRIMARY KEY(study_record_id,project_id),
  CONSTRAINT chk_study_projects_relationship CHECK(relationship IN ('home','participating'))
);
CREATE INDEX idx_study_projects_project ON api.study_projects(project_id);
CREATE UNIQUE INDEX uq_study_projects_home ON api.study_projects(study_record_id) WHERE relationship='home';

CREATE TABLE api.study_experiments (
  study_record_id uuid NOT NULL REFERENCES api.studies(record_id) ON DELETE cascade,
  experiment_record_id uuid NOT NULL REFERENCES api.records(id) ON DELETE restrict,
  relationship text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  PRIMARY KEY(study_record_id,experiment_record_id),
  CONSTRAINT chk_study_experiments_relationship CHECK(relationship IN ('member','primary','control'))
);
CREATE INDEX idx_study_experiments_experiment ON api.study_experiments(experiment_record_id);

CREATE TABLE api.study_plan_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_record_id uuid NOT NULL REFERENCES api.studies(record_id) ON DELETE restrict,
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  plan_version integer NOT NULL,
  snapshot jsonb NOT NULL,
  checksum text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  CONSTRAINT uq_study_plan_snapshots_version UNIQUE(study_record_id,plan_version),
  CONSTRAINT chk_study_plan_snapshots_version CHECK(plan_version>0),
  CONSTRAINT chk_study_plan_snapshots_checksum CHECK(checksum~'^[0-9a-f]{64}$')
);
CREATE INDEX idx_study_plan_snapshots_workspace ON api.study_plan_snapshots(workspace_id);

ALTER TABLE api.study_workstreams ADD COLUMN study_record_id uuid
  REFERENCES api.studies(record_id) ON DELETE set null;
ALTER TABLE api.study_tasks ADD COLUMN study_record_id uuid
  REFERENCES api.studies(record_id) ON DELETE set null;
CREATE INDEX idx_study_workstreams_study ON api.study_workstreams(study_record_id);
CREATE INDEX idx_study_tasks_study ON api.study_tasks(study_record_id);
--> statement-breakpoint

CREATE FUNCTION internal.guard_study_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE study_record api.records; related_record api.records; project_workspace uuid;
BEGIN
  IF TG_TABLE_NAME='studies' THEN
    SELECT * INTO study_record FROM api.records WHERE id=NEW.record_id;
    IF study_record.id IS NULL OR study_record.kind<>'study' OR study_record.workspace_id<>NEW.workspace_id THEN
      RAISE EXCEPTION 'invalid Study identity' USING ERRCODE='SB073';
    END IF;
  ELSIF TG_TABLE_NAME='study_projects' THEN
    SELECT r.* INTO study_record FROM api.records r JOIN api.studies s ON s.record_id=r.id WHERE s.record_id=NEW.study_record_id;
    SELECT workspace_id INTO project_workspace FROM api.projects WHERE id=NEW.project_id;
    IF study_record.id IS NULL OR project_workspace IS DISTINCT FROM study_record.workspace_id THEN
      RAISE EXCEPTION 'Study and Project must share a workspace' USING ERRCODE='SB073';
    END IF;
  ELSIF TG_TABLE_NAME='study_experiments' THEN
    SELECT r.* INTO study_record FROM api.records r JOIN api.studies s ON s.record_id=r.id WHERE s.record_id=NEW.study_record_id;
    SELECT * INTO related_record FROM api.records WHERE id=NEW.experiment_record_id;
    IF study_record.id IS NULL OR related_record.id IS NULL OR related_record.kind<>'experiment'
       OR related_record.workspace_id<>study_record.workspace_id THEN
      RAISE EXCEPTION 'Study membership requires an Experiment in the same workspace' USING ERRCODE='SB073';
    END IF;
  ELSE
    SELECT r.* INTO study_record FROM api.records r JOIN api.studies s ON s.record_id=r.id WHERE s.record_id=NEW.study_record_id;
    IF NEW.study_record_id IS NOT NULL AND (study_record.id IS NULL OR study_record.workspace_id<>NEW.workspace_id) THEN
      RAISE EXCEPTION 'planner item and Study must share a workspace' USING ERRCODE='SB073';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER study_identity_guard BEFORE INSERT OR UPDATE ON api.studies
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_identity();
CREATE TRIGGER study_project_identity_guard BEFORE INSERT OR UPDATE ON api.study_projects
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_identity();
CREATE TRIGGER study_experiment_identity_guard BEFORE INSERT OR UPDATE ON api.study_experiments
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_identity();
CREATE TRIGGER study_workstream_identity_guard BEFORE INSERT OR UPDATE OF workspace_id,study_record_id ON api.study_workstreams
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_identity();
CREATE TRIGGER study_task_identity_guard BEFORE INSERT OR UPDATE OF workspace_id,study_record_id ON api.study_tasks
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_identity();

CREATE FUNCTION internal.guard_study_plan_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Study plan snapshots are immutable' USING ERRCODE='SB072'; END IF;
  IF jsonb_typeof(NEW.snapshot)<>'object' THEN RAISE EXCEPTION 'Study plan snapshot must be an object' USING ERRCODE='SB073'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER study_plan_snapshot_immutable BEFORE INSERT OR UPDATE OR DELETE ON api.study_plan_snapshots
  FOR EACH ROW EXECUTE FUNCTION internal.guard_study_plan_snapshot();
--> statement-breakpoint

ALTER TABLE api.studies ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.study_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.study_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.study_plan_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY studies_read ON api.studies FOR SELECT TO authenticated
  USING(api.is_workspace_member(workspace_id));
CREATE POLICY study_projects_read ON api.study_projects FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM api.studies s WHERE s.record_id=study_record_id AND api.is_workspace_member(s.workspace_id)));
CREATE POLICY study_experiments_read ON api.study_experiments FOR SELECT TO authenticated
  USING(EXISTS(SELECT 1 FROM api.studies s WHERE s.record_id=study_record_id AND api.is_workspace_member(s.workspace_id)));
CREATE POLICY study_plan_snapshots_read ON api.study_plan_snapshots FOR SELECT TO authenticated
  USING(api.is_workspace_member(workspace_id));
CREATE POLICY studies_api_read ON api.studies FOR SELECT TO api_client
  USING(workspace_id=api.current_workspace_id());
CREATE POLICY study_projects_api_read ON api.study_projects FOR SELECT TO api_client
  USING(EXISTS(SELECT 1 FROM api.studies s WHERE s.record_id=study_record_id AND s.workspace_id=api.current_workspace_id()));
CREATE POLICY study_experiments_api_read ON api.study_experiments FOR SELECT TO api_client
  USING(EXISTS(SELECT 1 FROM api.studies s WHERE s.record_id=study_record_id AND s.workspace_id=api.current_workspace_id()));
CREATE POLICY study_plan_snapshots_api_read ON api.study_plan_snapshots FOR SELECT TO api_client
  USING(workspace_id=api.current_workspace_id());
REVOKE ALL ON api.studies,api.study_projects,api.study_experiments,api.study_plan_snapshots FROM authenticated,api_client;
GRANT SELECT ON api.studies,api.study_projects,api.study_experiments,api.study_plan_snapshots TO authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION api.create_study(
  p_workspace_id uuid,p_title text,p_home_project_id uuid DEFAULT NULL,p_summary text DEFAULT NULL,
  p_starts_on date DEFAULT NULL,p_ends_on date DEFAULT NULL,p_custom_fields jsonb DEFAULT '{}'
) RETURNS api.records LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sequence integer; generated_identifier text; result api.records; actor text:=api.current_user_id();
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'active workspace membership required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Study title must be 1–300 characters' USING ERRCODE='SB073'; END IF;
  IF p_ends_on IS NOT NULL AND p_starts_on IS NOT NULL AND p_ends_on<p_starts_on THEN RAISE EXCEPTION 'Study end date precedes its start date' USING ERRCODE='SB073'; END IF;
  IF p_home_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_home_project_id AND workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'home Project not found in active workspace' USING ERRCODE='42501';
  END IF;
  LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*)+1 INTO sequence FROM api.records r WHERE r.workspace_id=p_workspace_id AND r.kind='study' AND r.identifier LIKE 'STD-'||to_char(now(),'YYYY')||'-%';
  generated_identifier:='STD-'||to_char(now(),'YYYY')||'-'||lpad(sequence::text,4,'0');
  INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,custom_fields,created_by_user_id)
    VALUES(p_workspace_id,p_home_project_id,'study',generated_identifier,btrim(p_title),'draft',coalesce(p_custom_fields,'{}'),actor) RETURNING * INTO result;
  INSERT INTO api.studies(record_id,workspace_id,summary,starts_on,ends_on,created_by_user_id)
    VALUES(result.id,p_workspace_id,p_summary,p_starts_on,p_ends_on,actor);
  IF p_home_project_id IS NOT NULL THEN
    INSERT INTO api.study_projects(study_record_id,project_id,relationship,created_by_user_id)
      VALUES(result.id,p_home_project_id,'home',actor);
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION api.edit_study(
  p_study_record_id uuid,p_expected_metadata_version integer,p_title text,p_status text,
  p_summary text,p_starts_on date,p_ends_on date,p_custom_fields jsonb
) RETURNS api.records LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.records; study api.studies;
BEGIN
  SELECT * INTO result FROM api.records WHERE id=p_study_record_id AND kind='study' FOR UPDATE;
  SELECT * INTO study FROM api.studies WHERE record_id=p_study_record_id FOR UPDATE;
  IF result.id IS NULL OR study.record_id IS NULL OR api.current_workspace_id() IS DISTINCT FROM result.workspace_id OR NOT api.is_workspace_member(result.workspace_id) THEN
    RAISE EXCEPTION 'Study not found in active workspace' USING ERRCODE='42501';
  END IF;
  IF result.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Study is locked' USING ERRCODE='SB011'; END IF;
  IF result.metadata_version<>p_expected_metadata_version THEN RAISE EXCEPTION 'metadata version mismatch' USING ERRCODE='SB001'; END IF;
  IF p_status NOT IN ('draft','active','completed','cancelled') THEN RAISE EXCEPTION 'invalid Study status' USING ERRCODE='SB073'; END IF;
  IF p_ends_on IS NOT NULL AND p_starts_on IS NOT NULL AND p_ends_on<p_starts_on THEN RAISE EXCEPTION 'Study end date precedes its start date' USING ERRCODE='SB073'; END IF;
  UPDATE api.records SET title=coalesce(nullif(btrim(p_title),''),title),status=p_status,
    custom_fields=CASE WHEN p_custom_fields IS NULL THEN custom_fields ELSE custom_fields||p_custom_fields END,
    metadata_version=metadata_version+1,updated_by_user_id=api.current_user_id() WHERE id=result.id RETURNING * INTO result;
  UPDATE api.studies SET summary=p_summary,starts_on=p_starts_on,ends_on=p_ends_on,
    updated_at=now(),updated_by_user_id=api.current_user_id() WHERE record_id=result.id;
  RETURN result;
END $$;

CREATE FUNCTION api.link_study_project(p_study_record_id uuid,p_project_id uuid,p_relationship text DEFAULT 'participating')
RETURNS api.study_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE study api.studies; result api.study_projects;
BEGIN
  SELECT * INTO study FROM api.studies WHERE record_id=p_study_record_id;
  IF study.record_id IS NULL OR api.current_workspace_id() IS DISTINCT FROM study.workspace_id OR NOT api.is_workspace_member(study.workspace_id) THEN RAISE EXCEPTION 'Study not found in active workspace' USING ERRCODE='42501'; END IF;
  INSERT INTO api.study_projects(study_record_id,project_id,relationship,created_by_user_id)
    VALUES(p_study_record_id,p_project_id,p_relationship,api.current_user_id()) RETURNING * INTO result;
  PERFORM internal.emit_change_event(study.workspace_id,'study_project',p_study_record_id,'link',p_study_record_id,p_project_id,to_jsonb(result));
  RETURN result;
END $$;

CREATE FUNCTION api.link_study_experiment(p_study_record_id uuid,p_experiment_record_id uuid,p_relationship text DEFAULT 'member')
RETURNS api.study_experiments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE study api.studies; result api.study_experiments; project uuid;
BEGIN
  SELECT * INTO study FROM api.studies WHERE record_id=p_study_record_id;
  IF study.record_id IS NULL OR api.current_workspace_id() IS DISTINCT FROM study.workspace_id OR NOT api.is_workspace_member(study.workspace_id) THEN RAISE EXCEPTION 'Study not found in active workspace' USING ERRCODE='42501'; END IF;
  INSERT INTO api.study_experiments(study_record_id,experiment_record_id,relationship,created_by_user_id)
    VALUES(p_study_record_id,p_experiment_record_id,p_relationship,api.current_user_id()) RETURNING * INTO result;
  SELECT project_id INTO project FROM api.records WHERE id=p_experiment_record_id;
  PERFORM internal.emit_change_event(study.workspace_id,'study_experiment',p_study_record_id,'link',p_study_record_id,project,to_jsonb(result));
  RETURN result;
END $$;

CREATE FUNCTION api.assign_planner_item_to_study(p_study_record_id uuid,p_workstream_id uuid DEFAULT NULL,p_task_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE study api.studies;
BEGIN
  IF (p_workstream_id IS NULL)=(p_task_id IS NULL) THEN RAISE EXCEPTION 'provide exactly one planner item' USING ERRCODE='SB073'; END IF;
  SELECT * INTO study FROM api.studies WHERE record_id=p_study_record_id;
  IF study.record_id IS NULL OR api.current_workspace_id() IS DISTINCT FROM study.workspace_id OR NOT api.is_workspace_member(study.workspace_id) THEN RAISE EXCEPTION 'Study not found in active workspace' USING ERRCODE='42501'; END IF;
  IF p_workstream_id IS NOT NULL THEN
    UPDATE api.study_workstreams SET study_record_id=p_study_record_id,updated_at=now(),updated_by_user_id=api.current_user_id()
      WHERE id=p_workstream_id AND workspace_id=study.workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'workstream not found in active workspace' USING ERRCODE='SB027'; END IF;
    UPDATE api.study_tasks SET study_record_id=p_study_record_id,updated_at=now(),updated_by_user_id=api.current_user_id()
      WHERE workstream_id=p_workstream_id AND workspace_id=study.workspace_id AND study_record_id IS NULL;
  ELSE
    UPDATE api.study_tasks SET study_record_id=p_study_record_id,updated_at=now(),updated_by_user_id=api.current_user_id()
      WHERE id=p_task_id AND workspace_id=study.workspace_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'task not found in active workspace' USING ERRCODE='SB026'; END IF;
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION api.snapshot_study_plan(p_study_record_id uuid,p_reason text DEFAULT NULL)
RETURNS api.study_plan_snapshots LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE study api.studies; record api.records; payload jsonb; result api.study_plan_snapshots;
BEGIN
  SELECT * INTO study FROM api.studies WHERE record_id=p_study_record_id FOR UPDATE;
  SELECT * INTO record FROM api.records WHERE id=p_study_record_id;
  IF study.record_id IS NULL OR api.current_workspace_id() IS DISTINCT FROM study.workspace_id OR NOT api.is_workspace_member(study.workspace_id) THEN RAISE EXCEPTION 'Study not found in active workspace' USING ERRCODE='42501'; END IF;
  payload:=jsonb_build_object(
    'study',jsonb_build_object('record',to_jsonb(record),'extension',to_jsonb(study)),
    'projects',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.project_id) FROM api.study_projects x WHERE x.study_record_id=p_study_record_id),'[]'),
    'experiments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.experiment_record_id) FROM api.study_experiments x WHERE x.study_record_id=p_study_record_id),'[]'),
    'workstreams',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position,x.id) FROM api.study_workstreams x WHERE x.study_record_id=p_study_record_id),'[]'),
    'tasks',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position,x.id) FROM api.study_tasks x WHERE x.study_record_id=p_study_record_id),'[]'),
    'dependencies',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM api.study_task_dependencies x JOIN api.study_tasks t ON t.id=x.successor_id WHERE t.study_record_id=p_study_record_id),'[]'),
    'assignments',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM api.study_task_assignments x JOIN api.study_tasks t ON t.id=x.task_id WHERE t.study_record_id=p_study_record_id),'[]'),
    'resources',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM api.study_task_resources x JOIN api.study_tasks t ON t.id=x.task_id WHERE t.study_record_id=p_study_record_id),'[]'),
    'deliverables',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM api.study_deliverables x JOIN api.study_tasks t ON t.id=x.task_id WHERE t.study_record_id=p_study_record_id),'[]')
  );
  INSERT INTO api.study_plan_snapshots(study_record_id,workspace_id,plan_version,snapshot,checksum,reason,created_by_user_id)
    VALUES(p_study_record_id,study.workspace_id,study.plan_version,payload,internal.revision_integrity_digest(payload),p_reason,api.current_user_id()) RETURNING * INTO result;
  UPDATE api.studies SET plan_version=plan_version+1,updated_at=now(),updated_by_user_id=api.current_user_id() WHERE record_id=p_study_record_id;
  PERFORM internal.emit_change_event(study.workspace_id,'study_plan_snapshot',result.id,'create',p_study_record_id,record.project_id,jsonb_build_object('planVersion',result.plan_version,'checksum',result.checksum));
  RETURN result;
END $$;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation','workspace_invitation','workspace_settings','project_access','model_field_option','study_project','study_experiment','study_plan_snapshot'));

REVOKE EXECUTE ON FUNCTION api.create_study(uuid,text,uuid,text,date,date,jsonb),api.edit_study(uuid,integer,text,text,text,date,date,jsonb),api.link_study_project(uuid,uuid,text),api.link_study_experiment(uuid,uuid,text),api.assign_planner_item_to_study(uuid,uuid,uuid),api.snapshot_study_plan(uuid,text) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.create_study(uuid,text,uuid,text,date,date,jsonb),api.edit_study(uuid,integer,text,text,text,date,date,jsonb),api.link_study_project(uuid,uuid,text),api.link_study_experiment(uuid,uuid,text),api.assign_planner_item_to_study(uuid,uuid,uuid),api.snapshot_study_plan(uuid,text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
