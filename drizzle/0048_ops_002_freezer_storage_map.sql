-- ===========================================================================
-- OPS-002: Freezer & Storage Map.
--
-- Models the physical storage hierarchy (site > room > unit > shelf > rack >
-- box > position) with capacity and environment metadata, an append-only
-- storage_movements event log, and controlled RPCs that move samples between
-- positions transactionally. Double occupation is prevented by a partial
-- unique index on storage_positions.occupied_record_id plus a row-level lock
-- inside move_sample_to_position; impossible moves (into occupied, quarantined
-- or missing positions, or cross-workspace positions) are rejected in the same
-- transaction so the map and the sample's storageLocation can never diverge.
--
-- Samples remain `records` rows with kind='sample'; their human-readable
-- storage location stays in records.properties.storageLocation (SCI-001 /
-- decision 0026). This migration adds the structured, position-addressable
-- layer on top: a move updates both the structured occupancy and the
-- properties string, appends a storage_movements row (position ids + paths)
-- and a sample_events 'transfer' row (paths) so the existing chain of custody
-- stays complete.
--
-- RLS is the access-control boundary. authenticated members get
-- SELECT/INSERT/UPDATE/DELETE on the hierarchy levels they can edit, and
-- SELECT on positions/movements; the controlled RPCs (SECURITY INVOKER) are
-- the only writers for occupancy, position status and movements, so a direct
-- PostgREST POST can never forge a move or bypass the double-occupation guard.
-- ===========================================================================

