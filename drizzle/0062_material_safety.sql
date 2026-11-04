-- Chemical safety on materials. A material carries its GHS hazard pictograms, signal
-- word and hazard statements, and a safety data sheet (SDS) file. The lot page, the
-- registry, printed labels and any protocol that uses the material show them.
--
-- A lot is a material record, and every lot of one chemical shares its title, so the
-- hazard information is saved once and applied to all of them by default. A
-- replacement lot (including one received from a reorder) inherits it.

CREATE TABLE api.material_safety (
    record_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    -- GHS01 .. GHS09, in the order the person picked them.
    pictograms text[] DEFAULT '{}'::text[] NOT NULL,
    signal_word text,
    -- H and EUH codes ("H225", "EUH066"); the wording lives in the app so it can be
    -- shown in the person's language.
    hazard_statements text[] DEFAULT '{}'::text[] NOT NULL,
    sds_file_object_id uuid,
    updated_by text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT material_safety_pkey PRIMARY KEY (record_id),
    CONSTRAINT material_safety_record_fk FOREIGN KEY (record_id) REFERENCES api.records(id) ON DELETE CASCADE,
    CONSTRAINT material_safety_workspace_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT material_safety_sds_fk FOREIGN KEY (sds_file_object_id) REFERENCES api.file_objects(id) ON DELETE SET NULL,
    CONSTRAINT chk_material_safety_pictograms CHECK (
      pictograms <@ ARRAY['GHS01','GHS02','GHS03','GHS04','GHS05','GHS06','GHS07','GHS08','GHS09']::text[]
      AND cardinality(pictograms) <= 9),
    CONSTRAINT chk_material_safety_signal_word CHECK (signal_word IS NULL OR signal_word IN ('danger', 'warning')),
    CONSTRAINT chk_material_safety_statements CHECK (
      cardinality(hazard_statements) <= 60
      AND array_to_string(hazard_statements, ',') ~ '^((H[2-4][0-9]{2}[A-Za-z]{0,2}|EUH[0-9]{3}[A-Za-z]?)(,|$))*$')
);
--> statement-breakpoint
ALTER TABLE api.material_safety OWNER TO migrator;
--> statement-breakpoint
CREATE INDEX idx_material_safety_workspace ON api.material_safety (workspace_id);
--> statement-breakpoint
ALTER TABLE api.material_safety ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Whoever can see the material can see its hazards (the records policy applies to
-- the sub-select).
CREATE POLICY material_safety_select ON api.material_safety FOR SELECT TO authenticated
    USING (api.is_workspace_member(workspace_id)
           AND EXISTS (SELECT 1 FROM api.records r WHERE r.id = material_safety.record_id));
--> statement-breakpoint
GRANT SELECT ON TABLE api.material_safety TO authenticated;
--> statement-breakpoint

