-- A registry entry (a construct, cell line, antibody ...) is lab-wide stock,
-- not work inside a project, so it can be made without a project. The table
-- and its row policies already treat a record with no project as visible to
-- the whole workspace and editable by anyone who can write records; only the
-- create function insisted on a project. A registry's lot model is lab-wide
-- too. Every other kind still needs one.
CREATE OR REPLACE FUNCTION api.create_model_record(p_project_id uuid, p_kind text, p_title text, p_status text DEFAULT 'draft'::text, p_tags text[] DEFAULT '{}'::text[], p_properties jsonb DEFAULT '{}'::jsonb, p_custom_fields jsonb DEFAULT '{}'::jsonb) RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  generated_identifier text;
  result api.records;
  v_model api.record_models;
  v_version api.record_model_versions;
  v_defaults jsonb := '{}'::jsonb;
BEGIN
  IF workspace IS NULL THEN RAISE EXCEPTION 'capability required: record.create' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(workspace, 'record.create');
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = workspace AND key = p_kind;
  IF p_project_id IS NULL THEN
    IF v_model.id IS NULL OR NOT (v_model.is_registry OR EXISTS (
         SELECT 1 FROM api.record_models r
          WHERE r.workspace_id = workspace AND r.registry_lot_kind = p_kind)) THEN
      RAISE EXCEPTION 'a record of this type needs a project' USING ERRCODE = '22023';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = workspace) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_model.id IS NOT NULL THEN
    SELECT * INTO v_version FROM api.record_model_versions
      WHERE model_id = v_model.id AND lifecycle = 'published' ORDER BY version DESC LIMIT 1;
    IF v_version.id IS NULL THEN
      RAISE EXCEPTION 'Record Model % has no published version', p_kind USING ERRCODE = 'SB108';
    END IF;
    SELECT coalesce(jsonb_object_agg(f->>'field_name', f->'default_value'), '{}'::jsonb)
      INTO v_defaults
      FROM jsonb_array_elements(coalesce(v_version.definition->'fields', '[]'::jsonb)) f
      WHERE f ? 'default_value' AND f->'default_value' IS NOT NULL AND f->'default_value' <> 'null'::jsonb;
  END IF;
  generated_identifier := CASE WHEN v_model.id IS NOT NULL THEN api.next_record_model_identifier(v_model.id) ELSE api.next_record_identifier(workspace, p_kind) END;
  INSERT INTO api.records(
    workspace_id, project_id, kind, identifier, title, status, tags, properties,
    custom_fields, model_version_id, created_by_user_id
  ) VALUES (
    workspace, p_project_id, p_kind, generated_identifier,
    coalesce(nullif(btrim(p_title), ''), generated_identifier), p_status,
    coalesce(p_tags, '{}'), coalesce(p_properties, '{}'),
    v_defaults || coalesce(p_custom_fields, '{}'), v_version.id, api.current_user_id()
  ) RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
COMMENT ON FUNCTION api.create_model_record(p_project_id uuid, p_kind text, p_title text, p_status text, p_tags text[], p_properties jsonb, p_custom_fields jsonb) IS 'MDL-01 step 2: create a record of a built-in kind or a workspace-owned record model. A workspace model assigns its own prefix identifier and validates custom_fields against the model''s active record_field_definitions. p_project_id may be null only for a registry model or a registry lot model: their records are lab-wide.';
--> statement-breakpoint
-- The pipeline action row follows the declaration: the project may be empty.
UPDATE internal.pipeline_actions
   SET definition = jsonb_set(
         definition, '{arguments}',
         (SELECT jsonb_agg(CASE WHEN a ->> 'name' = 'p_project_id' THEN a || '{"nullable":true}'::jsonb ELSE a END ORDER BY ord)
            FROM jsonb_array_elements(definition -> 'arguments') WITH ORDINALITY AS x(a, ord)))
 WHERE operation = 'create_model_record';