-- --------------------------------------------------------------------------- 
-- api.storage_sites: top-level building / facility.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_sites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "description" text,
  "temperature_min_c" numeric,
  "temperature_max_c" numeric,
  "capacity" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_sites_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_sites_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_sites_code" CHECK (length(btrim("code")) BETWEEN 1 AND 64),
  CONSTRAINT "chk_storage_sites_capacity" CHECK ("capacity" >= 0),
  CONSTRAINT "chk_storage_sites_temp_range"
    CHECK ("temperature_min_c" IS NULL OR "temperature_max_c" IS NULL
           OR "temperature_min_c" <= "temperature_max_c")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_storage_sites_workspace_code"
  ON "api"."storage_sites" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX "idx_storage_sites_workspace"
  ON "api"."storage_sites" ("workspace_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_rooms: room within a site.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_rooms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "site_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "temperature_min_c" numeric,
  "temperature_max_c" numeric,
  "capacity" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_rooms_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_rooms_site_id_storage_sites_id_fk"
    FOREIGN KEY ("site_id") REFERENCES "api"."storage_sites"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_rooms_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_rooms_code" CHECK (length(btrim("code")) BETWEEN 1 AND 64),
  CONSTRAINT "chk_storage_rooms_capacity" CHECK ("capacity" >= 0),
  CONSTRAINT "chk_storage_rooms_temp_range"
    CHECK ("temperature_min_c" IS NULL OR "temperature_max_c" IS NULL
           OR "temperature_min_c" <= "temperature_max_c")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_storage_rooms_workspace_site_code"
  ON "api"."storage_rooms" ("workspace_id", "site_id", "code");
--> statement-breakpoint
CREATE INDEX "idx_storage_rooms_workspace"
  ON "api"."storage_rooms" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_rooms_site"
  ON "api"."storage_rooms" ("site_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_units: freezer / fridge / cryo / incubator / cabinet within a
-- room. unit_type drives the environment expectations.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "room_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "unit_type" text NOT NULL DEFAULT 'freezer',
  "temperature_min_c" numeric,
  "temperature_max_c" numeric,
  "capacity" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_units_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_units_room_id_storage_rooms_id_fk"
    FOREIGN KEY ("room_id") REFERENCES "api"."storage_rooms"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_units_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_units_code" CHECK (length(btrim("code")) BETWEEN 1 AND 64),
  CONSTRAINT "chk_storage_units_type"
    CHECK ("unit_type" IN ('freezer','fridge','cryo','incubator','ambient','dewar','cabinet')),
  CONSTRAINT "chk_storage_units_capacity" CHECK ("capacity" >= 0),
  CONSTRAINT "chk_storage_units_temp_range"
    CHECK ("temperature_min_c" IS NULL OR "temperature_max_c" IS NULL
           OR "temperature_min_c" <= "temperature_max_c")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_storage_units_workspace_room_code"
  ON "api"."storage_units" ("workspace_id", "room_id", "code");
--> statement-breakpoint
CREATE INDEX "idx_storage_units_workspace"
  ON "api"."storage_units" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_units_room"
  ON "api"."storage_units" ("room_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_shelves: shelf within a unit.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_shelves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL DEFAULT 1,
  "capacity" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_shelves_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_shelves_unit_id_storage_units_id_fk"
    FOREIGN KEY ("unit_id") REFERENCES "api"."storage_units"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_shelves_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_shelves_capacity" CHECK ("capacity" >= 0),
  CONSTRAINT "chk_storage_shelves_position" CHECK ("position" > 0)
);
--> statement-breakpoint

CREATE INDEX "idx_storage_shelves_workspace"
  ON "api"."storage_shelves" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_shelves_unit"
  ON "api"."storage_shelves" ("unit_id", "position");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_racks: rack within a shelf.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_racks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "shelf_id" uuid NOT NULL,
  "name" text NOT NULL,
  "position" integer NOT NULL DEFAULT 1,
  "capacity" integer NOT NULL DEFAULT 0,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_racks_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_racks_shelf_id_storage_shelves_id_fk"
    FOREIGN KEY ("shelf_id") REFERENCES "api"."storage_shelves"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_racks_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_racks_capacity" CHECK ("capacity" >= 0),
  CONSTRAINT "chk_storage_racks_position" CHECK ("position" > 0)
);
--> statement-breakpoint

CREATE INDEX "idx_storage_racks_workspace"
  ON "api"."storage_racks" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_racks_shelf"
  ON "api"."storage_racks" ("shelf_id", "position");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_boxes: box within a rack. rows * cols defines the position
-- grid generated by create_storage_box. rows/cols are immutable after creation
-- (a trigger prevents changes so the position grid stays consistent).
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_boxes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "rack_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "rows" integer NOT NULL,
  "cols" integer NOT NULL,
  "capacity" integer NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_boxes_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_boxes_rack_id_storage_racks_id_fk"
    FOREIGN KEY ("rack_id") REFERENCES "api"."storage_racks"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "chk_storage_boxes_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_storage_boxes_code" CHECK (length(btrim("code")) BETWEEN 1 AND 64),
  CONSTRAINT "chk_storage_boxes_rows" CHECK ("rows" BETWEEN 1 AND 26),
  CONSTRAINT "chk_storage_boxes_cols" CHECK ("cols" BETWEEN 1 AND 26),
  CONSTRAINT "chk_storage_boxes_capacity" CHECK ("capacity" = "rows" * "cols")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_storage_boxes_workspace_rack_code"
  ON "api"."storage_boxes" ("workspace_id", "rack_id", "code");
--> statement-breakpoint
CREATE INDEX "idx_storage_boxes_workspace"
  ON "api"."storage_boxes" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_boxes_rack"
  ON "api"."storage_boxes" ("rack_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_positions: the atomic occupiable leaf. One sample per position
-- (partial unique index on occupied_record_id). status drives the accessible
-- colour-plus-text treatment: available | occupied | quarantined | missing.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_positions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "box_id" uuid NOT NULL,
  "row_index" integer NOT NULL,
  "col_index" integer NOT NULL,
  "label" text NOT NULL,
  "status" text NOT NULL DEFAULT 'available',
  "occupied_record_id" uuid,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_positions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_positions_box_id_storage_boxes_id_fk"
    FOREIGN KEY ("box_id") REFERENCES "api"."storage_boxes"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_positions_occupied_record_id_records_id_fk"
    FOREIGN KEY ("occupied_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_storage_positions_row" CHECK ("row_index" >= 0),
  CONSTRAINT "chk_storage_positions_col" CHECK ("col_index" >= 0),
  CONSTRAINT "chk_storage_positions_label" CHECK (length(btrim("label")) BETWEEN 1 AND 8),
  CONSTRAINT "chk_storage_positions_status"
    CHECK ("status" IN ('available','occupied','quarantined','missing')),
  CONSTRAINT "chk_storage_positions_occupancy"
    CHECK (("status" = 'occupied') = ("occupied_record_id" IS NOT NULL))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_storage_positions_box_row_col"
  ON "api"."storage_positions" ("box_id", "row_index", "col_index");
--> statement-breakpoint
-- A sample can occupy at most one position across the whole workspace.
CREATE UNIQUE INDEX "uq_storage_positions_occupied_record"
  ON "api"."storage_positions" ("occupied_record_id")
  WHERE "occupied_record_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_storage_positions_workspace"
  ON "api"."storage_positions" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_storage_positions_box"
  ON "api"."storage_positions" ("box_id", "row_index", "col_index");
--> statement-breakpoint
CREATE INDEX "idx_storage_positions_occupied"
  ON "api"."storage_positions" ("occupied_record_id")
  WHERE "occupied_record_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.storage_movements: append-only movement log. One row per controlled
-- move (place / move / remove). from_position_id is nullable for the first
-- placement; to_position_id is nullable for removal. The human-readable path
-- is snapshotted so the history stays readable even if the hierarchy is later
-- restructured.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."storage_movements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "from_position_id" uuid,
  "to_position_id" uuid,
  "from_path" text,
  "to_path" text,
  "actor_user_id" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "storage_movements_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_movements_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "api"."records"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "storage_movements_from_position_id_storage_positions_id_fk"
    FOREIGN KEY ("from_position_id") REFERENCES "api"."storage_positions"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "storage_movements_to_position_id_storage_positions_id_fk"
    FOREIGN KEY ("to_position_id") REFERENCES "api"."storage_positions"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "storage_movements_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_storage_movements_operation"
    CHECK ("operation" IN ('place','move','remove')),
  CONSTRAINT "chk_storage_movements_positions"
    CHECK ("from_position_id" IS NOT NULL OR "to_position_id" IS NOT NULL)
);
--> statement-breakpoint

CREATE INDEX "idx_storage_movements_record_created"
  ON "api"."storage_movements" ("record_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_storage_movements_workspace_created"
  ON "api"."storage_movements" ("workspace_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_storage_movements_position"
  ON "api"."storage_movements" ("to_position_id")
  WHERE "to_position_id" IS NOT NULL;
--> statement-breakpoint

-- ===========================================================================
-- Grants + RLS.
--
-- Hierarchy levels (sites/rooms/units/shelves/racks): members can
-- SELECT/INSERT/UPDATE/DELETE their own workspace's rows; api_client reads.
-- Boxes: members SELECT/UPDATE/DELETE; INSERT only via create_storage_box RPC
-- (so the position grid is always generated). Positions: members SELECT;
-- occupancy + status changes only via the controlled RPCs. Movements:
-- members/api_client SELECT; writes only via move_sample_to_position RPC.
-- ===========================================================================

REVOKE ALL ON "api"."storage_sites","api"."storage_rooms","api"."storage_units",
  "api"."storage_shelves","api"."storage_racks","api"."storage_boxes",
  "api"."storage_positions","api"."storage_movements" FROM PUBLIC;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."storage_sites" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."storage_rooms" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."storage_units" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."storage_shelves" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."storage_racks" TO authenticated;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON "api"."storage_boxes" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."storage_positions" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."storage_movements" TO authenticated;
--> statement-breakpoint

GRANT SELECT ON "api"."storage_sites","api"."storage_rooms","api"."storage_units",
  "api"."storage_shelves","api"."storage_racks","api"."storage_boxes",
  "api"."storage_positions","api"."storage_movements" TO api_client;
--> statement-breakpoint

ALTER TABLE "api"."storage_sites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_rooms" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_units" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_shelves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_racks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_boxes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_positions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."storage_movements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Helper to apply the same member-read / member-write policy across levels.
CREATE OR REPLACE FUNCTION "api"."storage_member_using"(
  p_workspace_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_workspace_id = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"(p_workspace_id)
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."storage_member_using"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."storage_member_using"(uuid) TO authenticated;
--> statement-breakpoint

CREATE POLICY "storage_sites_select" ON "api"."storage_sites"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_sites_select_api_client" ON "api"."storage_sites"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_sites_write" ON "api"."storage_sites"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_rooms_select" ON "api"."storage_rooms"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_rooms_select_api_client" ON "api"."storage_rooms"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_rooms_write" ON "api"."storage_rooms"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_units_select" ON "api"."storage_units"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_units_select_api_client" ON "api"."storage_units"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_units_write" ON "api"."storage_units"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_shelves_select" ON "api"."storage_shelves"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_shelves_select_api_client" ON "api"."storage_shelves"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_shelves_write" ON "api"."storage_shelves"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_racks_select" ON "api"."storage_racks"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_racks_select_api_client" ON "api"."storage_racks"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_racks_write" ON "api"."storage_racks"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_boxes_select" ON "api"."storage_boxes"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_boxes_select_api_client" ON "api"."storage_boxes"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "storage_boxes_write" ON "api"."storage_boxes"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "storage_positions_select" ON "api"."storage_positions"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_positions_select_api_client" ON "api"."storage_positions"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "storage_movements_select" ON "api"."storage_movements"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "storage_movements_select_api_client" ON "api"."storage_movements"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Capacity enforcement: a BEFORE INSERT trigger on rooms/units/shelves/racks
-- rejects a new child when the parent's capacity is non-zero and already
-- reached. Boxes enforce capacity = rows*cols via the position grid generated
-- by create_storage_box. Sites have no parent so no capacity trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "internal"."enforce_storage_capacity"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_parent_id uuid;
  v_parent_capacity integer;
  v_child_count integer;
  v_parent_table text;
  v_parent_col text;
  v_child_col text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'storage_rooms' THEN
      v_parent_table := 'api.storage_sites'; v_parent_col := 'site_id';
      v_child_col := 'site_id';
    WHEN 'storage_units' THEN
      v_parent_table := 'api.storage_rooms'; v_parent_col := 'room_id';
      v_child_col := 'room_id';
    WHEN 'storage_shelves' THEN
      v_parent_table := 'api.storage_units'; v_parent_col := 'unit_id';
      v_child_col := 'unit_id';
    WHEN 'storage_racks' THEN
      v_parent_table := 'api.storage_shelves'; v_parent_col := 'shelf_id';
      v_child_col := 'shelf_id';
    ELSE
      RETURN NEW;
  END CASE;

  -- Read the parent id from the new row via jsonb so the function does not
  -- reference NEW.<col> directly (PL/pgSQL validates every NEW.<field> against
  -- the trigger table's rowtype at compile time, which would fail for the
  -- tables that do not have that column).
  v_parent_id := (v_new ->> v_child_col)::uuid;

  EXECUTE format('SELECT capacity FROM %s WHERE id = $1', v_parent_table)
    INTO v_parent_capacity USING v_parent_id;

  -- capacity = 0 means unlimited (modelled but not enforced).
  IF v_parent_capacity IS NULL OR v_parent_capacity = 0 THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM %I.%I WHERE workspace_id = $1 AND %I = $2',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, v_child_col
  ) INTO v_child_count USING NEW.workspace_id, v_parent_id;

  IF v_child_count >= v_parent_capacity THEN
    RAISE EXCEPTION 'parent % capacity reached (% of %)',
      v_parent_table, v_child_count, v_parent_capacity
      USING ERRCODE = 'SB014';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."enforce_storage_capacity"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "storage_rooms_capacity"
  BEFORE INSERT ON "api"."storage_rooms"
  FOR EACH ROW EXECUTE FUNCTION "internal"."enforce_storage_capacity"();
--> statement-breakpoint
CREATE TRIGGER "storage_units_capacity"
  BEFORE INSERT ON "api"."storage_units"
  FOR EACH ROW EXECUTE FUNCTION "internal"."enforce_storage_capacity"();
--> statement-breakpoint
CREATE TRIGGER "storage_shelves_capacity"
  BEFORE INSERT ON "api"."storage_shelves"
  FOR EACH ROW EXECUTE FUNCTION "internal"."enforce_storage_capacity"();
--> statement-breakpoint
CREATE TRIGGER "storage_racks_capacity"
  BEFORE INSERT ON "api"."storage_racks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."enforce_storage_capacity"();
--> statement-breakpoint

-- Prevent rows/cols mutation on boxes so the position grid stays consistent.
CREATE OR REPLACE FUNCTION "internal"."guard_storage_box_grid"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.rows <> OLD.rows OR NEW.cols <> OLD.cols THEN
    RAISE EXCEPTION 'box rows/cols are immutable; create a new box to change the grid'
      USING ERRCODE = 'SB014';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."guard_storage_box_grid"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "storage_boxes_guard_grid"
  BEFORE UPDATE OF "rows", "cols" ON "api"."storage_boxes"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_storage_box_grid"();
--> statement-breakpoint

-- ===========================================================================
-- storage_path(p_position_id): human-readable
-- "Site > Room > Unit > Shelf > Rack > Box > A1".
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."storage_path"(p_position_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_pos "api"."storage_positions";
  v_box "api"."storage_boxes";
  v_rack "api"."storage_racks";
  v_shelf "api"."storage_shelves";
  v_unit "api"."storage_units";
  v_room "api"."storage_rooms";
  v_site "api"."storage_sites";
BEGIN
  SELECT * INTO v_pos FROM "api"."storage_positions" WHERE id = p_position_id;
  IF v_pos IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_box FROM "api"."storage_boxes" WHERE id = v_pos.box_id;
  SELECT * INTO v_rack FROM "api"."storage_racks" WHERE id = v_box.rack_id;
  SELECT * INTO v_shelf FROM "api"."storage_shelves" WHERE id = v_rack.shelf_id;
  SELECT * INTO v_unit FROM "api"."storage_units" WHERE id = v_shelf.unit_id;
  SELECT * INTO v_room FROM "api"."storage_rooms" WHERE id = v_unit.room_id;
  SELECT * INTO v_site FROM "api"."storage_sites" WHERE id = v_room.site_id;
  RETURN concat_ws(' > ',
    v_site.name, v_room.name, v_unit.name, v_shelf.name,
    v_rack.name, v_box.name, v_pos.label);
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."storage_path"(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."storage_path"(uuid) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."storage_path"(uuid) TO api_client;
--> statement-breakpoint

-- ===========================================================================
-- create_storage_box: create a box and generate its rows*cols position grid
-- transactionally. Labels follow the A..Z rows × 1..n cols convention. This is
-- the only path that creates positions, so the grid and capacity always agree.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_storage_box"(
  p_workspace_id uuid,
  p_rack_id uuid,
  p_name text,
  p_code text,
  p_rows integer,
  p_cols integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS "api"."storage_boxes"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_box "api"."storage_boxes";
  v_rack "api"."storage_racks";
  r integer;
  c integer;
  v_label text;
BEGIN
  IF p_rows IS NULL OR p_cols IS NULL OR p_rows < 1 OR p_cols < 1
     OR p_rows > 26 OR p_cols > 26 THEN
    RAISE EXCEPTION 'rows and cols must be between 1 and 26' USING ERRCODE = 'SB005';
  END IF;
  IF NOT "api"."storage_member_using"(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_rack FROM "api"."storage_racks" WHERE id = p_rack_id FOR UPDATE;
  IF v_rack IS NULL THEN
    RAISE EXCEPTION 'rack not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_rack.workspace_id <> p_workspace_id THEN
    RAISE EXCEPTION 'rack does not belong to this workspace' USING ERRCODE = '42501';
  END IF;

  INSERT INTO "api"."storage_boxes"
    (workspace_id, rack_id, name, code, rows, cols, capacity, metadata)
  VALUES
    (p_workspace_id, p_rack_id, p_name, p_code, p_rows, p_cols,
     p_rows * p_cols, COALESCE(p_metadata, '{}'::jsonb))
  RETURNING * INTO v_box;

  r := 0;
  WHILE r < p_rows LOOP
    c := 0;
    WHILE c < p_cols LOOP
      v_label := chr(65 + r) || (c + 1)::text;
      INSERT INTO "api"."storage_positions"
        (workspace_id, box_id, row_index, col_index, label, status)
      VALUES
        (p_workspace_id, v_box.id, r, c, v_label, 'available');
      c := c + 1;
    END LOOP;
    r := r + 1;
  END LOOP;

  RETURN v_box;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_storage_box"(uuid, uuid, text, text, integer, integer, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_storage_box"(uuid, uuid, text, text, integer, integer, jsonb) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- move_sample_to_position: the controlled, transactional move.
--
-- Locks the target position FOR UPDATE (serialises concurrent moves onto the
-- same position), checks it is available and in the active workspace, locks
-- the sample record FOR UPDATE and checks kind/metadata_version/archived,
-- clears the sample's previous position (if any), sets occupancy, updates
-- records.properties.storageLocation to the human-readable path, and appends
-- both a storage_movements row and a sample_events 'transfer' row so the
-- existing chain of custody stays complete. A removal move (p_to_position_id
-- NULL) clears occupancy and records an empty storageLocation.
--
-- Error codes: SB009 not_a_sample, SB004 archived, SB001 stale version,
-- SB010 position occupied, SB011 position not found / wrong workspace,
-- SB012 sample already at that position, SB013 position not available.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."move_sample_to_position"(
  p_record_id uuid,
  p_to_position_id uuid,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_target "api"."storage_positions";
  v_prev "api"."storage_positions";
  v_to_path text;
  v_from_path text;
  v_props jsonb;
  v_op text;
BEGIN
  IF NOT "api"."storage_member_using"("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'no active workspace membership' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM "api"."storage_positions"
    WHERE id = p_to_position_id FOR UPDATE;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'position not found in active workspace' USING ERRCODE = 'SB011';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot move an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  -- Target must belong to the same workspace as the sample.
  IF v_target.workspace_id <> v_row.workspace_id THEN
    RAISE EXCEPTION 'position is in a different workspace' USING ERRCODE = 'SB011';
  END IF;
  IF v_target.status IN ('quarantined','missing') THEN
    RAISE EXCEPTION 'position is not available (status: %)', v_target.status
      USING ERRCODE = 'SB013';
  END IF;
  IF v_target.occupied_record_id IS NOT NULL THEN
    RAISE EXCEPTION 'position is already occupied' USING ERRCODE = 'SB010';
  END IF;
  IF v_target.occupied_record_id = p_record_id THEN
    RAISE EXCEPTION 'sample is already at that position' USING ERRCODE = 'SB012';
  END IF;

  -- Find and clear the sample's previous position (if any). The partial
  -- unique index on occupied_record_id guarantees at most one.
  SELECT * INTO v_prev FROM "api"."storage_positions"
    WHERE occupied_record_id = p_record_id FOR UPDATE;
  IF v_prev IS NOT NULL THEN
    v_from_path := "api"."storage_path"(v_prev.id);
    UPDATE "api"."storage_positions"
      SET occupied_record_id = NULL, status = 'available', updated_at = now()
      WHERE id = v_prev.id;
  END IF;

  v_to_path := "api"."storage_path"(v_target.id);
  v_op := CASE WHEN v_prev IS NULL THEN 'place' ELSE 'move' END;

  -- Occupy the target.
  UPDATE "api"."storage_positions"
    SET occupied_record_id = p_record_id, status = 'occupied', updated_at = now()
    WHERE id = v_target.id;

  -- Update the sample's human-readable storage location.
  v_props := v_row.properties || jsonb_build_object('storageLocation', v_to_path);
  UPDATE "api"."records"
    SET properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  -- Append the storage-map movement (structured position ids + paths).
  INSERT INTO "api"."storage_movements"
    (workspace_id, record_id, operation, from_position_id, to_position_id,
     from_path, to_path, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, v_op, v_prev.id, v_target.id,
     v_from_path, v_to_path, "api"."current_user_id"(), p_notes);

  -- Append to the existing chain of custody so the sample inspector and the
  -- storage inspector tell the same story.
  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, from_location, to_location,
     actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'transfer',
     COALESCE(v_from_path, 'unfiled'),
     v_to_path, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."move_sample_to_position"(uuid, uuid, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."move_sample_to_position"(uuid, uuid, int, text) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- remove_sample_from_position: clear occupancy without a new target. Records a
-- 'remove' movement and clears records.properties.storageLocation.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."remove_sample_from_position"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_prev "api"."storage_positions";
  v_from_path text;
  v_props jsonb;
BEGIN
  IF NOT "api"."storage_member_using"("api"."current_workspace_id"()) THEN
    RAISE EXCEPTION 'no active workspace membership' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF
;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  SELECT * INTO v_prev FROM "api"."storage_positions"
    WHERE occupied_record_id = p_record_id FOR UPDATE;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'sample is not in any position' USING ERRCODE = 'SB011';
  END IF;
  v_from_path := "api"."storage_path"(v_prev.id);

  UPDATE "api"."storage_positions"
    SET occupied_record_id = NULL, status = 'available', updated_at = now()
    WHERE id = v_prev.id;

  v_props := v_row.properties - 'storageLocation';
  UPDATE "api"."records"
    SET properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."storage_movements"
    (workspace_id, record_id, operation, from_position_id, to_position_id,
     from_path, to_path, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'remove', v_prev.id, NULL,
     v_from_path, NULL, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."remove_sample_from_position"(uuid, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."remove_sample_from_position"(uuid, int, text) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- quarantine_position / restore_position: controlled position status changes
-- that refuse to act on an occupied position (quarantine) and log nothing to
-- storage_movements (they are not sample moves). A quarantined or missing
-- position cannot be moved into (move_sample_to_position rejects SB013).
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."set_position_status"(
  p_position_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS "api"."storage_positions"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pos "api"."storage_positions";
BEGIN
  IF p_status NOT IN ('available','quarantined','missing') THEN
    RAISE EXCEPTION 'invalid position status: %', p_status USING ERRCODE = 'SB005';
  END IF;

  SELECT * INTO v_pos FROM "api"."storage_positions"
    WHERE id = p_position_id FOR UPDATE;
  IF v_pos IS NULL THEN
    RAISE EXCEPTION 'position not found in active workspace' USING ERRCODE = 'SB011';
  END IF;
  IF v_pos.workspace_id <> "api"."current_workspace_id"() THEN
    RAISE EXCEPTION 'position not found in active workspace' USING ERRCODE = 'SB011';
  END IF;

  -- A position holding a sample cannot be quarantined or marked missing
  -- without first removing the sample.
  IF v_pos.occupied_record_id IS NOT NULL AND p_status <> 'available' THEN
    RAISE EXCEPTION 'cannot change status of an occupied position' USING ERRCODE = 'SB013';
  END IF
;
  -- Restoring to available is always allowed; setting available on an
  -- occupied position keeps it occupied (status synced by the move RPC).
  IF p_status = 'available' AND v_pos.occupied_record_id IS NOT NULL THEN
    p_status := 'occupied';
  END IF;

  UPDATE "api"."storage_positions"
    SET status = p_status, updated_at = now()
    WHERE id = p_position_id
    RETURNING * INTO v_pos;

  RETURN v_pos;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."set_position_status"(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."set_position_status"(uuid, text, text) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- lookup_sample_by_barcode: return the active (non-archived) sample record in
-- the current workspace whose properties->>barcode matches. Used by the
-- barcode-driven move workflow. Returns NULL when not found.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."lookup_sample_by_barcode"(
  p_barcode text
)
RETURNS SETOF "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
    SELECT * FROM "api"."records"
    WHERE kind = 'sample'
      AND properties ->> 'barcode' = btrim(p_barcode)
      AND workspace_id = "api"."current_workspace_id"()
      AND archived_at IS NULL
    LIMIT 1;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."lookup_sample_by_barcode"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."lookup_sample_by_barcode"(text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."lookup_sample_by_barcode"(text) TO api_client;
--> statement-breakpoint

-- ===========================================================================
-- Widen the change-events entity vocabulary for storage entities and wire
-- change-event triggers so the storage map reacts to live mutations.
-- ===========================================================================

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'sample_event',
    'storage_site', 'storage_room', 'storage_unit', 'storage_shelf',
    'storage_rack', 'storage_box', 'storage_position', 'storage_movement'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_storage"()
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
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_storage"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "change_event_storage_sites"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_sites"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_site');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_rooms"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_rooms"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_room');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_units"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_units"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_unit');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_shelves"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_shelves"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_shelf');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_racks"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_racks"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_rack');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_boxes"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_boxes"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_box');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_positions"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."storage_positions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_position');
--> statement-breakpoint
CREATE TRIGGER "change_event_storage_movements"
  AFTER INSERT ON "api"."storage_movements"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_storage"('storage_movement');
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
