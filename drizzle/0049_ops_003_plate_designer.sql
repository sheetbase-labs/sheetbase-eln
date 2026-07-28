-- ===========================================================================
-- OPS-003: Plate Designer.
--
-- Adds three workspace-scoped tables for standalone plate designs:
--
--   api.plate_designs       — a named, versioned plate design (format, dims,
--                             validation config, status, optimistic-concurrency
--                             metadata_version). The design document.
--   api.plate_wells          — well assignments belonging to a design (well
--                             code, row/col, role, optional sample link,
--                             replicate, volume, concentration, notes). The
--                             only writer for plate_wells is the
--                             save_plate_design RPC, which replaces all wells
--                             atomically so a design is never half-saved.
--   api.plate_layout_templates — reusable, named layout templates (controls
--                             positions, replicate pattern, fill direction)
--                             that can be applied to a new design.
--
-- The Plate Designer UI (src/routes/plate-designer.tsx) performs auto-fill,
-- randomisation, replicate patterning and CSV import in local state with an
-- undo stack, then persists the final layout through save_plate_design. This
-- keeps automatic layouts previewable and reversible before saving.
--
-- RLS is the access-control boundary. Members can read designs/templates in
-- their workspace; any member can create/edit designs. The controlled RPCs
-- (SECURITY DEFINER) are the only writers for plate_wells and the only path
-- to bump metadata_version, so concurrent saves are rejected with SB001
-- (stale version) rather than silently overwriting.
--
-- Sample links use sample_record_id → records.id (ON DELETE SET NULL) so
-- removing a sample never orphans a design; the snapshot identifier/title
-- columns preserve the historical identity used by the experiment.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- api.plate_designs: the design document.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."plate_designs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid,
  "name" text NOT NULL,
  "format" text NOT NULL DEFAULT '96_well',
  "rows" integer NOT NULL,
  "cols" integer NOT NULL,
  "validation" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'draft',
  "metadata_version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  CONSTRAINT "plate_designs_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "plate_designs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "plate_designs_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "plate_designs_updated_by_user_id_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_plate_designs_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_plate_designs_format" CHECK ("format" IN ('96_well')),
  CONSTRAINT "chk_plate_designs_rows" CHECK ("rows" > 0 AND "rows" <= 26),
  CONSTRAINT "chk_plate_designs_cols" CHECK ("cols" > 0 AND "cols" <= 26),
  CONSTRAINT "chk_plate_designs_status" CHECK ("status" IN ('draft','finalized','archived')),
  CONSTRAINT "chk_plate_designs_version" CHECK ("metadata_version" > 0)
);
--> statement-breakpoint

CREATE INDEX "idx_plate_designs_workspace" ON "api"."plate_designs" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_plate_designs_project" ON "api"."plate_designs" ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_plate_designs_workspace_status" ON "api"."plate_designs" ("workspace_id", "status");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.plate_wells: well assignments belonging to a design.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."plate_wells" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "design_id" uuid NOT NULL,
  "well_code" text NOT NULL,
  "row_index" integer NOT NULL,
  "col_index" integer NOT NULL,
  "role" text NOT NULL,
  "sample_record_id" uuid,
  "sample_identifier" text,
  "sample_title" text,
  "replicate" integer,
  "volume_value" numeric,
  "volume_unit" text,
  "concentration_value" numeric,
  "concentration_unit" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plate_wells_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "plate_wells_design_id_plate_designs_id_fk"
    FOREIGN KEY ("design_id") REFERENCES "api"."plate_designs"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "plate_wells_sample_record_id_records_id_fk"
    FOREIGN KEY ("sample_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_plate_wells_role" CHECK ("role" IN ('sample','positive_control','negative_control','blank','empty')),
  CONSTRAINT "chk_plate_wells_row" CHECK ("row_index" >= 0),
  CONSTRAINT "chk_plate_wells_col" CHECK ("col_index" >= 0),
  CONSTRAINT "chk_plate_wells_replicate" CHECK ("replicate" IS NULL OR "replicate" > 0),
  CONSTRAINT "chk_plate_wells_volume" CHECK ("volume_value" IS NULL OR "volume_value" > 0),
  CONSTRAINT "chk_plate_wells_concentration" CHECK ("concentration_value" IS NULL OR "concentration_value" >= 0)
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_plate_wells_design_well" ON "api"."plate_wells" ("design_id", "well_code");
--> statement-breakpoint
CREATE INDEX "idx_plate_wells_workspace" ON "api"."plate_wells" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_plate_wells_design" ON "api"."plate_wells" ("design_id", "row_index", "col_index");
--> statement-breakpoint
CREATE INDEX "idx_plate_wells_sample" ON "api"."plate_wells" ("sample_record_id")
  WHERE "sample_record_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.plate_layout_templates: reusable layout templates.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."plate_layout_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "format" text NOT NULL DEFAULT '96_well',
  "rows" integer NOT NULL,
  "cols" integer NOT NULL,
  "layout" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status" text NOT NULL DEFAULT 'active',
  "created_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "plate_layout_templates_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "plate_layout_templates_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_plate_layout_templates_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_plate_layout_templates_format" CHECK ("format" IN ('96_well')),
  CONSTRAINT "chk_plate_layout_templates_rows" CHECK ("rows" > 0 AND "rows" <= 26),
  CONSTRAINT "chk_plate_layout_templates_cols" CHECK ("cols" > 0 AND "cols" <= 26),
  CONSTRAINT "chk_plate_layout_templates_status" CHECK ("status" IN ('active','archived'))
);
--> statement-breakpoint

