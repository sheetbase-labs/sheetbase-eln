-- SET-01.2 — Studies assign through the workspace prefixes.
--
-- The Study prefix keeps its historical STD default.

CREATE OR REPLACE FUNCTION api.next_record_identifier(
  p_workspace_id uuid,
  p_kind text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_width integer;
  v_number bigint;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[a-z][a-z0-9_]{0,59}$' THEN
    RAISE EXCEPTION 'unknown record kind' USING ERRCODE = '22023';
  END IF;

  SELECT nullif(btrim(id_prefixes ->> p_kind), '')
    INTO v_prefix
    FROM api.workspace_settings WHERE workspace_id = p_workspace_id;
  v_prefix := coalesce(v_prefix, CASE p_kind
    WHEN 'experiment' THEN 'EXP'
    WHEN 'sample' THEN 'SMP'
    WHEN 'dataset' THEN 'DS'
    WHEN 'protocol_template' THEN 'PRT'
    WHEN 'reagent' THEN 'MAT'
    WHEN 'material' THEN 'MAT'
    WHEN 'analysis' THEN 'AN'
    WHEN 'file' THEN 'FILE'
    WHEN 'notebook_template' THEN 'NBK'
    WHEN 'report' THEN 'RPT'
    WHEN 'study' THEN 'STD'
    ELSE upper(left(p_kind, 3))
  END);
  v_width := CASE p_kind WHEN 'protocol_template' THEN 3 ELSE 4 END;

  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (p_workspace_id, p_kind, 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;

  RETURN v_prefix || '-' || lpad(v_number::text, v_width, '0');
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_study(
  p_workspace_id uuid,p_title text,p_home_project_id uuid DEFAULT NULL,p_summary text DEFAULT NULL,
  p_starts_on date DEFAULT NULL,p_ends_on date DEFAULT NULL,p_custom_fields jsonb DEFAULT '{}'
) RETURNS api.records LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE generated_identifier text; result api.records; actor text:=api.current_user_id();
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'active workspace writer required' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Study title must be 1–300 characters' USING ERRCODE='SB073'; END IF;
  IF p_ends_on IS NOT NULL AND p_starts_on IS NOT NULL AND p_ends_on<p_starts_on THEN RAISE EXCEPTION 'Study end date precedes its start date' USING ERRCODE='SB073'; END IF;
  IF p_home_project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_home_project_id AND workspace_id=p_workspace_id) THEN
    RAISE EXCEPTION 'home Project not found in active workspace' USING ERRCODE='42501';
  END IF;
  generated_identifier := api.next_record_identifier(p_workspace_id, 'study');
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
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
