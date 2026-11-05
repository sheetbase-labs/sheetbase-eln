-- Biological registry. A governed list of the things a lab makes and keeps
-- using: constructs (plasmids and other DNA), cell lines and antibodies.
--
-- Every entry gets a registry number that is never reused or edited (CON-0001,
-- CL-0001, AB-0001), so a plate, a freezer box or a paper can name exactly one
-- thing. Before an entry is added the app asks for a duplicate check: the same
-- sequence, the same name, or the same vendor and catalogue number is reported
-- and the person either uses the existing entry or registers it again on
-- purpose. Entries are retired, never deleted.
--
-- An entry can name the entries it came from (a plasmid's vector and insert, a
-- cell line's parent line and the construct it was transfected with), which is
-- the lineage, and can be linked to the samples and records that use it.

CREATE TABLE api.registry_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    kind text NOT NULL,
    number integer NOT NULL,
    registry_id text NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'active' NOT NULL,
    -- What is particular to the kind (host species, clone, vector and so on).
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- What the duplicate check compares: a hash of the sequence for a construct,
    -- the cleaned-up name for a cell line, vendor and catalogue number or clone
    -- for an antibody.
    fingerprint text,
    retired_reason text,
    retired_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registry_entries_pkey PRIMARY KEY (id),
    CONSTRAINT uq_registry_entries_number UNIQUE (workspace_id, kind, number),
    CONSTRAINT uq_registry_entries_registry_id UNIQUE (workspace_id, registry_id),
    CONSTRAINT registry_entries_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_registry_entries_kind CHECK (kind IN ('construct', 'cell_line', 'antibody')),
    CONSTRAINT chk_registry_entries_status CHECK (status IN ('active', 'retired')),
    CONSTRAINT chk_registry_entries_name CHECK (btrim(name) <> ''),
    CONSTRAINT chk_registry_entries_details CHECK (jsonb_typeof(details) = 'object' AND pg_column_size(details) < 16384)
);
--> statement-breakpoint
ALTER TABLE api.registry_entries OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_registry_entries_list ON api.registry_entries (workspace_id, kind, number DESC);
--> statement-breakpoint
CREATE INDEX idx_registry_entries_fingerprint ON api.registry_entries (workspace_id, kind, fingerprint) WHERE fingerprint IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_registry_entries_name ON api.registry_entries (workspace_id, kind, lower(btrim(name)));
--> statement-breakpoint

-- Where an entry came from. One row per parent, with the part it played.
CREATE TABLE api.registry_parents (
    entry_id uuid NOT NULL,
    parent_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    role text DEFAULT 'parent' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registry_parents_pkey PRIMARY KEY (entry_id, parent_id),
    CONSTRAINT registry_parents_entry_fk FOREIGN KEY (entry_id) REFERENCES api.registry_entries(id) ON DELETE CASCADE,
    CONSTRAINT registry_parents_parent_fk FOREIGN KEY (parent_id) REFERENCES api.registry_entries(id) ON DELETE CASCADE,
    CONSTRAINT registry_parents_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT chk_registry_parents_self CHECK (entry_id <> parent_id),
    CONSTRAINT chk_registry_parents_role CHECK (role IN ('parent', 'vector', 'insert', 'backbone', 'transfected_with', 'clone_of'))
);
--> statement-breakpoint
ALTER TABLE api.registry_parents OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_registry_parents_parent ON api.registry_parents (parent_id);
--> statement-breakpoint

