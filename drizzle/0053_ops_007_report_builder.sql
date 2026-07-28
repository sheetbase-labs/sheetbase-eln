-- OPS-007: Report Builder
--   api.report_definitions   — the report document (title, template, status)
--   api.report_sections      — ordered sections bound to frozen evidence
--   api.report_generations   — generation audit (inputs, version, actor, checksum)
--
-- Sections reference frozen revision data (REV-003/REV-005/REV-008). The
-- canonical_snapshot captured at bind time is stored in frozen_payload so
-- preview/export never silently substitute live data for frozen evidence.
-- Generation is deterministic: identical inputs produce an identical
-- output_checksum. Templates (SCI-006) and review submissions (REV-002) are
-- reused by reference rather than reimplemented.

CREATE TABLE api.report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id uuid,
  record_id uuid,
  template_record_id uuid,
  review_submission_id uuid,
  title text NOT NULL,
  subtitle text,
  document_identifier text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  last_saved_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL,
  updated_by_user_id text,
  FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY (project_id) REFERENCES api.projects(id) ON DELETE set null,
  FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE set null,
  FOREIGN KEY (template_record_id) REFERENCES api.records(id) ON DELETE set null,
  FOREIGN KEY (review_submission_id) REFERENCES api.review_submissions(id) ON DELETE set null,
  FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE restrict,
  FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  UNIQUE(workspace_id, document_identifier),
  CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  CHECK (status IN ('draft','in_review','approved','published','archived')),
  CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX idx_report_definitions_workspace ON api.report_definitions(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_report_definitions_workspace_status ON api.report_definitions(workspace_id,status);
--> statement-breakpoint
CREATE INDEX idx_report_definitions_project ON api.report_definitions(project_id);
--> statement-breakpoint

CREATE TABLE api.report_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  title text NOT NULL,
  description text,
  section_type text NOT NULL DEFAULT 'text',
  source_type text NOT NULL DEFAULT 'free_text',
  source_revision_id uuid,
  source_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  frozen_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_status text NOT NULL DEFAULT 'pending',
  validation_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id text NOT NULL,
  updated_by_user_id text,
  FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY (report_id) REFERENCES api.report_definitions(id) ON DELETE cascade,
  FOREIGN KEY (source_revision_id) REFERENCES api.revisions(id) ON DELETE restrict,
  FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE restrict,
  FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE set null,
  CHECK (length(btrim(title)) BETWEEN 1 AND 300),
  CHECK (position >= 0),
  CHECK (section_type IN ('text','table','chart','file','record_metadata','composite')),
  CHECK (source_type IN ('free_text','revision_block','chart_block','table_block','file_object','record_metadata')),
  CHECK (validation_status IN ('pending','valid','missing_source','stale','locked'))
);
--> statement-breakpoint
CREATE INDEX idx_report_sections_workspace ON api.report_sections(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_report_sections_report ON api.report_sections(report_id);
--> statement-breakpoint
CREATE INDEX idx_report_sections_report_position ON api.report_sections(report_id,position);
--> statement-breakpoint
CREATE INDEX idx_report_sections_revision ON api.report_sections(source_revision_id);
--> statement-breakpoint

CREATE TABLE api.report_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  report_version integer NOT NULL,
  generation_inputs jsonb NOT NULL,
  output_format text NOT NULL DEFAULT 'html',
  output_checksum text NOT NULL,
  output_size_bytes bigint NOT NULL DEFAULT 0,
  output_html text,
  actor_user_id text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE cascade,
  FOREIGN KEY (report_id) REFERENCES api.report_definitions(id) ON DELETE cascade,
  FOREIGN KEY (actor_user_id) REFERENCES internal."user"(id) ON DELETE restrict,
  CHECK (output_format IN ('html','pdf')),
  CHECK (output_checksum ~ '^[0-9a-f]{64}$'),
  CHECK (report_version > 0),
  CHECK (output_size_bytes >= 0)
);
--> statement-breakpoint
CREATE INDEX idx_report_generations_workspace ON api.report_generations(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_report_generations_report ON api.report_generations(report_id);
--> statement-breakpoint
CREATE INDEX idx_report_generations_report_version ON api.report_generations(report_id,report_version);
--> statement-breakpoint
CREATE INDEX idx_report_generations_checksum ON api.report_generations(output_checksum);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON api.report_definitions TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON api.report_sections TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.report_generations TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.report_definitions, api.report_sections, api.report_generations TO api_client;
--> statement-breakpoint

ALTER TABLE api.report_definitions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.report_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.report_generations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY report_definitions_select ON api.report_definitions FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY report_definitions_client_select ON api.report_definitions FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY report_definitions_write ON api.report_definitions FOR ALL TO authenticated USING (api.storage_member_using(workspace_id)) WITH CHECK (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY report_sections_select ON api.report_sections FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY report_sections_client_select ON api.report_sections FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY report_sections_write ON api.report_sections FOR ALL TO authenticated USING (api.storage_member_using(workspace_id)) WITH CHECK (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY report_generations_select ON api.report_generations FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY report_generations_client_select ON api.report_generations FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint

-- Deterministic, workspace-scoped document identifier: RPT-YYYY-NNNN.
CREATE OR REPLACE FUNCTION api.create_report_definition(
  p_workspace_id uuid,
  p_title text,
  p_subtitle text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_template_record_id uuid DEFAULT NULL
) RETURNS api.report_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v api.report_definitions;
  v_year int := extract(year from now());
  v_count int;
  v_identifier text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE='SB033';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid report title' USING ERRCODE='SB044';
  END IF;
  SELECT count(*)+1 INTO v_count FROM api.report_definitions
    WHERE workspace_id=p_workspace_id
      AND document_identifier ~ ('^RPT-'||v_year||'-[0-9]+$');
  v_identifier := 'RPT-'||v_year||'-'||lpad(v_count::text,4,'0');
  INSERT INTO api.report_definitions(
    workspace_id, project_id, template_record_id, title, subtitle,
    document_identifier, status, version, created_by_user_id, updated_by_user_id
  ) VALUES(
    p_workspace_id, p_project_id, p_template_record_id, btrim(p_title), p_subtitle,
    v_identifier, 'draft', 1, api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_report_definition(uuid,text,text,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_report_definition(uuid,text,text,uuid,uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_report_definition(
  p_workspace_id uuid,
  p_report_id uuid,
  p_title text DEFAULT NULL,
  p_subtitle text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_template_record_id uuid DEFAULT NULL,
  p_review_submission_id uuid DEFAULT NULL
) RETURNS api.report_definitions
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.report_definitions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','in_review','approved','published','archived') THEN
    RAISE EXCEPTION 'invalid report status' USING ERRCODE='SB045';
  END IF;
  UPDATE api.report_definitions SET
    title=COALESCE(NULLIF(p_title,''), title),
    subtitle=COALESCE(p_subtitle, subtitle),
    status=COALESCE(p_status, status),
    template_record_id=COALESCE(p_template_record_id, template_record_id),
    review_submission_id=COALESCE(p_review_submission_id, review_submission_id),
    version=CASE WHEN p_status IS DISTINCT FROM status THEN version+1 ELSE version END,
    last_saved_at=now(),
    updated_at=now(),
    updated_by_user_id=api.current_user_id()
  WHERE id=p_report_id AND workspace_id=p_workspace_id RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE='SB046'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_report_definition(uuid,uuid,text,text,text,uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_report_definition(uuid,uuid,text,text,text,uuid,uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.add_report_section(
  p_workspace_id uuid,
  p_report_id uuid,
  p_title text,
  p_description text DEFAULT NULL,
  p_section_type text DEFAULT 'text',
  p_source_type text DEFAULT 'free_text'
) RETURNS api.report_sections
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v api.report_sections;
  v_pos int;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.report_definitions WHERE id=p_report_id AND workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'report not found' USING ERRCODE='SB046';
  END IF;
  IF p_title IS NULL OR length(btrim(p_title)) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'invalid section title' USING ERRCODE='SB044';
  END IF;
  IF p_section_type NOT IN ('text','table','chart','file','record_metadata','composite') THEN
    RAISE EXCEPTION 'invalid section type' USING ERRCODE='SB047';
  END IF;
  IF p_source_type NOT IN ('free_text','revision_block','chart_block','table_block','file_object','record_metadata') THEN
    RAISE EXCEPTION 'invalid source type' USING ERRCODE='SB047';
  END IF;
  SELECT COALESCE(max(position)+1,0) INTO v_pos FROM api.report_sections WHERE report_id=p_report_id;
  INSERT INTO api.report_sections(
    workspace_id, report_id, position, title, description, section_type, source_type,
    created_by_user_id, updated_by_user_id
  ) VALUES(
    p_workspace_id, p_report_id, v_pos, btrim(p_title), p_description, p_section_type, p_source_type,
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.add_report_section(uuid,uuid,text,text,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.add_report_section(uuid,uuid,text,text,text,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_report_section(
  p_workspace_id uuid,
  p_section_id uuid,
  p_title text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_section_type text DEFAULT NULL,
  p_position integer DEFAULT NULL
) RETURNS api.report_sections
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.report_sections;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF p_section_type IS NOT NULL AND p_section_type NOT IN ('text','table','chart','file','record_metadata','composite') THEN
    RAISE EXCEPTION 'invalid section type' USING ERRCODE='SB047';
  END IF;
  UPDATE api.report_sections SET
    title=COALESCE(NULLIF(p_title,''), title),
    description=COALESCE(p_description, description),
    section_type=COALESCE(p_section_type, section_type),
    position=COALESCE(p_position, position),
    updated_at=now(),
    updated_by_user_id=api.current_user_id()
  WHERE id=p_section_id AND workspace_id=p_workspace_id RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'section not found' USING ERRCODE='SB048'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_report_section(uuid,uuid,text,text,text,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_report_section(uuid,uuid,text,text,text,integer) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.reorder_report_sections(
  p_workspace_id uuid,
  p_report_id uuid,
  p_section_ids jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_id uuid;
  v_pos int := 0;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF jsonb_typeof(p_section_ids) <> 'array' THEN
    RAISE EXCEPTION 'section ids must be an array' USING ERRCODE='SB044';
  END IF;
  FOR v_id IN SELECT * FROM jsonb_array_elements_text(p_section_ids) LOOP
    UPDATE api.report_sections SET position=v_pos, updated_at=now(), updated_by_user_id=api.current_user_id()
      WHERE id=v_id::uuid AND report_id=p_report_id AND workspace_id=p_workspace_id;
    v_pos := v_pos + 1;
  END LOOP;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.reorder_report_sections(uuid,uuid,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.reorder_report_sections(uuid,uuid,jsonb) TO authenticated;
--> statement-breakpoint

-- Bind a section to a frozen revision. The relevant block/payload is copied
-- out of the revision's canonical_snapshot into frozen_payload so preview and
-- export never read live data. source_ref identifies what to freeze
-- (e.g. {"blockId":"..."} or {"kind":"record_metadata"}).
CREATE OR REPLACE FUNCTION api.bind_report_section_source(
  p_workspace_id uuid,
  p_section_id uuid,
  p_source_revision_id uuid,
  p_source_ref jsonb DEFAULT '{}'::jsonb
) RETURNS api.report_sections
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v api.report_sections;
  v_rev api.revisions;
  v_snapshot jsonb;
  v_block_id text;
  v_blocks jsonb;
  v_block jsonb;
  v_frozen jsonb;
  v_status text := 'valid';
  v_detail jsonb := '{}'::jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  SELECT * INTO v FROM api.report_sections WHERE id=p_section_id AND workspace_id=p_workspace_id;
  IF v IS NULL THEN RAISE EXCEPTION 'section not found' USING ERRCODE='SB048'; END IF;
  SELECT * INTO v_rev FROM api.revisions WHERE id=p_source_revision_id AND workspace_id=p_workspace_id;
  IF v_rev IS NULL THEN RAISE EXCEPTION 'revision not found' USING ERRCODE='SB049'; END IF;
  v_snapshot := COALESCE(v_rev.canonical_snapshot, v_rev.block_snapshot);
  -- Freeze the referenced block, or the whole snapshot for record_metadata.
  v_block_id := p_source_ref->>'blockId';
  IF v_block_id IS NOT NULL THEN
    v_blocks := COALESCE(v_snapshot->'blocks', v_snapshot);
    IF jsonb_typeof(v_blocks)='array' THEN
      SELECT elem INTO v_block FROM jsonb_array_elements(v_blocks) elem WHERE elem->>'id'=v_block_id LIMIT 1;
    ELSIF jsonb_typeof(v_blocks)='object' THEN
      v_block := v_blocks->v_block_id;
    END IF;
    IF v_block IS NULL THEN
      v_status := 'missing_source';
      v_detail := jsonb_build_object('blockId',v_block_id,'reason','block not found in frozen snapshot');
      v_frozen := '{}'::jsonb;
    ELSE
      v_frozen := jsonb_build_object('block',v_block,'revisionDigest',v_rev.integrity_digest);
    END IF;
  ELSE
    v_frozen := jsonb_build_object('snapshot',v_snapshot,'revisionDigest',v_rev.integrity_digest);
  END IF;
  -- Flag locked source records: still valid frozen evidence, but surfaced.
  IF EXISTS(SELECT 1 FROM api.records WHERE id=v_rev.record_id AND locked_at IS NOT NULL) THEN
    v_status := 'locked';
    v_detail := v_detail || jsonb_build_object('lockedAt', (SELECT locked_at FROM api.records WHERE id=v_rev.record_id));
  END IF;
  UPDATE api.report_sections SET
    source_revision_id=p_source_revision_id,
    source_ref=COALESCE(p_source_ref,'{}'::jsonb),
    frozen_payload=v_frozen,
    validation_status=v_status,
    validation_detail=v_detail,
    updated_at=now(),
    updated_by_user_id=api.current_user_id()
  WHERE id=p_section_id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.bind_report_section_source(uuid,uuid,uuid,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.bind_report_section_source(uuid,uuid,uuid,jsonb) TO authenticated;
--> statement-breakpoint

-- Validate every section: missing sources, stale live references, locked
-- revisions. Returns a jsonb summary. Does not mutate frozen evidence.
CREATE OR REPLACE FUNCTION api.validate_report(
  p_workspace_id uuid,
  p_report_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_summary jsonb;
  v_sec api.report_sections;
  v_rev api.revisions;
  v_status text;
  v_detail jsonb;
  v_valid int := 0;
  v_missing int := 0;
  v_stale int := 0;
  v_locked int := 0;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM api.report_definitions WHERE id=p_report_id AND workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'report not found' USING ERRCODE='SB046';
  END IF;
  FOR v_sec IN SELECT * FROM api.report_sections WHERE report_id=p_report_id ORDER BY position LOOP
    v_status := 'valid';
    v_detail := '{}'::jsonb;
    IF v_sec.source_revision_id IS NULL AND v_sec.source_type <> 'free_text' THEN
      v_status := 'stale';
      v_detail := jsonb_build_object('reason','section references live data instead of a frozen revision');
    ELSIF v_sec.source_revision_id IS NOT NULL THEN
      SELECT * INTO v_rev FROM api.revisions WHERE id=v_sec.source_revision_id AND workspace_id=p_workspace_id;
      IF v_rev IS NULL THEN
        v_status := 'missing_source';
        v_detail := jsonb_build_object('reason','source revision no longer exists');
      ELSIF (v_sec.source_ref->>'blockId') IS NOT NULL
            AND (v_sec.frozen_payload = '{}'::jsonb) THEN
        v_status := 'missing_source';
        v_detail := jsonb_build_object('blockId',v_sec.source_ref->>'blockId','reason','frozen payload empty');
      END IF;
      IF v_status='valid' AND EXISTS(SELECT 1 FROM api.records WHERE id=v_rev.record_id AND locked_at IS NOT NULL) THEN
        v_status := 'locked';
        v_detail := jsonb_build_object('lockedAt',(SELECT locked_at FROM api.records WHERE id=v_rev.record_id));
      END IF;
    END IF;
    UPDATE api.report_sections SET validation_status=v_status, validation_detail=v_detail, updated_at=now()
      WHERE id=v_sec.id;
    v_valid := v_valid + (v_status='valid')::int;
    v_missing := v_missing + (v_status='missing_source')::int;
    v_stale := v_stale + (v_status='stale')::int;
    v_locked := v_locked + (v_status='locked')::int;
  END LOOP;
  v_summary := jsonb_build_object(
    'reportId',p_report_id,
    'sections',(SELECT count(*) FROM api.report_sections WHERE report_id=p_report_id),
    'valid',v_valid,
    'missingSource',v_missing,
    'stale',v_stale,
    'locked',v_locked,
    'ready',(v_missing=0 AND v_stale=0)
  );
  RETURN v_summary;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.validate_report(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.validate_report(uuid,uuid) TO authenticated;
--> statement-breakpoint

-- Deterministic report generation. Builds a stable HTML document from the
-- frozen payloads (never live data), computes a sha256 output checksum over
-- the deterministic generation inputs, and records an audit row.
CREATE OR REPLACE FUNCTION api.generate_report(
  p_workspace_id uuid,
  p_report_id uuid,
  p_output_format text DEFAULT 'html'
) RETURNS api.report_generations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_report api.report_definitions;
  v_sec api.report_sections;
  v_inputs jsonb;
  v_section_inputs jsonb := '[]'::jsonb;
  v_html text;
  v_section_html text;
  v_pos int := 0;
  v_gen api.report_generations;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE='SB033';
  END IF;
  IF p_output_format NOT IN ('html','pdf') THEN
    RAISE EXCEPTION 'invalid output format' USING ERRCODE='SB047';
  END IF;
  SELECT * INTO v_report FROM api.report_definitions WHERE id=p_report_id AND workspace_id=p_workspace_id;
  IF v_report IS NULL THEN RAISE EXCEPTION 'report not found' USING ERRCODE='SB046'; END IF;
  -- Deterministic inputs: ordered section identity + frozen payload digest.
  FOR v_sec IN SELECT * FROM api.report_sections WHERE report_id=p_report_id ORDER BY position LOOP
    v_section_inputs := v_section_inputs || jsonb_build_array(jsonb_build_object(
      'position',v_pos,
      'sectionId',v_sec.id,
      'title',v_sec.title,
      'sectionType',v_sec.section_type,
      'sourceType',v_sec.source_type,
      'sourceRevisionId',v_sec.source_revision_id,
      'sourceRef',v_sec.source_ref,
      'frozenPayload',v_sec.frozen_payload
    ));
    v_pos := v_pos + 1;
  END LOOP;
  v_inputs := jsonb_build_object(
    'reportId',v_report.id,
    'reportVersion',v_report.version,
    'documentIdentifier',v_report.document_identifier,
    'title',v_report.title,
    'subtitle',v_report.subtitle,
    'outputFormat',p_output_format,
    'sections',v_section_inputs
  );
  -- Build deterministic HTML.
  v_html := '<!DOCTYPE html>'||chr(10)||'<html lang="en">'||chr(10)||
    '<head>'||chr(10)||'<meta charset="utf-8"/>'||chr(10)||
    '<title>'||v_report.title||'</title>'||chr(10)||
    '<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.6rem}.subtitle{color:#555;font-style:italic}section{margin:1.5rem 0;padding-bottom:1rem;border-bottom:1px solid #eee}section h2{font-size:1.15rem}.meta{font-size:.8rem;color:#666}.badge{display:inline-block;font-size:.7rem;padding:.1rem .4rem;border:1px solid #ccc;border-radius:3px}</style>'||chr(10)||
    '</head>'||chr(10)||'<body>'||chr(10)||
    '<h1>'||v_report.title||'</h1>'||chr(10)||
    CASE WHEN v_report.subtitle IS NOT NULL THEN '<p class="subtitle">'||v_report.subtitle||'</p>'||chr(10) ELSE '' END||
    '<p class="meta">'||v_report.document_identifier||' · v'||v_report.version||'</p>'||chr(10);
  FOR v_sec IN SELECT * FROM api.report_sections WHERE report_id=p_report_id ORDER BY position LOOP
    v_section_html := '<section>'||chr(10)||
      '<h2>'||COALESCE(v_sec.position+1,0)::text||'. '||v_sec.title||'</h2>'||chr(10);
    IF v_sec.description IS NOT NULL THEN
      v_section_html := v_section_html||'<p>'||v_sec.description||'</p>'||chr(10);
    END IF;
    v_section_html := v_section_html||
      '<p class="meta">Source: '||v_sec.source_type||
      COALESCE(' · revision '||substring(v_sec.source_revision_id::text,1,8),'')||
      ' · status '||v_sec.validation_status||'</p>'||chr(10);
    IF v_sec.frozen_payload IS NOT NULL AND v_sec.frozen_payload <> '{}'::jsonb THEN
      v_section_html := v_section_html||'<pre>'||regexp_replace(v_sec.frozen_payload::text,'<','&lt;','g')||'</pre>'||chr(10);
    END IF;
    v_section_html := v_section_html||'</section>'||chr(10);
    v_html := v_html||v_section_html;
  END LOOP;
  v_html := v_html||'</body>'||chr(10)||'</html>'||chr(10);
  INSERT INTO api.report_generations(
    workspace_id, report_id, report_version, generation_inputs, output_format,
    output_checksum, output_size_bytes, output_html, actor_user_id
  ) VALUES(
    p_workspace_id, p_report_id, v_report.version, v_inputs, p_output_format,
    encode(sha256(convert_to(v_inputs::text,'UTF8')),'hex'),
    octet_length(v_html), v_html, api.current_user_id()
  ) RETURNING * INTO v_gen;
  RETURN v_gen;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.generate_report(uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.generate_report(uuid,uuid,text) TO authenticated;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.trg_change_event_report() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_entity text; v_op text; v_payload jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op:='create'; v_payload:=to_jsonb(NEW)-'metadata';
    WHEN 'UPDATE' THEN v_op:='update'; v_payload:=to_jsonb(NEW)-'metadata';
    WHEN 'DELETE' THEN v_op:='delete'; v_payload:=to_jsonb(OLD)-'metadata';
  END CASE;
  PERFORM internal.emit_change_event(COALESCE(NEW.workspace_id,OLD.workspace_id),v_entity,COALESCE(NEW.id,OLD.id),v_op,NULL,NULL,v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_report() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_report_definitions AFTER INSERT OR UPDATE OR DELETE ON api.report_definitions FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_report('report_definition');
--> statement-breakpoint
CREATE TRIGGER change_event_report_sections AFTER INSERT OR UPDATE OR DELETE ON api.report_sections FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_report('report_section');
--> statement-breakpoint
CREATE TRIGGER change_event_report_generations AFTER INSERT ON api.report_generations FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_report('report_generation');
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
