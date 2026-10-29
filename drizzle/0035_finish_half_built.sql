-- Finish three half-built features: the report builder, sharing with a client
-- from the record, and one training record for protocols.

-- ---------------------------------------------------------------------------
-- Reports: a section can be removed, and the generated document escapes what
-- people typed and shows the text of the evidence it froze.
-- ---------------------------------------------------------------------------
CREATE FUNCTION api.remove_report_section(p_workspace_id uuid, p_section_id uuid)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_report_id uuid;
  v_locked timestamptz;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT s.report_id INTO v_report_id FROM api.report_sections s
   WHERE s.id = p_section_id AND s.workspace_id = p_workspace_id;
  IF v_report_id IS NULL THEN
    RAISE EXCEPTION 'section not found' USING ERRCODE = 'SB048';
  END IF;
  PERFORM internal.assert_object_access('report', v_report_id, 'edit');
  SELECT r.locked_at INTO v_locked
    FROM api.report_definitions d JOIN api.records r ON r.id = d.record_id
   WHERE d.id = v_report_id;
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'Report is locked' USING ERRCODE = 'SB011';
  END IF;
  DELETE FROM api.report_sections WHERE id = p_section_id;
  -- Close the gap so positions stay 0..n-1.
  UPDATE api.report_sections s SET position = n.pos
    FROM (SELECT id, (row_number() OVER (ORDER BY position, id) - 1)::int AS pos
            FROM api.report_sections WHERE report_id = v_report_id) n
   WHERE s.id = n.id AND s.position IS DISTINCT FROM n.pos;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_report_section(p_workspace_id uuid, p_section_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_report_section(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_report_section(uuid, uuid) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION internal.html_escape(p_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT replace(replace(replace(replace(replace(coalesce(p_text, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;
--> statement-breakpoint
ALTER FUNCTION internal.html_escape(p_text text) OWNER TO migrator;
--> statement-breakpoint
-- The words in a frozen block: every `text` value in it, in order.
CREATE FUNCTION internal.report_payload_text(p_payload jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT nullif(string_agg(q.x, ' '), '')
    FROM (
      SELECT jsonb_path_query(p_payload, 'strict $.**.text', '{}'::jsonb, true) #>> '{}' AS x
    ) q
   WHERE btrim(coalesce(q.x, '')) <> ''
$$;
--> statement-breakpoint
ALTER FUNCTION internal.report_payload_text(p_payload jsonb) OWNER TO migrator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.generate_report(p_workspace_id uuid, p_report_id uuid, p_output_format text DEFAULT 'html'::text)
RETURNS api.report_generations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_report api.report_definitions;
  v_sec api.report_sections;
  v_inputs jsonb;
  v_section_inputs jsonb := '[]'::jsonb;
  v_html text;
  v_section_html text;
  v_text text;
  v_pos int := 0;
  v_gen api.report_generations;
BEGIN
 IF p_report_id IS NOT NULL THEN PERFORM internal.assert_object_access('report',p_report_id,'edit'); END IF;
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
      'description',v_sec.description,
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
  -- Build deterministic HTML. Everything a person typed is escaped.
  v_html := '<!DOCTYPE html>'||chr(10)||'<html lang="en">'||chr(10)||
    '<head>'||chr(10)||'<meta charset="utf-8"/>'||chr(10)||
    '<title>'||internal.html_escape(v_report.title)||'</title>'||chr(10)||
    '<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#111}h1{font-size:1.6rem}.subtitle{color:#555;font-style:italic}section{margin:1.5rem 0;padding-bottom:1rem;border-bottom:1px solid #eee}section h2{font-size:1.15rem}.meta{font-size:.8rem;color:#666}.body{white-space:pre-wrap}</style>'||chr(10)||
    '</head>'||chr(10)||'<body>'||chr(10)||
    '<h1>'||internal.html_escape(v_report.title)||'</h1>'||chr(10)||
    CASE WHEN v_report.subtitle IS NOT NULL THEN '<p class="subtitle">'||internal.html_escape(v_report.subtitle)||'</p>'||chr(10) ELSE '' END||
    '<p class="meta">'||internal.html_escape(v_report.document_identifier)||' · v'||v_report.version||'</p>'||chr(10);
  FOR v_sec IN SELECT * FROM api.report_sections WHERE report_id=p_report_id ORDER BY position LOOP
    v_section_html := '<section>'||chr(10)||
      '<h2>'||COALESCE(v_sec.position+1,0)::text||'. '||internal.html_escape(v_sec.title)||'</h2>'||chr(10);
    IF v_sec.description IS NOT NULL THEN
      v_section_html := v_section_html||'<p class="body">'||internal.html_escape(v_sec.description)||'</p>'||chr(10);
    END IF;
    IF v_sec.source_revision_id IS NOT NULL THEN
      v_text := internal.report_payload_text(v_sec.frozen_payload);
      IF v_text IS NOT NULL THEN
        v_section_html := v_section_html||'<p class="body">'||internal.html_escape(v_text)||'</p>'||chr(10);
      END IF;
      v_section_html := v_section_html||
        '<p class="meta">From '||COALESCE(internal.html_escape(v_sec.source_ref->>'recordIdentifier'),'a record')||
        ' · revision '||substring(v_sec.source_revision_id::text,1,8)||'</p>'||chr(10);
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
-- ---------------------------------------------------------------------------
-- Sharing with a client from the record: only to the client the record's
-- project belongs to, because that is the only portal that can show it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.share_record_with_client(p_client_id uuid, p_record_id uuid)
RETURNS api.client_portal_shares
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  c api.clients;
  r api.records;
  v api.client_portal_shares;
BEGIN
 IF p_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_record_id,'manage'); END IF;
  SELECT * INTO c FROM api.clients
    WHERE id = p_client_id
      AND workspace_id = api.current_workspace_id()
      AND api.is_workspace_writer(workspace_id);
  IF c.id IS NULL THEN
    RAISE EXCEPTION 'Client denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM api.records
    WHERE id = p_record_id
      AND workspace_id = c.workspace_id
      AND deleted_at IS NULL;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Record denied' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'only approved records can be shared to a client portal'
      USING ERRCODE = '22023';
  END IF;
  IF r.project_id IS NULL THEN
    RAISE EXCEPTION 'a shared record needs a project' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.projects p
                  WHERE p.id = r.project_id AND p.client_id = c.id) THEN
    RAISE EXCEPTION 'a record can only be shared with the client its project belongs to'
      USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.client_portal_shares(
    workspace_id, client_id, project_id, record_id, shared_by_user_id
  ) VALUES (
    c.workspace_id, c.id, r.project_id, r.id, api.current_user_id()
  )
  ON CONFLICT (client_id, record_id) DO UPDATE
    SET shared_at = now(), shared_by_user_id = api.current_user_id()
  RETURNING * INTO v;
  INSERT INTO api.project_access(workspace_id, project_id, user_id, can_view, can_edit, can_review, client_portal, can_manage, granted_by_user_id)
  SELECT v.workspace_id, v.project_id, m.user_id, false, false, false, true, false, api.current_user_id()
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v.workspace_id
     AND m.suspended_at IS NULL
     AND m.role = 'client_viewer'
     AND m.client_id = v.client_id
  ON CONFLICT (workspace_id, project_id, user_id)
  DO UPDATE SET client_portal = true, updated_at = now();
  RETURN v;
END $$;
--> statement-breakpoint
-- What a person needs to know about sharing one record: which client it would
-- go to, whether the project already shares everything, and who shared it.
CREATE FUNCTION api.record_client_sharing(p_record_id uuid)
RETURNS TABLE(
  record_status text, project_id uuid, client_id uuid, client_code text,
  client_name text, auto_share boolean, shared_at timestamptz,
  shared_by_name text, can_manage boolean
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  PERFORM internal.assert_object_access('record', p_record_id, 'view');
  RETURN QUERY
  SELECT r.status, p.id, c.id, c.code, c.name, p.auto_share_to_client,
         s.shared_at, u.name,
         (api.is_workspace_writer(r.workspace_id)
          AND internal.can_access_object('record', r.id, 'manage'))
    FROM api.records r
    LEFT JOIN api.projects p ON p.id = r.project_id
    LEFT JOIN api.clients c ON c.id = p.client_id AND c.archived_at IS NULL
    LEFT JOIN api.client_portal_shares s ON s.record_id = r.id AND s.client_id = c.id
    LEFT JOIN internal."user" u ON u.id = s.shared_by_user_id
   WHERE r.id = p_record_id
     AND r.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_client_sharing(p_record_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_client_sharing(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_client_sharing(uuid) TO authenticated;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- One training record for protocols. The acknowledgement of an exact version
-- is the record of training, and it is what starting an experiment checks.
-- `protocol_training` is only the roster: who is expected to keep up with a
-- protocol, and by when. Whether someone is trained is read from the
-- acknowledgements, so the two can no longer disagree.
-- ---------------------------------------------------------------------------
ALTER TABLE api.protocol_acknowledgements
  ADD COLUMN recorded_by_user_id text,
  ADD COLUMN notes text;
--> statement-breakpoint
ALTER TABLE api.protocol_acknowledgements
  ADD CONSTRAINT protocol_acknowledgements_recorded_by_user_id_user_id_fk
  FOREIGN KEY (recorded_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
-- Everyone who has acknowledged a version is on the protocol's roster.
INSERT INTO api.protocol_training (workspace_id, protocol_record_id, user_id)
SELECT DISTINCT v.workspace_id, v.protocol_record_id, a.user_id
  FROM api.protocol_acknowledgements a
  JOIN api.protocol_versions v ON v.id = a.protocol_version_id
ON CONFLICT (protocol_record_id, user_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE api.protocol_training DROP CONSTRAINT chk_protocol_training_status;
--> statement-breakpoint
ALTER TABLE api.protocol_training DROP COLUMN status, DROP COLUMN trained_at;
--> statement-breakpoint
DROP FUNCTION api.record_protocol_training(uuid, text, text, timestamptz, text);
--> statement-breakpoint
CREATE FUNCTION api.assign_protocol_training(
  p_protocol_record_id uuid, p_user_id text,
  p_due_at timestamptz DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS api.protocol_training
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.protocol_training;
  r api.records;
BEGIN
 IF p_protocol_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_protocol_record_id,'edit'); END IF;
  SELECT * INTO r FROM api.records
   WHERE id = p_protocol_record_id AND deleted_at IS NULL;
  IF r.id IS NULL
     OR r.kind <> 'protocol_template'
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id) THEN
    RAISE EXCEPTION 'protocol denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = r.workspace_id AND m.user_id = p_user_id
       AND m.suspended_at IS NULL AND m.role <> 'client_viewer'
  ) THEN
    RAISE EXCEPTION 'person is not a workspace member' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.protocol_training (
    workspace_id, protocol_record_id, user_id, due_at, notes, created_by_user_id
  ) VALUES (
    r.workspace_id, r.id, p_user_id, p_due_at, nullif(btrim(p_notes), ''), api.current_user_id()
  )
  ON CONFLICT (protocol_record_id, user_id) DO UPDATE SET
    due_at = excluded.due_at,
    notes = excluded.notes,
    updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.assign_protocol_training(uuid, text, timestamptz, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.assign_protocol_training(uuid, text, timestamptz, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.assign_protocol_training(uuid, text, timestamptz, text) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.unassign_protocol_training(p_protocol_record_id uuid, p_user_id text)
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.records;
BEGIN
 IF p_protocol_record_id IS NOT NULL THEN PERFORM internal.assert_object_access('record',p_protocol_record_id,'edit'); END IF;
  SELECT * INTO r FROM api.records
   WHERE id = p_protocol_record_id AND deleted_at IS NULL;
  IF r.id IS NULL
     OR r.kind <> 'protocol_template'
     OR api.current_workspace_id() IS DISTINCT FROM r.workspace_id
     OR NOT api.is_workspace_writer(r.workspace_id) THEN
    RAISE EXCEPTION 'protocol denied' USING ERRCODE = '42501';
  END IF;
  -- Training already acknowledged stays on record; only the expectation goes.
  DELETE FROM api.protocol_training
   WHERE protocol_record_id = r.id AND user_id = p_user_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.unassign_protocol_training(uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.unassign_protocol_training(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.unassign_protocol_training(uuid, text) TO authenticated;
--> statement-breakpoint
-- A person acknowledging a version puts themselves on the protocol's roster,
-- so a later version reaches them.
CREATE OR REPLACE FUNCTION api.acknowledge_protocol_version(p_version_id uuid)
RETURNS api.protocol_acknowledgements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.protocol_versions;
  v_row api.protocol_acknowledgements;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR NOT api.is_workspace_writer(v_version.workspace_id) THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.protocol_acknowledgements(workspace_id, protocol_version_id, user_id)
  VALUES (v_version.workspace_id, v_version.id, api.current_user_id())
  ON CONFLICT (protocol_version_id, user_id) DO NOTHING;
  INSERT INTO api.protocol_training(workspace_id, protocol_record_id, user_id, created_by_user_id)
  VALUES (v_version.workspace_id, v_version.protocol_record_id, api.current_user_id(), api.current_user_id())
  ON CONFLICT (protocol_record_id, user_id) DO NOTHING;
  SELECT * INTO v_row FROM api.protocol_acknowledgements
    WHERE protocol_version_id = v_version.id AND user_id = api.current_user_id();
  RETURN v_row;
END $$;
--> statement-breakpoint
-- Training given in person: someone who can edit the protocol records that a
-- colleague has been trained on an exact version. It is the same record as the
-- colleague acknowledging it themselves, with the trainer's name beside it.
CREATE FUNCTION api.record_protocol_trained(
  p_version_id uuid, p_user_id text, p_notes text DEFAULT NULL
) RETURNS api.protocol_acknowledgements
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.protocol_versions;
  v_row api.protocol_acknowledgements;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR NOT api.is_workspace_writer(v_version.workspace_id) THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', v_version.protocol_record_id, 'edit');
  IF v_version.status NOT IN ('in_review', 'effective') THEN
    RAISE EXCEPTION 'this version is not open for training' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = v_version.workspace_id AND m.user_id = p_user_id
       AND m.suspended_at IS NULL AND m.role <> 'client_viewer'
  ) THEN
    RAISE EXCEPTION 'person is not a workspace member' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.protocol_acknowledgements(
    workspace_id, protocol_version_id, user_id, recorded_by_user_id, notes)
  VALUES (v_version.workspace_id, v_version.id, p_user_id,
          CASE WHEN p_user_id = api.current_user_id() THEN NULL ELSE api.current_user_id() END,
          nullif(btrim(p_notes), ''))
  ON CONFLICT (protocol_version_id, user_id) DO NOTHING;
  INSERT INTO api.protocol_training(workspace_id, protocol_record_id, user_id, created_by_user_id)
  VALUES (v_version.workspace_id, v_version.protocol_record_id, p_user_id, api.current_user_id())
  ON CONFLICT (protocol_record_id, user_id) DO NOTHING;
  SELECT * INTO v_row FROM api.protocol_acknowledgements
    WHERE protocol_version_id = v_version.id AND user_id = p_user_id;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.record_protocol_trained(uuid, text, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.record_protocol_trained(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.record_protocol_trained(uuid, text, text) TO authenticated;
--> statement-breakpoint
-- Where each person stands on a protocol: one row per person on the roster or
-- who has acknowledged any version. `trained` means they acknowledged the
-- current version (the effective one, else the one in review), the same fact
-- starting an experiment checks.
CREATE VIEW api.protocol_training_status WITH (security_invoker = true) AS
WITH current_version AS (
  SELECT DISTINCT ON (v.protocol_record_id)
         v.protocol_record_id, v.id AS version_id, v.version
    FROM api.protocol_versions v
   WHERE v.status IN ('effective', 'in_review')
   ORDER BY v.protocol_record_id, (v.status = 'effective') DESC, v.version DESC
), people AS (
  SELECT t.workspace_id, t.protocol_record_id, t.user_id FROM api.protocol_training t
  UNION
  SELECT v.workspace_id, v.protocol_record_id, a.user_id
    FROM api.protocol_acknowledgements a
    JOIN api.protocol_versions v ON v.id = a.protocol_version_id
)
SELECT p.workspace_id,
       p.protocol_record_id,
       p.user_id,
       cv.version_id AS current_version_id,
       cv.version AS current_version,
       last_ack.protocol_version_id AS trained_version_id,
       last_ack.version AS trained_version,
       last_ack.acknowledged_at AS trained_at,
       last_ack.recorded_by_user_id,
       t.due_at,
       t.notes,
       CASE WHEN cv.version_id IS NULL THEN 'no_effective_version'
            WHEN cur_ack.id IS NOT NULL THEN 'trained'
            WHEN last_ack.protocol_version_id IS NOT NULL THEN 'out_of_date'
            ELSE 'required' END AS status,
       (t.due_at IS NOT NULL AND t.due_at < now()
        AND cv.version_id IS NOT NULL AND cur_ack.id IS NULL) AS overdue
  FROM people p
  LEFT JOIN api.protocol_training t
         ON t.protocol_record_id = p.protocol_record_id AND t.user_id = p.user_id
  LEFT JOIN current_version cv ON cv.protocol_record_id = p.protocol_record_id
  LEFT JOIN api.protocol_acknowledgements cur_ack
         ON cur_ack.protocol_version_id = cv.version_id AND cur_ack.user_id = p.user_id
  LEFT JOIN LATERAL (
    SELECT a.protocol_version_id, a.acknowledged_at, a.recorded_by_user_id, pv.version
      FROM api.protocol_acknowledgements a
      JOIN api.protocol_versions pv ON pv.id = a.protocol_version_id
     WHERE pv.protocol_record_id = p.protocol_record_id AND a.user_id = p.user_id
     ORDER BY pv.version DESC
     LIMIT 1
  ) last_ack ON true;
--> statement-breakpoint
ALTER VIEW api.protocol_training_status OWNER TO migrator;
--> statement-breakpoint
GRANT SELECT ON api.protocol_training_status TO authenticated;
