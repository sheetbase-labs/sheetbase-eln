-- SET-01.2 — the remaining record-create paths read the workspace prefixes.
--
-- create_model_record and the internal Sheet-Record helper now assign through
-- api.next_record_identifier, matching api.create_record.

CREATE OR REPLACE FUNCTION api.create_model_record(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_properties jsonb DEFAULT '{}',
  p_custom_fields jsonb DEFAULT '{}'
) RETURNS api.records
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE workspace uuid:=api.current_workspace_id(); generated_identifier text; result api.records;
BEGIN
  IF workspace IS NULL THEN RAISE EXCEPTION 'capability required: record.create' USING ERRCODE='42501'; END IF;
  PERFORM api.require_capability(workspace, 'record.create');
  IF NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=workspace) THEN RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE='42501'; END IF;
  generated_identifier:=api.next_record_identifier(workspace,p_kind);
  INSERT INTO api.records(workspace_id,project_id,kind,identifier,title,status,tags,properties,custom_fields,created_by_user_id)
  VALUES(workspace,p_project_id,p_kind,generated_identifier,coalesce(nullif(btrim(p_title),''),generated_identifier),p_status,coalesce(p_tags,'{}'),coalesce(p_properties,'{}'),coalesce(p_custom_fields,'{}'),api.current_user_id()) RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.create_sheet_model_record(
  p_workspace uuid,
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_custom_fields jsonb
) RETURNS api.records
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  generated_identifier text;
  result api.records;
BEGIN
  generated_identifier := api.next_record_identifier(p_workspace, p_kind);
  INSERT INTO api.records (
    workspace_id, project_id, kind, identifier, title, status, tags, properties,
    custom_fields, created_by_user_id
  ) VALUES (
    p_workspace, p_project_id, p_kind, generated_identifier,
    coalesce(nullif(btrim(p_title), ''), generated_identifier),
    'available', '{}', '{}', coalesce(p_custom_fields, '{}'), api.current_user_id()
  ) RETURNING * INTO result;
  RETURN result;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.create_sheet_model_record(uuid, uuid, text, text, jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