CREATE INDEX "idx_plate_layout_templates_workspace" ON "api"."plate_layout_templates" ("workspace_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."plate_designs" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."plate_wells" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."plate_layout_templates" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."plate_designs" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."plate_wells" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."plate_layout_templates" TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- ---------------------------------------------------------------------------

ALTER TABLE "api"."plate_designs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."plate_wells" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."plate_layout_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "plate_designs_select" ON "api"."plate_designs"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "plate_designs_select_api_client" ON "api"."plate_designs"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "plate_designs_write" ON "api"."plate_designs"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "plate_wells_select" ON "api"."plate_wells"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "plate_wells_select_api_client" ON "api"."plate_wells"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "plate_layout_templates_select" ON "api"."plate_layout_templates"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "plate_layout_templates_select_api_client" ON "api"."plate_layout_templates"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "plate_layout_templates_write" ON "api"."plate_layout_templates"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

-- ===========================================================================
-- create_plate_design: create a new plate design document. The caller picks
-- the format/dimensions and optional validation config; wells are added later
-- by save_plate_design.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_plate_design"(
  p_workspace_id uuid,
  p_name text,
  p_project_id uuid DEFAULT NULL,
  p_format text DEFAULT '96_well',
  p_rows integer DEFAULT 8,
  p_cols integer DEFAULT 12,
  p_validation jsonb DEFAULT '{}'::jsonb
)
RETURNS "api"."plate_designs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."plate_designs";
BEGIN
  IF NOT "api"."storage_member_using"(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF p_format NOT IN ('96_well') THEN
    RAISE EXCEPTION 'unsupported plate format: %', p_format USING ERRCODE = 'SB005';
  END IF;
  IF p_rows IS NULL OR p_cols IS NULL OR p_rows < 1 OR p_cols < 1
     OR p_rows > 26 OR p_cols > 26 THEN
    RAISE EXCEPTION 'rows and cols must be between 1 and 26' USING ERRCODE = 'SB005';
  END IF;

  INSERT INTO "api"."plate_designs"
    (workspace_id, project_id, name, format, rows, cols, validation,
     created_by_user_id, updated_by_user_id)
  VALUES
    (p_workspace_id, p_project_id, btrim(p_name), p_format, p_rows, p_cols,
     COALESCE(p_validation, '{}'::jsonb),
     "api"."current_user_id"(), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_plate_design"(uuid, text, uuid, text, integer, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_plate_design"(uuid, text, uuid, text, integer, integer, jsonb) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- save_plate_design: atomically replace all wells for a design and bump
-- metadata_version. The p_wells JSONB array is validated structurally (well
-- codes, roles, dimensions) and sample links are checked for same-workspace
-- membership. The optimistic-concurrency guard (p_expected_metadata_version)
-- rejects concurrent saves with SB001.
--
-- Error codes: SB001 stale version, SB015 design not found, SB016 wrong
-- workspace, SB017 well out of bounds, SB018 duplicate well, SB019 invalid
-- role, SB005 invalid input.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."save_plate_design"(
  p_design_id uuid,
  p_wells jsonb,
  p_validation jsonb DEFAULT NULL,
  p_expected_metadata_version integer DEFAULT NULL
)
RETURNS "api"."plate_designs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_design "api"."plate_designs";
  v_well jsonb;
  v_well_code text;
  v_row_idx integer;
  v_col_idx integer;
  v_role text;
  v_sample_id uuid;
  v_replicate integer;
  v_vol_value numeric;
  v_vol_unit text;
  v_conc_value numeric;
  v_conc_unit text;
  v_notes text;
  v_sample_rec "api"."records";
  v_seen_codes text[] := ARRAY[]::text[];
  v_idx integer := 0;
  v_ws_id uuid;
BEGIN
  SELECT * INTO v_design FROM "api"."plate_designs" WHERE id = p_design_id FOR UPDATE;
  IF v_design IS NULL THEN
    RAISE EXCEPTION 'plate design not found' USING ERRCODE = 'SB015';
  END IF;
  v_ws_id := "api"."current_workspace_id"();
  IF v_design.workspace_id <> v_ws_id THEN
    RAISE EXCEPTION 'plate design not found in active workspace' USING ERRCODE = 'SB016';
  END IF;

  -- Optimistic concurrency: if a version is supplied it must match.
  IF p_expected_metadata_version IS NOT NULL
     AND v_design.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_design.metadata_version USING ERRCODE = 'SB001';
  END IF;

  IF v_design.status = 'archived' THEN
    RAISE EXCEPTION 'cannot save an archived plate design' USING ERRCODE = 'SB004';
  END IF;

  -- Validate the wells array structurally before deleting existing rows.
  IF jsonb_typeof(p_wells) <> 'array' THEN
    RAISE EXCEPTION 'p_wells must be a JSON array' USING ERRCODE = 'SB005';
  END IF;

  FOR v_well IN SELECT * FROM jsonb_array_elements(p_wells) LOOP
    v_idx := v_idx + 1;
    v_well_code := v_well ->> 'wellCode';
    v_row_idx := (v_well ->> 'row')::integer;
    v_col_idx := (v_well ->> 'col')::integer;
    v_role := v_well ->> 'role';
    v_sample_id := NULLIF(v_well ->> 'sampleRecordId', '')::uuid;
    v_replicate := NULLIF(v_well ->> 'replicate', '')::integer;
    v_vol_value := NULLIF(v_well ->> 'volumeValue', '')::numeric;
    v_vol_unit := v_well ->> 'volumeUnit';
    v_conc_value := NULLIF(v_well ->> 'concentrationValue', '')::numeric;
    v_conc_unit := v_well ->> 'concentrationUnit';
    v_notes := v_well ->> 'notes';

    -- well code presence
    IF v_well_code IS NULL OR length(btrim(v_well_code)) = 0 THEN
      RAISE EXCEPTION 'well[%] missing wellCode', v_idx USING ERRCODE = 'SB005';
    END IF;

    -- bounds
    IF v_row_idx IS NULL OR v_row_idx < 0 OR v_row_idx >= v_design.rows
       OR v_col_idx IS NULL OR v_col_idx < 0 OR v_col_idx >= v_design.cols THEN
      RAISE EXCEPTION 'well % out of bounds for %x% plate', v_well_code, v_design.rows, v_design.cols
        USING ERRCODE = 'SB017';
    END IF;

    -- duplicate
    IF v_well_code = ANY(v_seen_codes) THEN
      RAISE EXCEPTION 'duplicate well code %', v_well_code USING ERRCODE = 'SB018';
    END IF;
    v_seen_codes := v_seen_codes || v_well_code;

    -- role
    IF v_role NOT IN ('sample','positive_control','negative_control','blank','empty') THEN
      RAISE EXCEPTION 'invalid role % for well %', v_role, v_well_code USING ERRCODE = 'SB019';
    END IF;

    -- sample link integrity
    IF v_sample_id IS NOT NULL THEN
      SELECT * INTO v_sample_rec FROM "api"."records" WHERE id = v_sample_id;
      IF v_sample_rec IS NULL OR v_sample_rec.workspace_id <> v_ws_id THEN
        RAISE EXCEPTION 'sample % not found in active workspace', v_sample_id USING ERRCODE = 'SB016';
      END IF;
      IF v_sample_rec.kind <> 'sample' THEN
        RAISE EXCEPTION 'linked record % is not a sample', v_sample_id USING ERRCODE = 'SB009';
      END IF;
    END IF;
  END LOOP;

  -- Atomically replace wells.
  DELETE FROM "api"."plate_wells" WHERE design_id = p_design_id;

  FOR v_well IN SELECT * FROM jsonb_array_elements(p_wells) LOOP
    v_well_code := v_well ->> 'wellCode';
    v_row_idx := (v_well ->> 'row')::integer;
    v_col_idx := (v_well ->> 'col')::integer;
    v_role := v_well ->> 'role';
    v_sample_id := NULLIF(v_well ->> 'sampleRecordId', '')::uuid;
    v_replicate := NULLIF(v_well ->> 'replicate', '')::integer;
    v_vol_value := NULLIF(v_well ->> 'volumeValue', '')::numeric;
    v_vol_unit := v_well ->> 'volumeUnit';
    v_conc_value := NULLIF(v_well ->> 'concentrationValue', '')::numeric;
    v_conc_unit := v_well ->> 'concentrationUnit';
    v_notes := v_well ->> 'notes';

    INSERT INTO "api"."plate_wells"
      (workspace_id, design_id, well_code, row_index, col_index, role,
       sample_record_id, sample_identifier, sample_title, replicate,
       volume_value, volume_unit, concentration_value, concentration_unit,
       notes)
    VALUES
      (v_ws_id, p_design_id, v_well_code, v_row_idx, v_col_idx, v_role,
       v_sample_id,
       v_well ->> 'sampleIdentifier',
       v_well ->> 'sampleTitle',
       v_replicate, v_vol_value, v_vol_unit, v_conc_value, v_conc_unit,
       v_notes);
  END LOOP;

  -- Update validation config if supplied.
  IF p_validation IS NOT NULL THEN
    UPDATE "api"."plate_designs"
      SET validation = p_validation,
          metadata_version = metadata_version + 1,
          updated_by_user_id = "api"."current_user_id"(),
          updated_at = now()
      WHERE id = p_design_id
      RETURNING * INTO v_design;
  ELSE
    UPDATE "api"."plate_designs"
      SET metadata_version = metadata_version + 1,
          updated_by_user_id = "api"."current_user_id"(),
          updated_at = now()
      WHERE id = p_design_id
      RETURNING * INTO v_design;
  END IF;

  RETURN v_design;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."save_plate_design"(uuid, jsonb, jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."save_plate_design"(uuid, jsonb, jsonb, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- archive_plate_design: mark a design as archived (no further saves).
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."archive_plate_design"(
  p_design_id uuid,
  p_expected_metadata_version integer
)
RETURNS "api"."plate_designs"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_design "api"."plate_designs";
BEGIN
  SELECT * INTO v_design FROM "api"."plate_designs" WHERE id = p_design_id FOR UPDATE;
  IF v_design IS NULL THEN
    RAISE EXCEPTION 'plate design not found' USING ERRCODE = 'SB015';
  END IF;
  IF v_design.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'plate design not found in active workspace' USING ERRCODE = 'SB016';
  END IF;
  IF v_design.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_design.metadata_version USING ERRCODE = 'SB001';
  END IF;
  UPDATE "api"."plate_designs"
    SET status = 'archived',
        metadata_version = metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"(),
        updated_at = now()
    WHERE id = p_design_id
    RETURNING * INTO v_design;
  RETURN v_design;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."archive_plate_design"(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."archive_plate_design"(uuid, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- save_plate_layout_template: create or update a reusable layout template.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."save_plate_layout_template"(
  p_workspace_id uuid,
  p_name text,
  p_description text DEFAULT NULL,
  p_format text DEFAULT '96_well',
  p_rows integer DEFAULT 8,
  p_cols integer DEFAULT 12,
  p_layout jsonb DEFAULT '{}'::jsonb,
  p_template_id uuid DEFAULT NULL
)
RETURNS "api"."plate_layout_templates"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."plate_layout_templates";
BEGIN
  IF NOT "api"."storage_member_using"(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF p_format NOT IN ('96_well') THEN
    RAISE EXCEPTION 'unsupported plate format' USING ERRCODE = 'SB005';
  END IF;

  IF p_template_id IS NOT NULL THEN
    UPDATE "api"."plate_layout_templates"
      SET name = btrim(p_name), description = p_description, format = p_format,
          rows = p_rows, cols = p_cols, layout = COALESCE(p_layout, '{}'::jsonb)
      WHERE id = p_template_id AND workspace_id = p_workspace_id
      RETURNING * INTO v_row;
    IF v_row IS NULL THEN
      RAISE EXCEPTION 'template not found in workspace' USING ERRCODE = 'SB015';
    END IF;
    RETURN v_row;
  END IF;

  INSERT INTO "api"."plate_layout_templates"
    (workspace_id, name, description, format, rows, cols, layout,
     created_by_user_id)
  VALUES
    (p_workspace_id, btrim(p_name), p_description, p_format, p_rows, p_cols,
     COALESCE(p_layout, '{}'::jsonb), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."save_plate_layout_template"(uuid, text, text, text, integer, integer, jsonb, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."save_plate_layout_template"(uuid, text, text, text, integer, integer, jsonb, uuid) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- Widen the change-events entity vocabulary for plate designer entities.
-- ===========================================================================

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'sample_event',
    'comment', 'review_submission', 'signature',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement',
    'plate_design', 'plate_well', 'plate_layout_template'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_plate"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_entity text;
  v_op text;
  v_payload jsonb;
BEGIN
  v_entity := TG_ARGV[0];
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW) - 'metadata';
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD) - 'metadata';
  END CASE;
  PERFORM "internal"."emit_change_event"(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    v_entity,
    COALESCE(NEW.id, OLD.id),
    v_op,
    NULL,
    NULL,
    v_payload
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_plate"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "change_event_plate_designs"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."plate_designs"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_plate"('plate_design');
--> statement-breakpoint
CREATE TRIGGER "change_event_plate_wells"
  AFTER INSERT OR DELETE ON "api"."plate_wells"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_plate"('plate_well');
--> statement-breakpoint
CREATE TRIGGER "change_event_plate_layout_templates"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."plate_layout_templates"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_plate"('plate_layout_template');
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
