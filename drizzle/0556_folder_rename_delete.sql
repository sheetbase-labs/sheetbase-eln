-- ADMIN-04 — a folder can be renamed and removed once it is empty.

CREATE OR REPLACE FUNCTION api.rename_project_folder(p_folder_id uuid, p_name text)
RETURNS api.folders
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.folders;
BEGIN
  SELECT * INTO v FROM api.folders WHERE id = p_folder_id;
  IF v.id IS NULL OR NOT internal.can_edit_project(v.project_id) THEN
    RAISE EXCEPTION 'project editor required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'folder name must be 1–120 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE api.folders SET name = btrim(p_name) WHERE id = p_folder_id RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.rename_project_folder(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.rename_project_folder(uuid, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.delete_project_folder(p_folder_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v api.folders;
BEGIN
  SELECT * INTO v FROM api.folders WHERE id = p_folder_id;
  IF v.id IS NULL OR NOT internal.can_edit_project(v.project_id) THEN
    RAISE EXCEPTION 'project editor required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM api.records r WHERE r.folder_id = p_folder_id) THEN
    RAISE EXCEPTION 'move the items out of this folder before deleting it' USING ERRCODE = '23503';
  END IF;
  UPDATE api.folders SET parent_id = v.parent_id WHERE parent_id = p_folder_id;
  DELETE FROM api.folders WHERE id = p_folder_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_project_folder(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.delete_project_folder(uuid) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
