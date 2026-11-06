-- Chemistry registration. Any registry model (migration 0070) can be told which
-- of its fields holds a drawn structure. Entries of that model then get:
--
--   * a structure duplicate check: the structure is reduced to its parent (salts
--     and solvents stripped, one canonical code) and two entries with the same
--     parent are the same compound, however they were drawn;
--   * lots: one compound, many batches. A lot is an ordinary record of another
--     model (the registry's "lot model") linked to the compound; a salt form of
--     a compound already registered is offered as a new lot, not a repeat;
--   * structure search: substructure and similarity, over the compounds a person
--     may read.
--
-- Nothing here is a hard-coded kind. The model decides; a lab can tick it on a
-- compound model, a reagent model, a fragment library or anything else drawn.
--
-- Plain Postgres: the app reduces a drawing to its parent code and a 512-bit
-- fragment fingerprint (OpenChemLib) and sends both; the database keeps them,
-- enforces the duplicate check and narrows searches by fingerprint. The app then
-- confirms the atom-by-atom match on the few candidates left, so no chemistry
-- extension is needed on the server.

ALTER TABLE api.record_models
    ADD COLUMN registry_structure_field text,
    ADD COLUMN registry_lot_kind text;
--> statement-breakpoint

-- Subtype lookups list the model's columns by name, so they learn the new ones.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.model_descendants(uuid,text)'::regprocedure) INTO v_def;
  IF position('registry_sequence_field' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.model_descendants';
  END IF;
  v_def := replace(v_def, 'registry_sequence_field
    FROM below', 'registry_sequence_field,
         registry_structure_field, registry_lot_kind
    FROM below');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- What the database knows about a drawn structure.
--   parent_code  the canonical code of the parent: largest fragment, charges
--                neutralised, salts and solvents removed. The duplicate key.
--   drawn_code   the canonical code of the structure as it was drawn.
--   salts        what was stripped, as SMILES, for the "as supplied" display.
--   fingerprint  512-bit fragment index of the parent; substructure search
--                keeps rows whose bits include the query's.
CREATE TABLE api.record_structures (
    record_id uuid PRIMARY KEY REFERENCES api.records(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE CASCADE,
    kind text NOT NULL,
    parent_code text NOT NULL,
    drawn_code text NOT NULL,
    formula text,
    mass numeric,
    salts text[] DEFAULT '{}'::text[] NOT NULL,
    fingerprint bit(512) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_record_structures_parent CHECK (parent_code <> '')
);
--> statement-breakpoint
ALTER TABLE api.record_structures OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_record_structures_parent ON api.record_structures (workspace_id, kind, parent_code);
--> statement-breakpoint
ALTER TABLE api.record_structures ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Read exactly what the record itself can be read as; writes only through the
-- functions below.
CREATE POLICY record_structures_select ON api.record_structures FOR SELECT TO authenticated
  USING (workspace_id = api.current_workspace_id() AND api.is_workspace_member(workspace_id)
         AND EXISTS (SELECT 1 FROM api.records r WHERE r.id = record_structures.record_id));
--> statement-breakpoint
CREATE POLICY record_structures_select_api_client ON api.record_structures FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id()
         AND EXISTS (SELECT 1 FROM api.records r WHERE r.id = record_structures.record_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.record_structures TO authenticated, api_client;
--> statement-breakpoint

-- New kinds of thing on the change feed.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  v_def := replace(v_def, '::text]', '::text, ''compound''::text, ''compound_lot''::text]');
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('compound.registered'), ('compound.structure_changed'), ('compound.lot_added');
--> statement-breakpoint

-- Choose the field that holds the drawn structure, and the model that lots are
-- made from. Either can be cleared. The model must already be a registry.
CREATE FUNCTION api.set_model_chemistry(
    p_model_key text, p_structure_field text DEFAULT NULL, p_lot_kind text DEFAULT NULL)
RETURNS api.record_models
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = v_workspace_id AND key = p_model_key;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = 'SB036';
  END IF;
  IF nullif(p_structure_field, '') IS NOT NULL THEN
    IF NOT v_model.is_registry THEN
      RAISE EXCEPTION 'tick the model as a registry first' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM api.record_field_definitions d
                    WHERE d.workspace_id = v_workspace_id AND d.kind = p_model_key
                      AND d.field_name = p_structure_field AND d.lifecycle = 'active') THEN
      RAISE EXCEPTION 'the model has no active field called %', p_structure_field USING ERRCODE = '22023';
    END IF;
  END IF;
  IF nullif(p_lot_kind, '') IS NOT NULL THEN
    IF nullif(p_structure_field, '') IS NULL THEN
      RAISE EXCEPTION 'choose the structure field before the lot model' USING ERRCODE = '22023';
    END IF;
    IF p_lot_kind = p_model_key OR NOT EXISTS (
         SELECT 1 FROM api.record_models m WHERE m.workspace_id = v_workspace_id AND m.key = p_lot_kind) THEN
      RAISE EXCEPTION 'choose another model for lots' USING ERRCODE = '22023';
    END IF;
  END IF;
  UPDATE api.record_models
     SET registry_structure_field = CASE WHEN is_registry THEN nullif(p_structure_field, '') END,
         registry_lot_kind = CASE WHEN is_registry AND nullif(p_structure_field, '') IS NOT NULL
                                  THEN nullif(p_lot_kind, '') END,
         updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_model.id
  RETURNING * INTO v_model;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_model_chemistry(p_model_key text, p_structure_field text, p_lot_kind text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_model_chemistry(p_model_key text, p_structure_field text, p_lot_kind text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_model_chemistry(p_model_key text, p_structure_field text, p_lot_kind text) TO authenticated;
--> statement-breakpoint

-- The fingerprint arrives as 128 hex digits.
CREATE FUNCTION internal.structure_fingerprint(p_hex text) RETURNS bit(512)
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $$
BEGIN
  IF p_hex IS NULL OR p_hex !~ '^[0-9a-fA-F]{128}$' THEN
    RAISE EXCEPTION 'the structure fingerprint must be 128 hex digits' USING ERRCODE = '22023';
  END IF;
  RETURN ('x' || p_hex)::bit(512);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.structure_fingerprint(p_hex text) OWNER TO migrator;
--> statement-breakpoint

-- Entries with the same parent structure as the given one, best match first.
-- same_form: drawn exactly the same way (salt and all); otherwise the entry is
-- the same compound as a different salt or solvate, which is a lot.
CREATE FUNCTION internal.structure_matches(
    p_workspace_id uuid, p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid)
RETURNS TABLE (id uuid, identifier text, title text, archived boolean, same_form boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT r.id, r.identifier, r.title, r.archived_at IS NOT NULL, s.drawn_code = p_drawn_code
    FROM api.record_structures s
    JOIN api.records r ON r.id = s.record_id
   WHERE s.workspace_id = p_workspace_id AND s.kind = p_kind AND s.parent_code = p_parent_code
     AND r.deleted_at IS NULL
     AND (p_exclude_id IS NULL OR r.id <> p_exclude_id)
   ORDER BY 5 DESC, r.identifier
$$;
--> statement-breakpoint
ALTER FUNCTION internal.structure_matches(p_workspace_id uuid, p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.structure_matches(p_workspace_id uuid, p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid) FROM PUBLIC;
--> statement-breakpoint

CREATE FUNCTION api.find_structure_duplicates(p_kind text, p_parent_code text, p_drawn_code text DEFAULT '', p_exclude_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, identifier text, title text, archived boolean, same_form boolean)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
BEGIN
  IF v_workspace_id IS NULL OR NOT api.is_workspace_member(v_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the active workspace' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.structure_matches(v_workspace_id, p_kind, p_parent_code, p_drawn_code, p_exclude_id);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.find_structure_duplicates(p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.find_structure_duplicates(p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.find_structure_duplicates(p_kind text, p_parent_code text, p_drawn_code text, p_exclude_id uuid) TO authenticated;
--> statement-breakpoint

-- The database refuses a second entry with the same parent unless the person
-- registers it again on purpose (the same flag the key-field check uses).
CREATE FUNCTION internal.record_structures_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_dup text;
BEGIN
  IF coalesce(current_setting('sheetbase.registry_allow_duplicate', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  SELECT string_agg(d.identifier, ', ') INTO v_dup
    FROM internal.structure_matches(NEW.workspace_id, NEW.kind, NEW.parent_code, NEW.drawn_code, NEW.record_id) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION 'already in the registry: %', v_dup USING ERRCODE = 'SB012';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.record_structures_guard() OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.record_structures_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER record_structures_guard BEFORE INSERT OR UPDATE OF parent_code ON api.record_structures
    FOR EACH ROW EXECUTE FUNCTION internal.record_structures_guard();
--> statement-breakpoint

-- Keep (or write) the structure row for a record. `p_structure` is
--   {"molfile": "...", "parentCode": "...", "drawnCode": "...", "formula": "C9H8O4",
--    "mass": 180.16, "salts": ["Cl"], "fingerprint": "<128 hex digits>"}
-- The caller has already been allowed to edit the record.
CREATE FUNCTION internal.write_record_structure(p_record_id uuid, p_kind text, p_structure jsonb)
RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid;
  v_new boolean;
BEGIN
  SELECT workspace_id INTO v_workspace_id FROM api.records WHERE id = p_record_id;
  v_new := NOT EXISTS (SELECT 1 FROM api.record_structures WHERE record_id = p_record_id);
  INSERT INTO api.record_structures
    (record_id, workspace_id, kind, parent_code, drawn_code, formula, mass, salts, fingerprint)
  VALUES (p_record_id, v_workspace_id, p_kind,
          p_structure ->> 'parentCode',
          coalesce(nullif(p_structure ->> 'drawnCode', ''), p_structure ->> 'parentCode'),
          nullif(p_structure ->> 'formula', ''),
          nullif(p_structure ->> 'mass', '')::numeric,
          coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p_structure -> 'salts', '[]'::jsonb))), '{}'),
          internal.structure_fingerprint(p_structure ->> 'fingerprint'))
  ON CONFLICT (record_id) DO UPDATE
     SET parent_code = EXCLUDED.parent_code, drawn_code = EXCLUDED.drawn_code,
         formula = EXCLUDED.formula, mass = EXCLUDED.mass, salts = EXCLUDED.salts,
         fingerprint = EXCLUDED.fingerprint, updated_at = now();
  RETURN v_new;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.write_record_structure(p_record_id uuid, p_kind text, p_structure jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.write_record_structure(p_record_id uuid, p_kind text, p_structure jsonb) FROM PUBLIC;
--> statement-breakpoint

-- The same write for a person: they must be able to edit the record. The
-- register and change functions run as the person, so they come through here.
CREATE FUNCTION internal.write_record_structure_checked(p_record_id uuid, p_kind text, p_structure jsonb)
RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM api.records r
                  WHERE r.id = p_record_id AND r.workspace_id = api.current_workspace_id()
                    AND r.kind = p_kind)
     OR NOT internal.can_access_object('record', p_record_id, 'edit') THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  RETURN internal.write_record_structure(p_record_id, p_kind, p_structure);
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.write_record_structure_checked(p_record_id uuid, p_kind text, p_structure jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.write_record_structure_checked(p_record_id uuid, p_kind text, p_structure jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.write_record_structure_checked(p_record_id uuid, p_kind text, p_structure jsonb) TO authenticated;
--> statement-breakpoint

-- A compound entering the registry, or changing parent, reaches webhooks and the
-- stream as compound.registered / compound.structure_changed.
CREATE FUNCTION internal.trg_change_event_compound() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  r api.records;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_code = OLD.parent_code AND NEW.drawn_code = OLD.drawn_code THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM api.records WHERE id = NEW.record_id;
  PERFORM internal.emit_change_event(
    NEW.workspace_id, 'compound', NEW.record_id,
    CASE TG_OP WHEN 'INSERT' THEN 'create' ELSE 'update' END,
    NEW.record_id, r.project_id,
    jsonb_build_object('identifier', r.identifier, 'kind', NEW.kind, 'title', r.title,
                       'formula', NEW.formula, 'mass', NEW.mass,
                       'parentCode', NEW.parent_code, 'salts', to_jsonb(NEW.salts)));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_compound() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_record_structures AFTER INSERT OR UPDATE ON api.record_structures
    FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_compound();
--> statement-breakpoint

-- A lot being linked to its compound is compound.lot_added.
CREATE FUNCTION internal.trg_change_event_compound_lot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  lot api.records;
BEGIN
  IF NEW.link_type <> 'general' OR coalesce(NEW.link_metadata ->> 'role', '') <> 'lot_of' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO lot FROM api.records WHERE id = NEW.source_record_id;
  PERFORM internal.emit_change_event(
    lot.workspace_id, 'compound_lot', lot.id, 'create', lot.id, lot.project_id,
    jsonb_build_object('identifier', lot.identifier, 'compoundId', NEW.target_record_id,
                       'compound', NEW.target_identifier, 'title', lot.title, 'kind', lot.kind));
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_compound_lot() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_compound_lots AFTER INSERT ON api.record_links
    FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_compound_lot();
--> statement-breakpoint

-- The shared look at a registry model that takes structures.
CREATE FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text) RETURNS api.record_models
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_model api.record_models;
BEGIN
  SELECT * INTO v_model FROM api.record_models
   WHERE workspace_id = p_workspace_id AND key = p_kind AND is_registry
     AND registry_structure_field IS NOT NULL;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'that model does not register structures' USING ERRCODE = '22023';
  END IF;
  RETURN v_model;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION internal.chemistry_model(p_workspace_id uuid, p_kind text) TO authenticated;
--> statement-breakpoint

-- Register a compound: the entry, its structure and its duplicate check in one
-- step. Same as create_registry_entry otherwise, so `register anyway` works the
-- same way. A salt form of a compound already there is a lot of it (see
-- add_compound_lot), not a second entry.
CREATE FUNCTION api.register_compound(
    p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_structure jsonb,
    p_allow_duplicate boolean DEFAULT false)
RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_model api.record_models;
  v_result api.records;
BEGIN
  v_model := internal.chemistry_model(v_workspace_id, p_kind);
  IF nullif(p_structure ->> 'molfile', '') IS NULL THEN
    RAISE EXCEPTION 'draw a structure first' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  SELECT * INTO v_result FROM api.create_model_record(
    p_project_id, p_kind, p_title, 'draft', '{}'::text[], '{}'::jsonb,
    coalesce(p_custom_fields, '{}'::jsonb) || jsonb_build_object(v_model.registry_structure_field, p_structure ->> 'molfile'));
  PERFORM internal.write_record_structure_checked(v_result.id, p_kind, p_structure);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_result;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.register_compound(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_structure jsonb, p_allow_duplicate boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.register_compound(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_structure jsonb, p_allow_duplicate boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.register_compound(p_project_id uuid, p_kind text, p_title text, p_custom_fields jsonb, p_structure jsonb, p_allow_duplicate boolean) TO authenticated;
--> statement-breakpoint

-- Change the structure of an entry (or give an older entry its first one). The
-- record must still be editable; `p_expected_metadata_version` guards against a
-- stale page, as for any record edit.
CREATE FUNCTION api.set_record_structure(
    p_record_id uuid, p_expected_metadata_version integer, p_structure jsonb,
    p_allow_duplicate boolean DEFAULT false)
RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_record api.records;
  v_model api.record_models;
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id;
  IF v_record.id IS NULL OR v_record.workspace_id <> api.current_workspace_id() THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  v_model := internal.chemistry_model(v_record.workspace_id, v_record.kind);
  IF nullif(p_structure ->> 'molfile', '') IS NULL THEN
    RAISE EXCEPTION 'draw a structure first' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_allow_duplicate, false) THEN
    PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  END IF;
  SELECT * INTO v_record FROM api.update_record_custom_fields(
    p_record_id, p_expected_metadata_version,
    jsonb_build_object(v_model.registry_structure_field, p_structure ->> 'molfile'));
  PERFORM internal.write_record_structure_checked(p_record_id, v_record.kind, p_structure);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
  RETURN v_record;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_record_structure(p_record_id uuid, p_expected_metadata_version integer, p_structure jsonb, p_allow_duplicate boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_record_structure(p_record_id uuid, p_expected_metadata_version integer, p_structure jsonb, p_allow_duplicate boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_record_structure(p_record_id uuid, p_expected_metadata_version integer, p_structure jsonb, p_allow_duplicate boolean) TO authenticated;
--> statement-breakpoint

-- Search by fingerprint.
--   substructure: parents whose index includes every bit of the query's. This is a
--                 filter, not an answer; the app confirms each candidate.
--   similarity:   Tanimoto of the two indexes, at least `p_min_similarity`,
--                 best first.
-- Reads follow row-level security, so a person only finds what they may read.
CREATE FUNCTION api.query_structures(
    p_fingerprint text, p_mode text DEFAULT 'substructure', p_kind text DEFAULT NULL,
    p_min_similarity numeric DEFAULT 0.5, p_include_archived boolean DEFAULT false,
    p_limit integer DEFAULT 500)
RETURNS TABLE (record_id uuid, identifier text, title text, kind text, parent_code text,
               formula text, mass numeric, salts text[], archived boolean, similarity numeric)
    LANGUAGE plpgsql STABLE
    SET search_path TO ''
    AS $$
DECLARE
  v_query bit(512) := internal.structure_fingerprint(p_fingerprint);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
BEGIN
  IF p_mode NOT IN ('substructure', 'similarity') THEN
    RAISE EXCEPTION 'mode must be substructure or similarity' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT s.record_id, r.identifier, r.title, s.kind, s.parent_code, s.formula, s.mass, s.salts,
         r.archived_at IS NOT NULL,
         CASE WHEN bit_count(s.fingerprint | v_query) = 0 THEN 0::numeric
              ELSE round(bit_count(s.fingerprint & v_query)::numeric / bit_count(s.fingerprint | v_query), 4) END
    FROM api.record_structures s
    JOIN api.records r ON r.id = s.record_id
   WHERE s.workspace_id = api.current_workspace_id()
     AND r.deleted_at IS NULL
     AND (p_include_archived OR r.archived_at IS NULL)
     AND (p_kind IS NULL OR s.kind = p_kind)
     AND (CASE WHEN p_mode = 'substructure' THEN (s.fingerprint & v_query) = v_query
               ELSE bit_count(s.fingerprint & v_query)::numeric
                    >= coalesce(p_min_similarity, 0.5) * greatest(bit_count(s.fingerprint | v_query), 1) END)
   ORDER BY 10 DESC, r.identifier
   LIMIT v_limit;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.query_structures(p_fingerprint text, p_mode text, p_kind text, p_min_similarity numeric, p_include_archived boolean, p_limit integer) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.query_structures(p_fingerprint text, p_mode text, p_kind text, p_min_similarity numeric, p_include_archived boolean, p_limit integer) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.query_structures(p_fingerprint text, p_mode text, p_kind text, p_min_similarity numeric, p_include_archived boolean, p_limit integer) TO authenticated, api_client;
--> statement-breakpoint

-- Lots. A lot is a record of the registry's lot model, filed under the compound's
-- project unless another is named, and linked to its compound
-- with the role `lot_of`. Lots do not need a structure of their own, but a lot
-- model can hold the structure as supplied (the salt form) in any field.
CREATE FUNCTION api.add_compound_lot(
    p_compound_id uuid, p_project_id uuid DEFAULT NULL, p_title text DEFAULT NULL, p_custom_fields jsonb DEFAULT '{}'::jsonb)
RETURNS api.records
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_compound api.records;
  v_model api.record_models;
  v_lot api.records;
BEGIN
  SELECT * INTO v_compound FROM api.records WHERE id = p_compound_id;
  IF v_compound.id IS NULL OR v_compound.workspace_id <> api.current_workspace_id() THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  v_model := internal.chemistry_model(v_compound.workspace_id, v_compound.kind);
  IF v_model.registry_lot_kind IS NULL THEN
    RAISE EXCEPTION 'this registry has no lot model' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_lot FROM api.create_model_record(
    coalesce(p_project_id, v_compound.project_id), v_model.registry_lot_kind,
    coalesce(nullif(btrim(p_title), ''), v_compound.identifier || ' lot'),
    'draft', '{}'::text[], '{}'::jsonb, coalesce(p_custom_fields, '{}'::jsonb));
  INSERT INTO api.record_links (source_record_id, target_record_id, target_kind, target_identifier,
                               link_type, created_by_user_id, link_metadata)
  VALUES (v_lot.id, v_compound.id, v_compound.kind, v_compound.identifier, 'general',
          api.current_user_id(), jsonb_build_object('role', 'lot_of'));
  RETURN v_lot;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.add_compound_lot(p_compound_id uuid, p_project_id uuid, p_title text, p_custom_fields jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.add_compound_lot(p_compound_id uuid, p_project_id uuid, p_title text, p_custom_fields jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.add_compound_lot(p_compound_id uuid, p_project_id uuid, p_title text, p_custom_fields jsonb) TO authenticated;
--> statement-breakpoint

CREATE FUNCTION api.list_compound_lots(p_compound_id uuid)
RETURNS TABLE (id uuid, identifier text, title text, kind text, custom_fields jsonb,
               created_at timestamp with time zone, archived boolean)
    LANGUAGE sql STABLE
    SET search_path TO ''
    AS $$
  SELECT r.id, r.identifier, r.title, r.kind, r.custom_fields, r.created_at, r.archived_at IS NOT NULL
    FROM api.record_links l
    JOIN api.records r ON r.id = l.source_record_id
   WHERE l.target_record_id = p_compound_id AND l.link_type = 'general'
     AND l.link_metadata ->> 'role' = 'lot_of' AND r.deleted_at IS NULL
   ORDER BY r.created_at
$$;
--> statement-breakpoint
ALTER FUNCTION api.list_compound_lots(p_compound_id uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.list_compound_lots(p_compound_id uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.list_compound_lots(p_compound_id uuid) TO authenticated, api_client;
--> statement-breakpoint

-- Give an entry that was added before the model took structures its structure
-- row, without touching the entry itself (it may be retired or locked). Repeats
-- already in the registry are kept. For people who can edit models.
CREATE FUNCTION api.index_record_structure(p_record_id uuid, p_structure jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_record api.records;
BEGIN
  PERFORM api.require_capability(v_workspace_id, 'schema.edit');
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id AND workspace_id = v_workspace_id;
  IF v_record.id IS NULL THEN
    RAISE EXCEPTION 'entry not found' USING ERRCODE = 'SB036';
  END IF;
  PERFORM internal.chemistry_model(v_workspace_id, v_record.kind);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'on', true);
  PERFORM internal.write_record_structure(p_record_id, v_record.kind, p_structure);
  PERFORM set_config('sheetbase.registry_allow_duplicate', 'off', true);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.index_record_structure(p_record_id uuid, p_structure jsonb) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.index_record_structure(p_record_id uuid, p_structure jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.index_record_structure(p_record_id uuid, p_structure jsonb) TO authenticated;
--> statement-breakpoint

-- Pipelines. A pipeline can add a lot to a compound, and the three compound
-- events can start one. Registering from a pipeline is left out: it needs the
-- description of a drawing, which only the app and the structures API make.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''step.result_added'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''step.result_added'',',
    '''step.result_added'', ''compound.registered'', ''compound.structure_changed'', ''compound.lot_added'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"add_compound_lot","rpc":"add_compound_lot","label":"Add a lot to a compound","description":"Make a new lot of a registered compound, linked to it, in the same project.","arguments":[{"name":"p_compound_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_title","type":"text","required":false,"nullable":true},{"name":"p_custom_fields","type":"jsonb","required":false,"nullable":true}]}]$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || '$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
