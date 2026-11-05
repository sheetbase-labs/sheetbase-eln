-- Pin anything.
--
-- A pin used to be a project, record, dataset, sheet or notebook template.
-- Instruments, pipelines and saved analyses can now be pinned too. The sidebar
-- lists each pin under the page it belongs to, and each person can fold the
-- pins under any page, so the fold list grows from groups to pages.

ALTER TABLE api.user_favourites
    DROP CONSTRAINT chk_user_favourites_object_kind,
    ADD CONSTRAINT chk_user_favourites_object_kind CHECK (object_kind = ANY (ARRAY[
        'record', 'dataset', 'sheet', 'project', 'notebook_template',
        'instrument', 'pipeline', 'analysis_view'
    ]));
--> statement-breakpoint
ALTER TABLE api.user_preferences
    DROP CONSTRAINT chk_user_preferences_nav_folded,
    ADD CONSTRAINT chk_user_preferences_nav_folded CHECK (
        cardinality(nav_folded) <= 40
        AND array_to_string(nav_folded, ',') ~ '^[a-z-]*(,[a-z-]+)*$'
    );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.set_record_favourite(p_object_kind text, p_object_id uuid, p_favourite boolean) RETURNS timestamp with time zone
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_user_id text;
  v_workspace_id uuid;
  v_created_at timestamptz;
BEGIN
  v_user_id := "api"."current_user_id"();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'set_record_favourite requires an authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind NOT IN ('record', 'dataset', 'sheet', 'project', 'notebook_template',
                           'instrument', 'pipeline', 'analysis_view') THEN
    RAISE EXCEPTION 'unknown favourite-object kind' USING ERRCODE = '22023';
  END IF;

  -- Unpinning removes the caller's own pin before any other check, so a pin
  -- on something since deleted, or in a workspace the caller left, can
  -- always be removed. It never touches anyone else's pins.
  IF NOT p_favourite THEN
    DELETE FROM "api"."user_favourites"
    WHERE user_id = v_user_id
      AND object_kind = p_object_kind
      AND object_id = p_object_id;
    RETURN NULL;
  END IF;

  -- Objects with their own access rules are checked against them; the
  -- workspace-wide ones (templates, instruments, pipelines) need membership.
  IF p_object_kind IN ('record', 'dataset', 'sheet', 'project', 'analysis_view')
     AND NOT internal.can_access_object(
       CASE p_object_kind WHEN 'sheet' THEN 'instance' ELSE p_object_kind END,
       p_object_id, 'view') THEN
    RETURN NULL;
  END IF;
  v_workspace_id := CASE p_object_kind
    WHEN 'record' THEN (
      SELECT r.workspace_id FROM api.records r
      WHERE r.id = p_object_id AND r.deleted_at IS NULL
    )
    WHEN 'dataset' THEN (
      SELECT d.workspace_id FROM api.datasets d WHERE d.id = p_object_id
    )
    WHEN 'sheet' THEN (
      SELECT s.workspace_id FROM api.sheet_instances s WHERE s.id = p_object_id
    )
    WHEN 'project' THEN (
      SELECT p.workspace_id FROM api.projects p WHERE p.id = p_object_id
    )
    WHEN 'notebook_template' THEN (
      SELECT t.workspace_id FROM api.notebook_templates t WHERE t.id = p_object_id
    )
    WHEN 'instrument' THEN (
      SELECT i.workspace_id FROM api.instruments i WHERE i.id = p_object_id
    )
    WHEN 'pipeline' THEN (
      SELECT d.workspace_id FROM api.pipeline_definitions d WHERE d.id = p_object_id
    )
    WHEN 'analysis_view' THEN (
      SELECT v.workspace_id FROM api.analysis_views v WHERE v.id = p_object_id
    )
  END;

  -- Unknown objects, and ones whose workspace the caller cannot see, are
  -- ignored rather than raising: a pin must never disturb the page.
  IF v_workspace_id IS NULL OR NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "api"."user_favourites"
    (workspace_id, user_id, object_kind, object_id, created_at)
  VALUES
    (v_workspace_id, v_user_id, p_object_kind, p_object_id, now())
  -- Pinning again keeps the original time, so it does not jump the list.
  ON CONFLICT (user_id, object_kind, object_id)
  DO UPDATE SET workspace_id = EXCLUDED.workspace_id
  RETURNING created_at INTO v_created_at;
  RETURN v_created_at;
END;
$$;
