-- A reviewer of a report's project can generate the report; a viewer still can't.
CREATE OR REPLACE FUNCTION api.generate_report(p_workspace_id uuid, p_report_id uuid, p_output_format text DEFAULT 'html'::text) RETURNS api.report_generations
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
  v_pos int := 0;
  v_gen api.report_generations;
BEGIN
  IF p_report_id IS NOT NULL AND NOT (internal.can_access_object('report',p_report_id,'edit') OR internal.can_access_object('report',p_report_id,'review')) THEN
    RAISE EXCEPTION 'Object access denied' USING ERRCODE='42501';
  END IF;
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
