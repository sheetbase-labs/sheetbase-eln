-- REPORT-001: one canonical notebook-backed Report identity.
-- report_definitions remains the structured one-to-one extension and its
-- duplicated identity fields are compatibility mirrors during rollout.

DO $$
DECLARE ambiguous text[]; invalid uuid[];
BEGIN
  SELECT array_agg(workspace_id||':'||document_identifier) INTO ambiguous
  FROM (
    SELECT d.workspace_id,d.document_identifier
    FROM api.report_definitions d JOIN api.records r
      ON r.workspace_id=d.workspace_id AND r.kind='report' AND r.identifier=d.document_identifier
    WHERE d.record_id IS NULL
    GROUP BY d.workspace_id,d.document_identifier HAVING count(*)>1
  ) conflicts;
  IF ambiguous IS NOT NULL THEN RAISE EXCEPTION 'ambiguous Report identities require review: %',ambiguous USING ERRCODE='SB074'; END IF;
  SELECT array_agg(d.id) INTO invalid FROM api.report_definitions d JOIN api.records r ON r.id=d.record_id
    WHERE r.kind<>'report' OR r.workspace_id<>d.workspace_id;
  IF invalid IS NOT NULL THEN RAISE EXCEPTION 'invalid Report identity links require review: %',invalid USING ERRCODE='SB074'; END IF;
END $$;

UPDATE api.report_definitions d SET record_id=r.id
FROM api.records r
WHERE d.record_id IS NULL AND r.workspace_id=d.workspace_id
  AND r.kind='report' AND r.identifier=d.document_identifier;

INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,created_at,updated_at,created_by_user_id,updated_by_user_id)
SELECT d.workspace_id,d.project_id,'report',d.document_identifier,d.title,d.status,
       d.created_at,d.updated_at,d.created_by_user_id,d.updated_by_user_id
FROM api.report_definitions d WHERE d.record_id IS NULL;

UPDATE api.report_definitions d SET record_id=r.id
FROM api.records r
WHERE d.record_id IS NULL AND r.workspace_id=d.workspace_id
  AND r.kind='report' AND r.identifier=d.document_identifier;

UPDATE api.records r SET title=d.title,status=d.status,project_id=d.project_id,
  updated_at=greatest(r.updated_at,d.updated_at),updated_by_user_id=coalesce(d.updated_by_user_id,r.updated_by_user_id)
FROM api.report_definitions d WHERE d.record_id=r.id;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM api.report_definitions WHERE record_id IS NULL) THEN
   RAISE EXCEPTION 'Report identity backfill is incomplete' USING ERRCODE='SB074';
 END IF;
 IF EXISTS(SELECT 1 FROM api.blocks b JOIN api.report_definitions d ON d.record_id=b.record_id) THEN
   RAISE EXCEPTION 'Report Blocks require explicit migration to Report Sections' USING ERRCODE='SB074';
 END IF;
END $$;
--> statement-breakpoint

ALTER TABLE api.report_definitions DROP CONSTRAINT report_definitions_record_id_fkey;
ALTER TABLE api.report_definitions ALTER COLUMN record_id SET NOT NULL;
ALTER TABLE api.report_definitions ADD CONSTRAINT report_definitions_record_id_records_id_fk
  FOREIGN KEY(record_id) REFERENCES api.records(id) ON DELETE cascade;
ALTER TABLE api.report_definitions ADD CONSTRAINT uq_report_definitions_record UNIQUE(record_id);
CREATE INDEX idx_report_definitions_record ON api.report_definitions(record_id);
CREATE UNIQUE INDEX uq_records_workspace_report_identifier
  ON api.records(workspace_id,identifier) WHERE kind='report';
--> statement-breakpoint

CREATE FUNCTION internal.guard_report_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report_record api.records;
BEGIN
  SELECT * INTO report_record FROM api.records WHERE id=NEW.record_id;
  IF report_record.id IS NULL OR report_record.kind<>'report' OR report_record.workspace_id<>NEW.workspace_id THEN
    RAISE EXCEPTION 'invalid canonical Report identity' USING ERRCODE='SB074';
  END IF;
  IF (NEW.project_id,NEW.title,NEW.status,NEW.document_identifier)
     IS DISTINCT FROM (report_record.project_id,report_record.title,report_record.status,report_record.identifier) THEN
    RAISE EXCEPTION 'Report identity mirrors must match the canonical record' USING ERRCODE='SB074';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_identity_guard BEFORE INSERT OR UPDATE OF workspace_id,project_id,record_id,title,status,document_identifier
  ON api.report_definitions FOR EACH ROW EXECUTE FUNCTION internal.guard_report_identity();

CREATE FUNCTION internal.sync_report_identity_mirror() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.kind='report' THEN
    UPDATE api.report_definitions SET workspace_id=NEW.workspace_id,project_id=NEW.project_id,
      title=NEW.title,status=NEW.status,document_identifier=NEW.identifier,
      updated_at=NEW.updated_at,updated_by_user_id=NEW.updated_by_user_id
      WHERE record_id=NEW.id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER report_identity_mirror AFTER UPDATE OF workspace_id,project_id,kind,identifier,title,status ON api.records
  FOR EACH ROW EXECUTE FUNCTION internal.sync_report_identity_mirror();

