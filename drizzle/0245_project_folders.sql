-- UI port — create project folders and move records between them.

CREATE OR REPLACE FUNCTION internal.can_edit_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM api.projects p
    WHERE p.id = p_project_id
      AND p.workspace_id = api.current_workspace_id()
      AND api.is_workspace_member(p.workspace_id)
      AND (
        p.lead_user_id = api.current_user_id()
        OR EXISTS (
          SELECT 1 FROM api.workspace_memberships m
          WHERE m.workspace_id = p.workspace_id
            AND m.user_id = api.current_user_id()
            AND m.role IN ('owner', 'admin')
        )
        OR EXISTS (
          SELECT 1 FROM api.project_access pa
          WHERE pa.project_id = p.id
            AND pa.user_id = api.current_user_id()
            AND pa.access_level IN ('owner', 'editor')
        )
      )
  )
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_project_folder(
  p_project_id uuid,
  p_name text,
  p_parent_id uuid DEFAULT NULL
)
RETURNS api.folders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v api.folders;
BEGIN
  SELECT workspace_id INTO v_workspace FROM api.projects WHERE id = p_project_id;
  IF v_workspace IS NULL OR NOT internal.can_edit_project(p_project_id) THEN
    RAISE EXCEPTION 'project editor required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'folder name must be 1–120 characters' USING ERRCODE = '22023';
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.folders f
    WHERE f.id = p_parent_id AND f.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'parent folder not in this project' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.folders (workspace_id, project_id, parent_id, identifier, name)
  VALUES (v_workspace, p_project_id, p_parent_id,
          internal.next_display_id(v_workspace, 'folder'), btrim(p_name))
  RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_project_folder(uuid, text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_project_folder(uuid, text, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.move_records_to_folder(
  p_project_id uuid,
  p_record_ids uuid[],
  p_folder_id uuid
)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  IF NOT internal.can_edit_project(p_project_id) THEN
    RAISE EXCEPTION 'project editor required' USING ERRCODE = '42501';
  END IF;
  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.folders f
    WHERE f.id = p_folder_id AND f.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'folder not in this project' USING ERRCODE = '42501';
  END IF;
  UPDATE api.records r
     SET folder_id = p_folder_id,
         metadata_version = metadata_version + 1,
         updated_at = now(),
         updated_by_user_id = api.current_user_id()
   WHERE r.id = ANY (p_record_ids)
     AND r.project_id = p_project_id
     AND r.deleted_at IS NULL
     AND r.locked_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.move_records_to_folder(uuid, uuid[], uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.move_records_to_folder(uuid, uuid[], uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
