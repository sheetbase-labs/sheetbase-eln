-- Legal holds.
--
-- A legal hold freezes records: while a hold is active, the records it covers
-- cannot be archived or deleted by anyone, whatever role they have and whatever
-- retention rule says. A hold covers every record of a project, every record
-- of one model, both together (that model's records in that project), and/or
-- records picked one by one. Releasing a hold lifts the freeze; the hold stays
-- on file with who released it and why.
--
-- Retention and legal holds are a lab choice (Settings > General, "Retention
-- and legal holds"). The database refuses to archive a held record whether or
-- not the choice is on, so a hold can never be bypassed by switching it off.

ALTER TABLE api.workspace_settings
    ADD COLUMN retention_enabled boolean DEFAULT false NOT NULL;
--> statement-breakpoint

CREATE TABLE api.legal_holds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    reason text,
    project_id uuid,
    kind text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by_user_id text NOT NULL,
    released_at timestamp with time zone,
    released_by_user_id text,
    release_note text,
    CONSTRAINT legal_holds_pkey PRIMARY KEY (id),
    CONSTRAINT legal_holds_project_fkey FOREIGN KEY (project_id) REFERENCES api.projects(id),
    CONSTRAINT chk_legal_holds_name CHECK (length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT chk_legal_holds_reason CHECK (reason IS NULL OR length(reason) <= 2000),
    CONSTRAINT chk_legal_holds_release CHECK ((released_at IS NULL) = (released_by_user_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE api.legal_holds OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX legal_holds_active_idx ON api.legal_holds (workspace_id) WHERE released_at IS NULL;
--> statement-breakpoint

CREATE TABLE api.legal_hold_records (
    hold_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    record_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    added_by_user_id text NOT NULL,
    CONSTRAINT legal_hold_records_pkey PRIMARY KEY (hold_id, record_id),
    CONSTRAINT legal_hold_records_hold_fkey FOREIGN KEY (hold_id) REFERENCES api.legal_holds(id) ON DELETE CASCADE,
    CONSTRAINT legal_hold_records_record_fkey FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.legal_hold_records OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX legal_hold_records_record_idx ON api.legal_hold_records (record_id);
--> statement-breakpoint

ALTER TABLE api.legal_holds ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.legal_hold_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The reason for a hold can be sensitive, so only people who can see Settings
-- > General read the holds. Everyone else only learns that a record is held
-- (api.is_record_on_hold).
CREATE POLICY legal_holds_select ON api.legal_holds FOR SELECT TO authenticated
    USING (api.has_settings_access(workspace_id, 'general', 'view'));
--> statement-breakpoint
CREATE POLICY legal_hold_records_select ON api.legal_hold_records FOR SELECT TO authenticated
    USING (api.has_settings_access(workspace_id, 'general', 'view'));
--> statement-breakpoint
GRANT SELECT ON TABLE api.legal_holds, api.legal_hold_records TO authenticated;
--> statement-breakpoint

-- The name of an active hold covering a record, or null when it is free.
CREATE FUNCTION internal.record_hold_name(
    p_workspace_id uuid, p_record_id uuid, p_project_id uuid, p_kind text)
RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT h.name
    FROM api.legal_holds h
   WHERE h.workspace_id = p_workspace_id
     AND h.released_at IS NULL
     AND ((h.project_id IS NULL AND h.kind IS NULL) IS NOT TRUE
          AND (h.project_id IS NULL OR h.project_id = p_project_id)
          AND (h.kind IS NULL OR h.kind = p_kind)
          OR EXISTS (SELECT 1 FROM api.legal_hold_records hr
                      WHERE hr.hold_id = h.id AND hr.record_id = p_record_id))
   ORDER BY h.created_at
   LIMIT 1
$$;
--> statement-breakpoint
ALTER FUNCTION internal.record_hold_name(uuid, uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_hold_name(uuid, uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION internal.legal_hold_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NOT ((OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL)
              OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  v_name := internal.record_hold_name(OLD.workspace_id, OLD.id, OLD.project_id, OLD.kind);
  IF v_name IS NOT NULL THEN
    RAISE EXCEPTION 'this record is under a legal hold and cannot be archived or deleted' USING ERRCODE = 'SB301';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.legal_hold_guard() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.legal_hold_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER records_legal_hold_guard BEFORE UPDATE OR DELETE ON api.records
    FOR EACH ROW EXECUTE FUNCTION internal.legal_hold_guard();
--> statement-breakpoint

-- A project under a hold cannot be archived either.
CREATE FUNCTION internal.legal_hold_project_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR (OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL))
     AND EXISTS (SELECT 1 FROM api.legal_holds h
                  WHERE h.workspace_id = OLD.workspace_id AND h.released_at IS NULL
                    AND h.project_id = OLD.id) THEN
    RAISE EXCEPTION 'this project is under a legal hold and cannot be archived or deleted' USING ERRCODE = 'SB301';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.legal_hold_project_guard() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.legal_hold_project_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER projects_legal_hold_guard BEFORE UPDATE OR DELETE ON api.projects
    FOR EACH ROW EXECUTE FUNCTION internal.legal_hold_project_guard();
--> statement-breakpoint

CREATE FUNCTION api.set_retention_enabled(p_workspace_id uuid, p_enabled boolean) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid retention setting' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, retention_enabled, created_by_user_id)
  VALUES (p_workspace_id, p_enabled, api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET retention_enabled = p_enabled, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'retention', 'retentionEnabled', v.retention_enabled));
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_retention_enabled(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_retention_enabled(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_retention_enabled(uuid, boolean) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.create_legal_hold(
    p_name text, p_reason text DEFAULT NULL, p_project_id uuid DEFAULT NULL,
    p_kind text DEFAULT NULL, p_record_ids uuid[] DEFAULT '{}')
RETURNS api.legal_holds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_hold api.legal_holds;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_project_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.projects p WHERE p.id = p_project_id AND p.workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.record_models m WHERE m.workspace_id = v_workspace_id AND m.key = p_kind) THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF p_project_id IS NULL AND p_kind IS NULL AND coalesce(cardinality(p_record_ids), 0) = 0 THEN
    RAISE EXCEPTION 'choose what the hold covers' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.legal_holds (workspace_id, name, reason, project_id, kind, created_by_user_id)
  VALUES (v_workspace_id, btrim(p_name), nullif(btrim(p_reason), ''), p_project_id, p_kind, api.current_user_id())
  RETURNING * INTO v_hold;
  IF coalesce(cardinality(p_record_ids), 0) > 0 THEN
    PERFORM api.add_records_to_legal_hold(v_hold.id, p_record_ids);
  END IF;
  PERFORM internal.emit_change_event(v_workspace_id, 'workspace_settings', v_hold.id, 'create', NULL, p_project_id,
    jsonb_build_object('effect', 'legal_hold', 'holdId', v_hold.id, 'name', v_hold.name));
  RETURN v_hold;
END $$;
--> statement-breakpoint

CREATE FUNCTION api.add_records_to_legal_hold(p_hold_id uuid, p_record_ids uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_count integer;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.legal_holds h
                  WHERE h.id = p_hold_id AND h.workspace_id = v_workspace_id AND h.released_at IS NULL) THEN
    RAISE EXCEPTION 'hold not found or already released' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.legal_hold_records (hold_id, workspace_id, record_id, added_by_user_id)
  SELECT p_hold_id, v_workspace_id, r.id, api.current_user_id()
    FROM api.records r
   WHERE r.workspace_id = v_workspace_id AND r.id = ANY (p_record_ids)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;
--> statement-breakpoint

CREATE FUNCTION api.release_legal_hold(p_hold_id uuid, p_note text DEFAULT NULL) RETURNS api.legal_holds
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_hold api.legal_holds;
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  UPDATE api.legal_holds
     SET released_at = now(), released_by_user_id = api.current_user_id(),
         release_note = nullif(btrim(p_note), '')
   WHERE id = p_hold_id AND workspace_id = v_workspace_id AND released_at IS NULL
  RETURNING * INTO v_hold;
  IF v_hold.id IS NULL THEN
    RAISE EXCEPTION 'hold not found or already released' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.emit_change_event(v_workspace_id, 'workspace_settings', v_hold.id, 'update', NULL, v_hold.project_id,
    jsonb_build_object('effect', 'legal_hold_released', 'holdId', v_hold.id, 'name', v_hold.name));
  RETURN v_hold;
END $$;
--> statement-breakpoint

-- How many records each hold covers right now.
CREATE FUNCTION api.legal_hold_counts() RETURNS TABLE (hold_id uuid, records bigint)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.has_settings_access(v_workspace_id, 'general', 'view') THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  RETURN QUERY
  SELECT h.id,
         (SELECT count(*) FROM api.records r
           WHERE r.workspace_id = h.workspace_id AND r.deleted_at IS NULL
             AND (((h.project_id IS NULL AND h.kind IS NULL) IS NOT TRUE
                   AND (h.project_id IS NULL OR r.project_id = h.project_id)
                   AND (h.kind IS NULL OR r.kind = h.kind))
                  OR EXISTS (SELECT 1 FROM api.legal_hold_records hr
                              WHERE hr.hold_id = h.id AND hr.record_id = r.id)))
    FROM api.legal_holds h
   WHERE h.workspace_id = v_workspace_id;
END $$;
--> statement-breakpoint

-- Whether a record is frozen, for anyone who can see it.
CREATE FUNCTION api.is_record_on_hold(p_record_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT internal.record_hold_name(r.workspace_id, r.id, r.project_id, r.kind) IS NOT NULL
    FROM api.records r
   WHERE r.id = p_record_id AND api.is_workspace_member(r.workspace_id)
$$;
--> statement-breakpoint

ALTER FUNCTION api.create_legal_hold(text, text, uuid, text, uuid[]) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.add_records_to_legal_hold(uuid, uuid[]) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.release_legal_hold(uuid, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.legal_hold_counts() OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.is_record_on_hold(uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_legal_hold(text, text, uuid, text, uuid[]), api.add_records_to_legal_hold(uuid, uuid[]), api.release_legal_hold(uuid, text), api.legal_hold_counts(), api.is_record_on_hold(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_legal_hold(text, text, uuid, text, uuid[]), api.add_records_to_legal_hold(uuid, uuid[]), api.release_legal_hold(uuid, text), api.legal_hold_counts(), api.is_record_on_hold(uuid) TO authenticated;
