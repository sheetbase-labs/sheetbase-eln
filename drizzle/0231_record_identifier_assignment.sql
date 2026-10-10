-- SET-01.2 — identifier assignment reads the workspace prefixes.
--
-- The default prefix map follows the v3 design (EXP, SMP, DS, PRT, MAT, …) and
-- protocols pad to three digits; a workspace may override a prefix in
-- workspace_settings.id_prefixes. Numbers come from the never-reused
-- internal.id_sequences counter. api.create_record now assigns through it.

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
    WHEN 'study' THEN 'STY'
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

CREATE OR REPLACE FUNCTION "api"."create_record"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_properties jsonb DEFAULT '{}'
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_identifier text;
  v_row "api"."records";
  v_is_template boolean;
BEGIN
  -- H5: legacy records.kind = notebook_template is removal-compatibility only;
  -- the dynamically injected guard is preserved here.
  PERFORM "internal"."reject_new_legacy_notebook_template"(p_kind);

  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_writer"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;

  -- Templates (protocol_template, notebook_template) are workspace-scoped and
  -- accept a NULL project; everything else must resolve to a workspace project.
  v_is_template := p_kind IN ('protocol_template', 'notebook_template');
  IF NOT v_is_template OR p_project_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "api"."projects" p
      WHERE p.id = p_project_id AND p.workspace_id = v_workspace_id
    ) THEN
      RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_identifier := "api"."next_record_identifier"(v_workspace_id, p_kind);

  p_title := btrim(coalesce(p_title, ''));
  IF p_title = '' THEN
    p_title := v_identifier;
  END IF;

  INSERT INTO "api"."records"
    (workspace_id, project_id, kind, identifier, title, status, tags,
     properties, created_by_user_id)
  VALUES
    (v_workspace_id, p_project_id, p_kind, v_identifier, p_title, p_status,
     p_tags, COALESCE(p_properties, '{}'::jsonb), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