CREATE FUNCTION internal.reject_report_blocks() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM api.records WHERE id=NEW.record_id AND kind='report') THEN
    RAISE EXCEPTION 'Report Sections are the sole Report composition authority' USING ERRCODE='SB074';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_blocks_rejected BEFORE INSERT OR UPDATE OF record_id ON api.blocks
  FOR EACH ROW EXECUTE FUNCTION internal.reject_report_blocks();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_report_definition(
  p_workspace_id uuid,p_title text,p_subtitle text DEFAULT NULL,p_project_id uuid DEFAULT NULL,p_template_record_id uuid DEFAULT NULL
) RETURNS api.report_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.report_definitions; report_record api.records; sequence integer; generated_identifier text; year integer:=extract(year from now());
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033'; END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid Report title' USING ERRCODE='SB044'; END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'Project not found in target workspace' USING ERRCODE='42501'; END IF;
  LOCK TABLE api.records IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*)+1 INTO sequence FROM api.records r WHERE r.workspace_id=p_workspace_id AND r.kind='report' AND r.identifier~('^RPT-'||year||'-[0-9]+$');
  generated_identifier:='RPT-'||year||'-'||lpad(sequence::text,4,'0');
  INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,created_by_user_id,updated_by_user_id)
    VALUES(p_workspace_id,p_project_id,'report',generated_identifier,btrim(p_title),'draft',api.current_user_id(),api.current_user_id()) RETURNING * INTO report_record;
  INSERT INTO api.report_definitions(workspace_id,project_id,record_id,template_record_id,title,subtitle,document_identifier,status,version,created_by_user_id,updated_by_user_id)
    VALUES(p_workspace_id,p_project_id,report_record.id,p_template_record_id,report_record.title,p_subtitle,report_record.identifier,report_record.status,1,api.current_user_id(),api.current_user_id()) RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION api.update_report_definition(
  p_workspace_id uuid,p_report_id uuid,p_title text DEFAULT NULL,p_subtitle text DEFAULT NULL,p_status text DEFAULT NULL,
  p_template_record_id uuid DEFAULT NULL,p_review_submission_id uuid DEFAULT NULL
) RETURNS api.report_definitions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.report_definitions; report_record api.records; next_title text; next_status text;
BEGIN
  SELECT d.* INTO result FROM api.report_definitions d WHERE d.id=p_report_id AND d.workspace_id=p_workspace_id FOR UPDATE;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033'; END IF;
  IF result.id IS NULL OR NOT api.is_workspace_member(p_workspace_id) THEN RAISE EXCEPTION 'Report not found in target workspace' USING ERRCODE='42501'; END IF;
  SELECT * INTO report_record FROM api.records WHERE id=result.record_id FOR UPDATE;
  IF report_record.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Report is locked' USING ERRCODE='SB011'; END IF;
  next_title:=coalesce(nullif(btrim(p_title),''),report_record.title); next_status:=coalesce(p_status,report_record.status);
  IF next_status NOT IN ('draft','in_review','approved','published','archived') THEN RAISE EXCEPTION 'invalid Report status' USING ERRCODE='SB045'; END IF;
  UPDATE api.records SET title=next_title,status=next_status,metadata_version=metadata_version+1,updated_at=now(),updated_by_user_id=api.current_user_id()
    WHERE id=report_record.id RETURNING * INTO report_record;
  UPDATE api.report_definitions SET title=report_record.title,status=report_record.status,project_id=report_record.project_id,
    subtitle=coalesce(p_subtitle,subtitle),template_record_id=coalesce(p_template_record_id,template_record_id),review_submission_id=coalesce(p_review_submission_id,review_submission_id),
    version=CASE WHEN report_record.status IS DISTINCT FROM result.status THEN version+1 ELSE version END,last_saved_at=now(),updated_at=now(),updated_by_user_id=api.current_user_id()
    WHERE id=p_report_id RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.report_structure_manifest(p_record_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
   'definition',to_jsonb(d),
   'sections',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.position,s.id) FROM api.report_sections s WHERE s.report_id=d.id),'[]'),
   'latestGeneration',coalesce((SELECT to_jsonb(g) FROM api.report_generations g WHERE g.report_id=d.id ORDER BY g.report_version DESC,g.generated_at DESC,g.id DESC LIMIT 1),'null')
 ) FROM api.report_definitions d WHERE d.record_id=p_record_id
$$;
ALTER FUNCTION internal.build_revision_envelope(uuid) RENAME TO build_revision_envelope_without_report_structure;
CREATE FUNCTION internal.build_revision_envelope(p_record_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE base jsonb; kind text;
BEGIN
 base:=internal.build_revision_envelope_without_report_structure(p_record_id); SELECT r.kind INTO kind FROM api.records r WHERE r.id=p_record_id;
 IF kind='report' THEN RETURN base||jsonb_build_object('reportStructure',internal.report_structure_manifest(p_record_id)); END IF;
 RETURN base;
END $$;
REVOKE EXECUTE ON FUNCTION internal.report_structure_manifest(uuid),internal.build_revision_envelope_without_report_structure(uuid),internal.build_revision_envelope(uuid) FROM PUBLIC,authenticated,api_client;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation','workspace_invitation','workspace_settings','project_access','model_field_option','study_project','study_experiment','study_plan_snapshot'));
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
