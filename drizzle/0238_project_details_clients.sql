-- PROJ-01.1 — clients, project details and stable display ids.

-- Workspace-scoped display-id sequence, never reused.
CREATE OR REPLACE FUNCTION internal.next_display_id(p_workspace_id uuid, p_kind text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_width integer;
  v_number bigint;
BEGIN
  v_prefix := CASE p_kind WHEN 'project' THEN 'PRJ' WHEN 'client' THEN 'CL'
                          ELSE upper(left(p_kind, 3)) END;
  v_width := CASE p_kind WHEN 'client' THEN 3 ELSE 4 END;
  INSERT INTO internal.id_sequences (workspace_id, kind, last_number)
  VALUES (p_workspace_id, 'display:' || p_kind, 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = internal.id_sequences.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || lpad(v_number::text, v_width, '0');
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.assign_project_display_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.display_id IS NULL THEN
    NEW.display_id := internal.next_display_id(NEW.workspace_id, 'project');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER projects_assign_display_id
  BEFORE INSERT ON api.projects
  FOR EACH ROW EXECUTE FUNCTION internal.assign_project_display_id();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.assign_client_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
    NEW.code := internal.next_display_id(NEW.workspace_id, 'client');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER clients_assign_code
  BEFORE INSERT ON api.clients
  FOR EACH ROW EXECUTE FUNCTION internal.assign_client_code();
--> statement-breakpoint

ALTER TABLE api.clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY clients_select ON api.clients FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id));
--> statement-breakpoint
CREATE POLICY clients_insert ON api.clients FOR INSERT TO authenticated
  WITH CHECK (workspace_id = api.current_workspace_id() AND api.is_workspace_writer(workspace_id));
--> statement-breakpoint
CREATE POLICY clients_update ON api.clients FOR UPDATE TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_writer(workspace_id))
  WITH CHECK (workspace_id = api.current_workspace_id() AND api.is_workspace_writer(workspace_id));
--> statement-breakpoint
CREATE POLICY clients_delete ON api.clients FOR DELETE TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_writer(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON api.clients TO authenticated;
--> statement-breakpoint

DROP FUNCTION IF EXISTS api.create_project(text);
--> statement-breakpoint
CREATE FUNCTION api.create_project(
  p_title text,
  p_client_id uuid DEFAULT NULL,
  p_modality text DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_lead_user_id text DEFAULT NULL,
  p_default_reviewer_user_id text DEFAULT NULL,
  p_agreement_reference text DEFAULT NULL,
  p_started_on date DEFAULT NULL
)
RETURNS api.projects
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_base text;
  v_key text;
  v_suffix int := 1;
  v_row api.projects;
BEGIN
  v_workspace_id := api.current_workspace_id();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;

  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.clients c WHERE c.id = p_client_id AND c.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'client not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_lead_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v_workspace_id AND m.user_id = p_lead_user_id
  ) THEN
    RAISE EXCEPTION 'lead is not a workspace member' USING ERRCODE = '42501';
  END IF;
  IF p_default_reviewer_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v_workspace_id AND m.user_id = p_default_reviewer_user_id
  ) THEN
    RAISE EXCEPTION 'default reviewer is not a workspace member' USING ERRCODE = '42501';
  END IF;

  p_title := btrim(coalesce(p_title, ''));
  v_base := lower(regexp_replace(regexp_replace(p_title, '[^a-zA-Z0-9]+', '-', 'g'), '^-+|-+$', '', 'g'));
  IF v_base = '' THEN
    v_base := 'project';
  END IF;

  v_key := v_base;
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM api.projects p WHERE p.workspace_id = v_workspace_id AND p.key = v_key
    );
    v_suffix := v_suffix + 1;
    v_key := v_base || '-' || v_suffix;
  END LOOP;

  IF p_title = '' THEN
    p_title := v_key;
  END IF;

  INSERT INTO api.projects (
    workspace_id, key, title, client_id, modality, stage, lead_user_id,
    default_reviewer_user_id, agreement_reference, started_on
  ) VALUES (
    v_workspace_id, v_key, p_title, p_client_id, p_modality, p_stage,
    p_lead_user_id, p_default_reviewer_user_id, p_agreement_reference, p_started_on
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_project(text, uuid, text, text, text, text, text, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_project(text, uuid, text, text, text, text, text, date) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.update_project_details(
  p_project_id uuid,
  p_expected_revision bigint,
  p_title text DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_modality text DEFAULT NULL,
  p_stage text DEFAULT NULL,
  p_lead_user_id text DEFAULT NULL,
  p_default_reviewer_user_id text DEFAULT NULL,
  p_agreement_reference text DEFAULT NULL,
  p_started_on date DEFAULT NULL
)
RETURNS api.projects
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row api.projects;
BEGIN
  SELECT * INTO v_row FROM api.projects WHERE id = p_project_id FOR UPDATE;
  IF v_row.id IS NULL
     OR v_row.workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale project revision' USING ERRCODE = 'SB001';
  END IF;
  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.clients c WHERE c.id = p_client_id AND c.workspace_id = v_row.workspace_id
  ) THEN
    RAISE EXCEPTION 'client not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_lead_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id = v_row.workspace_id AND m.user_id = p_lead_user_id
  ) THEN
    RAISE EXCEPTION 'lead is not a workspace member' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) NOT BETWEEN 1 AND 300 THEN
    RAISE EXCEPTION 'project title must be 1–300 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE api.projects SET
    title = btrim(p_title),
    client_id = p_client_id,
    modality = p_modality,
    stage = p_stage,
    lead_user_id = p_lead_user_id,
    default_reviewer_user_id = p_default_reviewer_user_id,
    agreement_reference = p_agreement_reference,
    started_on = p_started_on,
    revision = revision + 1,
    updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_project_details(uuid, bigint, text, uuid, text, text, text, text, text, date) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_project_details(uuid, bigint, text, uuid, text, text, text, text, text, date) TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