-- Samples, lots and other records that use an entry.
CREATE TABLE api.registry_uses (
    entry_id uuid NOT NULL,
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    linked_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT registry_uses_pkey PRIMARY KEY (entry_id, record_id),
    CONSTRAINT registry_uses_entry_fk FOREIGN KEY (entry_id) REFERENCES api.registry_entries(id) ON DELETE CASCADE,
    CONSTRAINT registry_uses_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT registry_uses_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE api.registry_uses OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_registry_uses_record ON api.registry_uses (record_id);
--> statement-breakpoint

ALTER TABLE api.registry_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.registry_parents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.registry_uses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY registry_entries_select ON api.registry_entries FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY registry_parents_select ON api.registry_parents FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY registry_uses_select ON api.registry_uses FOR SELECT TO authenticated
    USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.registry_entries TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.registry_parents TO authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE api.registry_uses TO authenticated;
--> statement-breakpoint

-- Entries that look like the one being added, best match first. "exact" is the
-- same fingerprint (same sequence, same vendor and catalogue number); "name" is
-- the same name once case and spacing are ignored.
CREATE FUNCTION api.registry_find_duplicates(p_kind text, p_name text, p_fingerprint text DEFAULT NULL, p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, registry_id text, name text, status text, match text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id, e.registry_id, e.name, e.status,
         CASE WHEN p_fingerprint IS NOT NULL AND e.fingerprint = p_fingerprint THEN 'exact' ELSE 'name' END
    FROM api.registry_entries e
   WHERE e.workspace_id = v_workspace_id
     AND e.kind = p_kind
     AND (p_exclude_id IS NULL OR e.id <> p_exclude_id)
     AND ((p_fingerprint IS NOT NULL AND e.fingerprint = p_fingerprint)
          OR lower(btrim(e.name)) = lower(btrim(coalesce(p_name, ''))))
   ORDER BY (p_fingerprint IS NOT NULL AND e.fingerprint = p_fingerprint) DESC, e.number;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.registry_find_duplicates(p_kind text, p_name text, p_fingerprint text, p_exclude_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.registry_find_duplicates(p_kind text, p_name text, p_fingerprint text, p_exclude_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.registry_find_duplicates(p_kind text, p_name text, p_fingerprint text, p_exclude_id uuid) TO authenticated;
--> statement-breakpoint

-- Add an entry. Fails with SB012 when it duplicates an existing one unless the
-- caller says to register it anyway.
CREATE FUNCTION api.create_registry_entry(
    p_kind text, p_name text, p_description text DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb,
    p_fingerprint text DEFAULT NULL,
    p_parents jsonb DEFAULT '[]'::jsonb, p_allow_duplicate boolean DEFAULT false)
RETURNS api.registry_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_entry api.registry_entries;
  v_number integer;
  v_prefix text;
  v_parent jsonb;
  v_parent_id uuid;
  v_dup text;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('construct', 'cell_line', 'antibody') THEN
    RAISE EXCEPTION 'an entry is a construct, a cell line or an antibody' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'give the entry a name' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('registry:' || v_workspace_id::text || ':' || p_kind, 0));

  IF NOT coalesce(p_allow_duplicate, false) THEN
    SELECT string_agg(d.registry_id, ', ') INTO v_dup
      FROM api.registry_find_duplicates(p_kind, p_name, p_fingerprint) d;
    IF v_dup IS NOT NULL THEN
      RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
    END IF;
  END IF;

  v_prefix := CASE p_kind WHEN 'construct' THEN 'CON' WHEN 'cell_line' THEN 'CL' ELSE 'AB' END;
  SELECT coalesce(max(number), 0) + 1 INTO v_number
    FROM api.registry_entries WHERE workspace_id = v_workspace_id AND kind = p_kind;

  INSERT INTO api.registry_entries
    (workspace_id, kind, number, registry_id, name, description, details, fingerprint,
     created_by, updated_by)
  VALUES
    (v_workspace_id, p_kind, v_number, v_prefix || '-' || lpad(v_number::text, 4, '0'),
     btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
     coalesce(p_details, '{}'::jsonb), nullif(p_fingerprint, ''),
     api.current_user_id(), api.current_user_id())
  RETURNING * INTO v_entry;

  FOR v_parent IN SELECT * FROM jsonb_array_elements(coalesce(p_parents, '[]'::jsonb)) LOOP
    v_parent_id := (v_parent ->> 'id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM api.registry_entries WHERE id = v_parent_id AND workspace_id = v_workspace_id) THEN
      RAISE EXCEPTION 'parent entry not found' USING ERRCODE = 'SB036';
    END IF;
    INSERT INTO api.registry_parents (entry_id, parent_id, workspace_id, role)
    VALUES (v_entry.id, v_parent_id, v_workspace_id, coalesce(nullif(v_parent ->> 'role', ''), 'parent'))
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN v_entry;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_registry_entry(p_kind text, p_name text, p_description text, p_details jsonb, p_fingerprint text, p_parents jsonb, p_allow_duplicate boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_registry_entry(p_kind text, p_name text, p_description text, p_details jsonb, p_fingerprint text, p_parents jsonb, p_allow_duplicate boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.create_registry_entry(p_kind text, p_name text, p_description text, p_details jsonb, p_fingerprint text, p_parents jsonb, p_allow_duplicate boolean) TO authenticated;
--> statement-breakpoint

-- Change an entry's name, notes or details. The number and kind never change.
CREATE FUNCTION api.update_registry_entry(
    p_id uuid, p_name text, p_description text, p_details jsonb,
    p_fingerprint text DEFAULT NULL)
RETURNS api.registry_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_entry api.registry_entries;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF btrim(coalesce(p_name, '')) = '' THEN
    RAISE EXCEPTION 'give the entry a name' USING ERRCODE = '22023';
  END IF;
  UPDATE api.registry_entries
     SET name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         details = coalesce(p_details, '{}'::jsonb),
         fingerprint = nullif(p_fingerprint, ''),
         updated_by = api.current_user_id(),
         updated_at = now()
   WHERE id = p_id AND workspace_id = v_workspace_id
  RETURNING * INTO v_entry;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  RETURN v_entry;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.update_registry_entry(p_id uuid, p_name text, p_description text, p_details jsonb, p_fingerprint text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.update_registry_entry(p_id uuid, p_name text, p_description text, p_details jsonb, p_fingerprint text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.update_registry_entry(p_id uuid, p_name text, p_description text, p_details jsonb, p_fingerprint text) TO authenticated;
--> statement-breakpoint

-- Retire an entry (or bring it back). It keeps its number and its lineage.
CREATE FUNCTION api.set_registry_entry_status(p_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS api.registry_entries
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_entry api.registry_entries;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('active', 'retired') THEN
    RAISE EXCEPTION 'an entry is active or retired' USING ERRCODE = '22023';
  END IF;
  UPDATE api.registry_entries
     SET status = p_status,
         retired_reason = CASE WHEN p_status = 'retired' THEN nullif(btrim(coalesce(p_reason, '')), '') END,
         retired_at = CASE WHEN p_status = 'retired' THEN now() END,
         updated_by = api.current_user_id(),
         updated_at = now()
   WHERE id = p_id AND workspace_id = v_workspace_id
  RETURNING * INTO v_entry;
  IF v_entry.id IS NULL THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  RETURN v_entry;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_registry_entry_status(p_id uuid, p_status text, p_reason text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_registry_entry_status(p_id uuid, p_status text, p_reason text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_registry_entry_status(p_id uuid, p_status text, p_reason text) TO authenticated;
--> statement-breakpoint

-- Name where an entry came from. Refuses a loop (an entry cannot descend from
-- its own descendant).
CREATE FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text DEFAULT 'parent')
RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF p_entry_id = p_parent_id THEN
    RAISE EXCEPTION 'an entry cannot come from itself' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM api.registry_entries
       WHERE workspace_id = v_workspace_id AND id IN (p_entry_id, p_parent_id)) <> 2 THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  IF EXISTS (
    WITH RECURSIVE down AS (
      SELECT entry_id FROM api.registry_parents WHERE parent_id = p_entry_id
      UNION
      SELECT rp.entry_id FROM api.registry_parents rp JOIN down d ON rp.parent_id = d.entry_id
    ) SELECT 1 FROM down WHERE entry_id = p_parent_id
  ) THEN
    RAISE EXCEPTION 'that would make the entry come from its own descendant' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.registry_parents (entry_id, parent_id, workspace_id, role)
  VALUES (p_entry_id, p_parent_id, v_workspace_id, coalesce(nullif(p_role, ''), 'parent'))
  ON CONFLICT (entry_id, parent_id) DO UPDATE SET role = EXCLUDED.role;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_registry_parent(p_entry_id uuid, p_parent_id uuid, p_role text) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.registry_parents
   WHERE entry_id = p_entry_id AND parent_id = p_parent_id AND workspace_id = v_workspace_id;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.remove_registry_parent(p_entry_id uuid, p_parent_id uuid) TO authenticated;
--> statement-breakpoint

-- Link a sample, lot or other record to an entry, or take the link away.
CREATE FUNCTION api.set_registry_use(p_entry_id uuid, p_record_id uuid, p_linked boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.registry_entries WHERE id = p_entry_id AND workspace_id = v_workspace_id) THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  IF coalesce(p_linked, true) THEN
    IF NOT EXISTS (SELECT 1 FROM api.records WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL) THEN
      RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
    END IF;
    INSERT INTO api.registry_uses (entry_id, record_id, workspace_id, linked_by)
    VALUES (p_entry_id, p_record_id, v_workspace_id, api.current_user_id())
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM api.registry_uses WHERE entry_id = p_entry_id AND record_id = p_record_id AND workspace_id = v_workspace_id;
  END IF;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_registry_use(p_entry_id uuid, p_record_id uuid, p_linked boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_registry_use(p_entry_id uuid, p_record_id uuid, p_linked boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_registry_use(p_entry_id uuid, p_record_id uuid, p_linked boolean) TO authenticated;
