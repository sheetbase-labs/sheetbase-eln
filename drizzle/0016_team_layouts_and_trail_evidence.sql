-- Two things the multiplex workspace needs a backend for.
--
-- Team layouts: a saved pane arrangement (destinations and tiling, never
-- history or data) that the whole workspace can open, not just the browser it
-- was saved in. Anyone who can write saves one; only its author or a workspace
-- administrator replaces or removes it.
--
-- Trail evidence: the path someone took through the app, saved against a
-- record as part of its evidence. It is append-only: a saved trail is never
-- edited, and who saved it and when are fixed by the server.

CREATE TABLE api.workspace_layouts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    layout jsonb NOT NULL,
    created_by_user_id text,
    updated_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_layouts_pkey PRIMARY KEY (id),
    CONSTRAINT chk_workspace_layouts_name CHECK (length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT chk_workspace_layouts_layout CHECK (jsonb_typeof(layout) = 'object' AND pg_column_size(layout) < 32768)
);
--> statement-breakpoint
ALTER TABLE api.workspace_layouts OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.workspace_layouts
    ADD CONSTRAINT workspace_layouts_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.workspace_layouts
    ADD CONSTRAINT workspace_layouts_created_by_user_id_user_id_fk FOREIGN KEY (created_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY api.workspace_layouts
    ADD CONSTRAINT workspace_layouts_updated_by_user_id_user_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_workspace_layouts_name ON api.workspace_layouts USING btree (workspace_id, lower(btrim(name)));
--> statement-breakpoint
ALTER TABLE api.workspace_layouts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_layouts_select ON api.workspace_layouts FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.workspace_layouts TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.save_team_layout(p_name text, p_layout jsonb) RETURNS api.workspace_layouts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace uuid := api.current_workspace_id();
  v_existing api.workspace_layouts;
  v_row api.workspace_layouts;
BEGIN
  IF v_workspace IS NULL OR NOT api.is_workspace_writer(v_workspace) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'a layout name of 1 to 80 characters is required' USING ERRCODE = '22023';
  END IF;
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' OR pg_column_size(p_layout) >= 32768 THEN
    RAISE EXCEPTION 'a layout must be an object under 32 KB' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM api.workspace_layouts
   WHERE workspace_id = v_workspace AND lower(btrim(name)) = lower(btrim(p_name)) FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.created_by_user_id IS DISTINCT FROM api.current_user_id()
       AND NOT api.has_capability(v_workspace, 'workspace.admin') THEN
      RAISE EXCEPTION 'a team layout with this name belongs to someone else' USING ERRCODE = '42501';
    END IF;
    UPDATE api.workspace_layouts
       SET layout = p_layout, name = btrim(p_name), updated_at = now(), updated_by_user_id = api.current_user_id()
     WHERE id = v_existing.id RETURNING * INTO v_row;
  ELSE
    INSERT INTO api.workspace_layouts (workspace_id, name, layout, created_by_user_id, updated_by_user_id)
    VALUES (v_workspace, btrim(p_name), p_layout, api.current_user_id(), api.current_user_id())
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_team_layout(p_name text, p_layout jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_team_layout(p_name text, p_layout jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_team_layout(p_name text, p_layout jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.delete_team_layout(p_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.workspace_layouts;
BEGIN
  SELECT * INTO v_row FROM api.workspace_layouts
   WHERE id = p_id AND workspace_id = api.current_workspace_id() FOR UPDATE;
  IF v_row.id IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'team layout not found' USING ERRCODE = '42501';
  END IF;
  IF v_row.created_by_user_id IS DISTINCT FROM api.current_user_id()
     AND NOT api.has_capability(v_row.workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only its author or a workspace administrator can remove a team layout' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.workspace_layouts WHERE id = v_row.id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.delete_team_layout(p_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.delete_team_layout(p_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.delete_team_layout(p_id uuid) TO authenticated;
--> statement-breakpoint

CREATE TABLE api.trail_evidence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    steps jsonb NOT NULL,
    note text,
    saved_by_user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trail_evidence_pkey PRIMARY KEY (id),
    CONSTRAINT chk_trail_evidence_steps CHECK (jsonb_typeof(steps) = 'array' AND jsonb_array_length(steps) BETWEEN 1 AND 200),
    CONSTRAINT chk_trail_evidence_note CHECK (note IS NULL OR length(note) <= 500)
);
--> statement-breakpoint
ALTER TABLE api.trail_evidence OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.trail_evidence
    ADD CONSTRAINT trail_evidence_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.trail_evidence
    ADD CONSTRAINT trail_evidence_record_id_records_id_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.trail_evidence
    ADD CONSTRAINT trail_evidence_saved_by_user_id_user_id_fk FOREIGN KEY (saved_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX idx_trail_evidence_record ON api.trail_evidence USING btree (record_id, created_at);
--> statement-breakpoint
CREATE FUNCTION internal.trail_evidence_immutable() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION 'a saved trail is evidence and cannot be changed' USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trail_evidence_immutable() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER trail_evidence_immutable BEFORE UPDATE ON api.trail_evidence
    FOR EACH ROW EXECUTE FUNCTION internal.trail_evidence_immutable();
--> statement-breakpoint
ALTER TABLE api.trail_evidence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trail_evidence_select ON api.trail_evidence FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id) AND internal.can_access_object('record', record_id, 'view')));
--> statement-breakpoint
GRANT SELECT ON TABLE api.trail_evidence TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.save_trail_evidence(p_record_id uuid, p_steps jsonb, p_note text DEFAULT NULL::text) RETURNS api.trail_evidence
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_step jsonb;
  v_row api.trail_evidence;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id AND workspace_id = api.current_workspace_id();
  IF v_record.id IS NULL OR NOT api.is_workspace_writer(v_record.workspace_id)
     OR NOT internal.can_access_object('record', v_record.id, 'edit') THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = '42501';
  END IF;
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' OR jsonb_array_length(p_steps) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'a trail of 1 to 200 steps is required' USING ERRCODE = '22023';
  END IF;
  FOR v_step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(v_step) <> 'object'
       OR coalesce(v_step->>'href', '') !~ '^/[^/]'
       OR length(v_step->>'href') > 500
       OR length(coalesce(v_step->>'title', '')) NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'each trail step needs an in-app address and a title' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_note IS NOT NULL AND length(p_note) > 500 THEN
    RAISE EXCEPTION 'a note is at most 500 characters' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.trail_evidence (workspace_id, record_id, steps, note, saved_by_user_id)
  VALUES (v_record.workspace_id, v_record.id, p_steps, nullif(btrim(p_note), ''), api.current_user_id())
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update', v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'trail_evidence', 'trailId', v_row.id, 'steps', jsonb_array_length(p_steps)));
  RETURN v_row;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.save_trail_evidence(p_record_id uuid, p_steps jsonb, p_note text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.save_trail_evidence(p_record_id uuid, p_steps jsonb, p_note text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.save_trail_evidence(p_record_id uuid, p_steps jsonb, p_note text) TO authenticated;