-- Save the hazard information of a material. By default it applies to every lot of
-- the same material in the same project.
CREATE FUNCTION api.set_material_safety(p_record_id uuid, p_pictograms text[], p_signal_word text, p_hazard_statements text[], p_all_lots boolean DEFAULT true) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_source api.records;
  v_pictograms text[];
  v_statements text[];
  v_signal text;
  v_target record;
  v_count integer := 0;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_source FROM api.records
   WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'material not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.kind <> 'material' THEN
    RAISE EXCEPTION 'only a material carries hazard information' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');

  v_signal := nullif(btrim(coalesce(p_signal_word, '')), '');
  IF v_signal IS NOT NULL THEN
    v_signal := lower(v_signal);
  END IF;
  -- Keep the order the person picked, drop repeats and blanks.
  SELECT coalesce(array_agg(x ORDER BY ord), '{}'::text[]) INTO v_pictograms
    FROM (SELECT DISTINCT ON (x) x, ord
            FROM unnest(coalesce(p_pictograms, '{}'::text[])) WITH ORDINALITY AS u(x, ord)
           WHERE nullif(btrim(x), '') IS NOT NULL
           ORDER BY x, ord) d;
  SELECT coalesce(array_agg(x ORDER BY ord), '{}'::text[]) INTO v_statements
    FROM (SELECT DISTINCT ON (x) x, ord
            FROM unnest(coalesce(p_hazard_statements, '{}'::text[])) WITH ORDINALITY AS u(x, ord)
           WHERE nullif(btrim(x), '') IS NOT NULL
           ORDER BY x, ord) d;

  FOR v_target IN
    SELECT r.id, r.project_id
      FROM api.records r
     WHERE r.workspace_id = v_workspace_id
       AND r.kind = 'material'
       AND r.deleted_at IS NULL
       AND (r.id = p_record_id
            OR (coalesce(p_all_lots, true)
                AND r.project_id IS NOT DISTINCT FROM v_source.project_id
                AND lower(btrim(r.title)) = lower(btrim(v_source.title))))
  LOOP
    IF v_target.id <> p_record_id THEN
      IF NOT internal.can_access_object('record', v_target.id, 'edit') THEN CONTINUE; END IF;
    END IF;
    INSERT INTO api.material_safety
      (record_id, workspace_id, pictograms, signal_word, hazard_statements, updated_by, updated_at)
    VALUES (v_target.id, v_workspace_id, v_pictograms, v_signal, v_statements, api.current_user_id(), now())
    ON CONFLICT (record_id) DO UPDATE
      SET pictograms = EXCLUDED.pictograms,
          signal_word = EXCLUDED.signal_word,
          hazard_statements = EXCLUDED.hazard_statements,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;
    PERFORM internal.emit_change_event(v_workspace_id, 'material', v_target.id, 'update',
      v_target.id, v_target.project_id,
      jsonb_build_object('action', 'safety-updated', 'pictograms', to_jsonb(v_pictograms),
                         'signalWord', v_signal));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_material_safety(p_record_id uuid, p_pictograms text[], p_signal_word text, p_hazard_statements text[], p_all_lots boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_material_safety(p_record_id uuid, p_pictograms text[], p_signal_word text, p_hazard_statements text[], p_all_lots boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_material_safety(p_record_id uuid, p_pictograms text[], p_signal_word text, p_hazard_statements text[], p_all_lots boolean) TO authenticated;
--> statement-breakpoint

-- Attach (or, with no file, remove) the safety data sheet of a material. The file is
-- one already uploaded to the workspace.
CREATE FUNCTION api.set_material_sds(p_record_id uuid, p_file_object_id uuid, p_all_lots boolean DEFAULT true) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_workspace_id uuid := api.current_workspace_id();
  v_source api.records;
  v_target record;
  v_count integer := 0;
BEGIN IF api.has_capability(v_workspace_id, 'work.samples') IS NOT TRUE THEN RAISE EXCEPTION 'not permitted: needs work.samples' USING ERRCODE = '42501'; END IF; -- capability-guard
  IF v_workspace_id IS NULL OR NOT api.is_workspace_writer(v_workspace_id) THEN
    RAISE EXCEPTION 'caller cannot write to the active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_source FROM api.records
   WHERE id = p_record_id AND workspace_id = v_workspace_id AND deleted_at IS NULL;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'material not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.kind <> 'material' THEN
    RAISE EXCEPTION 'only a material carries a safety data sheet' USING ERRCODE = '22023';
  END IF;
  PERFORM internal.assert_object_access('record', p_record_id, 'edit');
  IF p_file_object_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM api.file_objects f
        WHERE f.id = p_file_object_id AND f.workspace_id = v_workspace_id AND f.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'file not found' USING ERRCODE = 'SB036';
  END IF;

  FOR v_target IN
    SELECT r.id, r.project_id
      FROM api.records r
     WHERE r.workspace_id = v_workspace_id
       AND r.kind = 'material'
       AND r.deleted_at IS NULL
       AND (r.id = p_record_id
            OR (coalesce(p_all_lots, true)
                AND r.project_id IS NOT DISTINCT FROM v_source.project_id
                AND lower(btrim(r.title)) = lower(btrim(v_source.title))))
  LOOP
    IF v_target.id <> p_record_id THEN
      IF NOT internal.can_access_object('record', v_target.id, 'edit') THEN CONTINUE; END IF;
    END IF;
    INSERT INTO api.material_safety
      (record_id, workspace_id, sds_file_object_id, updated_by, updated_at)
    VALUES (v_target.id, v_workspace_id, p_file_object_id, api.current_user_id(), now())
    ON CONFLICT (record_id) DO UPDATE
      SET sds_file_object_id = EXCLUDED.sds_file_object_id,
          updated_by = EXCLUDED.updated_by,
          updated_at = EXCLUDED.updated_at;
    PERFORM internal.emit_change_event(v_workspace_id, 'material', v_target.id, 'update',
      v_target.id, v_target.project_id,
      jsonb_build_object('action', CASE WHEN p_file_object_id IS NULL THEN 'sds-removed' ELSE 'sds-attached' END));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.set_material_sds(p_record_id uuid, p_file_object_id uuid, p_all_lots boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_material_sds(p_record_id uuid, p_file_object_id uuid, p_all_lots boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_material_sds(p_record_id uuid, p_file_object_id uuid, p_all_lots boolean) TO authenticated;
--> statement-breakpoint

-- A replacement lot keeps the hazard information and safety data sheet.
CREATE OR REPLACE FUNCTION api.register_replacement_lot(p_reagent_record_id uuid, p_lot text, p_expiry date, p_quantity numeric, p_unit text DEFAULT NULL::text, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_source api.records;
  v_properties jsonb;
  v_unit text;
  v_replacement api.records;
BEGIN
  SELECT * INTO v_source FROM api.records
   WHERE id = p_reagent_record_id AND deleted_at IS NULL
   FOR UPDATE;
  IF v_source.id IS NULL THEN
    RAISE EXCEPTION 'record not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_source.kind <> 'material' THEN
    RAISE EXCEPTION 'not a material' USING ERRCODE = '22023';
  END IF;
  IF NOT api.is_workspace_writer(v_source.workspace_id) THEN
    RAISE EXCEPTION 'capability required: workspace write' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.assert_object_access('record', p_reagent_record_id, 'edit');

  IF p_lot IS NULL OR length(btrim(p_lot)) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'a lot number is required' USING ERRCODE = '22023';
  END IF;
  IF p_lot IS NOT DISTINCT FROM v_source.properties->>'lot' THEN
    RAISE EXCEPTION 'the replacement needs a new lot number' USING ERRCODE = '22023';
  END IF;
  IF p_expiry IS NULL THEN
    RAISE EXCEPTION 'an expiry date is required' USING ERRCODE = '22023';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'a positive quantity is required' USING ERRCODE = '22023';
  END IF;

  v_unit := nullif(btrim(coalesce(p_unit, '')), '');
  IF v_unit IS NULL THEN
    v_unit := v_source.properties->>'unit';
  END IF;

  -- Inherit the material identity, replace the lot facts.
  v_properties := (v_source.properties - 'lot' - 'expiry' - 'quantity' - 'unit')
    || jsonb_build_object(
         'lot', btrim(p_lot),
         'expiry', to_char(p_expiry, 'YYYY-MM-DD'),
         'quantity', p_quantity)
    || CASE WHEN v_unit IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('unit', v_unit) END;

  v_replacement := api.create_record(
    v_source.project_id, 'material', v_source.title, 'available', v_source.tags,
    v_properties);

  INSERT INTO api.record_links
    (source_record_id, target_record_id, target_kind, target_identifier, link_type,
     link_metadata, created_by_user_id)
  VALUES (v_source.id, v_replacement.id, 'material', v_replacement.identifier, 'material',
          jsonb_build_object(
            'relation', 'replacement',
            'reason', nullif(btrim(coalesce(p_reason, '')), '')),
          api.current_user_id())
  ON CONFLICT (source_record_id, target_identifier, link_type) DO NOTHING;

  -- The new lot is the same chemical, so it carries the same hazard information
  -- and safety data sheet as the lot it replaces.
  INSERT INTO api.material_safety
    (record_id, workspace_id, pictograms, signal_word, hazard_statements,
     sds_file_object_id, updated_by, updated_at)
  SELECT v_replacement.id, s.workspace_id, s.pictograms, s.signal_word,
         s.hazard_statements, s.sds_file_object_id, s.updated_by, now()
    FROM api.material_safety s
   WHERE s.record_id = v_source.id
  ON CONFLICT (record_id) DO NOTHING;

  RETURN jsonb_build_object(
    'id', v_replacement.id,
    'identifier', v_replacement.identifier,
    'title', v_replacement.title,
    'projectId', v_replacement.project_id,
    'metadataVersion', v_replacement.metadata_version,
    'lot', btrim(p_lot),
    'expiry', to_char(p_expiry, 'YYYY-MM-DD'),
    'quantity', p_quantity,
    'unit', v_unit);
END $$;
--> statement-breakpoint
ALTER FUNCTION api.register_replacement_lot(p_reagent_record_id uuid, p_lot text, p_expiry date, p_quantity numeric, p_unit text, p_reason text) OWNER TO migrator;
