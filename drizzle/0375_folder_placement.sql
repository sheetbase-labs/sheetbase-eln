-- PROJ-04.1 — folder placement for every object kind, and a move that refuses
-- cross-project moves.
--
-- The Folders tab lists notebooks, sheets, datasets, analyses and pipelines, but
-- only `api.records` has `folder_id`. Records keep that column (existing readers
-- and the folder tree depend on it); every other kind is placed here, one folder
-- per object, and the move RPC enforces that an object only ever lands in a
-- folder of its own project.
ALTER TABLE api.folder_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS folder_items_select ON api.folder_items;
--> statement-breakpoint
CREATE POLICY folder_items_select ON api.folder_items
  FOR SELECT TO authenticated
  USING (
    workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(workspace_id)
  );
--> statement-breakpoint
GRANT SELECT ON api.folder_items TO authenticated;
--> statement-breakpoint

-- The project an object belongs to, so a move can refuse a cross-project home.
-- Records are placed through records.folder_id, so they are not accepted here.
CREATE OR REPLACE FUNCTION internal.folder_object_project(p_kind text, p_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_kind
    WHEN 'sheet_instance' THEN (SELECT si.project_id FROM api.sheet_instances si WHERE si.id = p_id)
    WHEN 'dataset' THEN (SELECT d.primary_project_id FROM api.datasets d WHERE d.id = p_id)
    -- Analyses and pipelines have no project of their own, so they may sit in any
    -- folder of the workspace; the project rule below only binds objects that do.
    WHEN 'analysis_view' THEN NULL
    WHEN 'pipeline_definition' THEN NULL
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.folder_object_project(text,uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.folder_object_project(text,uuid) TO authenticated;
--> statement-breakpoint

-- Move a batch of objects into one folder (or out of every folder with NULL).
CREATE OR REPLACE FUNCTION api.move_to_folder(p_items jsonb, p_folder_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_folder api.folders;
  v_item jsonb;
  v_kind text;
  v_id uuid;
  v_project uuid;
  v_moved integer := 0;
BEGIN
  IF v_workspace IS NULL OR NOT api.is_workspace_writer(v_workspace) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'a non-empty batch of items is required' USING ERRCODE = '22023';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    SELECT * INTO v_folder FROM api.folders
     WHERE id = p_folder_id AND workspace_id = v_workspace AND archived_at IS NULL;
    IF v_folder.id IS NULL THEN
      RAISE EXCEPTION 'folder not found in active workspace' USING ERRCODE = '42501';
    END IF;
  END IF;

  FOR v_item IN SELECT element FROM jsonb_array_elements(p_items) element LOOP
    v_kind := v_item->>'kind';
    v_id := nullif(v_item->>'id', '')::uuid;
    IF v_kind IS NULL OR v_id IS NULL OR v_kind NOT IN
      ('sheet_instance', 'dataset', 'analysis_view', 'pipeline_definition') THEN
      RAISE EXCEPTION 'unsupported folder item' USING ERRCODE = '22023';
    END IF;
    -- The object must exist in this workspace, whatever kind it is.
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT si.id FROM api.sheet_instances si
         WHERE v_kind = 'sheet_instance' AND si.id = v_id AND si.workspace_id = v_workspace
        UNION ALL
        SELECT d.id FROM api.datasets d
         WHERE v_kind = 'dataset' AND d.id = v_id AND d.workspace_id = v_workspace
        UNION ALL
        SELECT av.id FROM api.analysis_views av
         WHERE v_kind = 'analysis_view' AND av.id = v_id AND av.workspace_id = v_workspace
        UNION ALL
        SELECT pd.id FROM api.pipeline_definitions pd
         WHERE v_kind = 'pipeline_definition' AND pd.id = v_id AND pd.workspace_id = v_workspace
      ) found
    ) THEN
      RAISE EXCEPTION 'object not found in active workspace' USING ERRCODE = '42501';
    END IF;

    IF p_folder_id IS NULL THEN
      DELETE FROM api.folder_items
       WHERE workspace_id = v_workspace AND object_kind = v_kind AND object_id = v_id;
      v_moved := v_moved + 1;
      CONTINUE;
    END IF;

    v_project := internal.folder_object_project(v_kind, v_id);
    IF v_project IS NOT NULL AND v_project IS DISTINCT FROM v_folder.project_id THEN
      RAISE EXCEPTION 'an object can only move within its own project' USING ERRCODE = 'SB119';
    END IF;
    INSERT INTO api.folder_items(workspace_id, folder_id, object_kind, object_id, created_by_user_id)
    VALUES (v_workspace, v_folder.id, v_kind, v_id, api.current_user_id())
    ON CONFLICT (workspace_id, object_kind, object_id)
    DO UPDATE SET folder_id = excluded.folder_id, updated_at = now();
    v_moved := v_moved + 1;
  END LOOP;

  PERFORM internal.emit_change_event(v_workspace, 'folder', coalesce(p_folder_id, v_workspace), 'move',
    NULL, v_folder.project_id, jsonb_build_object('items', p_items, 'moved', v_moved));
  RETURN v_moved;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.move_to_folder(jsonb,uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.move_to_folder(jsonb,uuid) TO authenticated;
--> statement-breakpoint

-- What sits in a folder, for the Folders tab.
CREATE OR REPLACE FUNCTION api.folder_items_list(p_folder_id uuid)
RETURNS TABLE(object_kind text, object_id uuid, name text, project_id uuid, placed_at timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT fi.object_kind, fi.object_id,
         CASE fi.object_kind
           WHEN 'sheet_instance' THEN (SELECT si.name FROM api.sheet_instances si WHERE si.id = fi.object_id)
           WHEN 'dataset' THEN (SELECT d.name FROM api.datasets d WHERE d.id = fi.object_id)
           WHEN 'analysis_view' THEN (SELECT av.name FROM api.analysis_views av WHERE av.id = fi.object_id)
           WHEN 'pipeline_definition' THEN (SELECT pd.name FROM api.pipeline_definitions pd WHERE pd.id = fi.object_id)
         END,
         fi.workspace_id,
         fi.updated_at
    FROM api.folder_items fi
    JOIN api.folders f ON f.id = fi.folder_id
   WHERE fi.folder_id = p_folder_id
     AND fi.workspace_id = api.current_workspace_id()
     AND api.is_workspace_member(fi.workspace_id)
   ORDER BY fi.object_kind, fi.updated_at DESC
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.folder_items_list(uuid) FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.folder_items_list(uuid) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
