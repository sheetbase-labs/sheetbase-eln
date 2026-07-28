-- ===========================================================================
-- OPS-004: Lab Calendar.
--
-- Adds four workspace-scoped tables for lab scheduling:
--
--   api.calendar_resources            — bookable resources (instruments,
--                                       rooms, equipment) with an explicit
--                                       IANA timezone so booking times are
--                                       rendered and checked in the lab's
--                                       local wall-clock regardless of the
--                                       server's session timezone.
--   api.calendar_bookings             — a time-range booking of a resource,
--                                       linked optionally to an experiment
--                                       record. status drives the lifecycle:
--                                       tentative → confirmed → cancelled.
--                                       Timestamps are timestamptz (UTC-
--                                       stored, zone-aware); the booking's
--                                       own `timezone` column fixes the
--                                       display/DST boundary.
--   api.calendar_booking_participants — owner/participant rows for a booking.
--   api.calendar_booking_samples      — required samples linked to a booking
--                                       (snapshot identifier/title preserved
--                                       when the sample is removed).
--
-- RLS is the read access-control boundary; members read calendar rows in
-- their workspace. The controlled RPCs (SECURITY DEFINER) are the ONLY
-- writers for bookings, participants and samples, so overlap detection is
-- always transactional: create_booking/edit_booking/duplicate_booking lock
-- the target resource row FOR UPDATE (serialising concurrent bookings for
-- that resource) and reject overlaps with status <> 'cancelled' using
-- tstzrange &&. cancel_booking is a soft status transition.
--
-- Error codes:
--   SB005 invalid input, SB009 not a sample, SB016 wrong workspace,
--   SB020 booking overlap, SB021 resource not found,
--   SB022 booking not found, SB023 invalid time range (end <= start),
--   SB024 booking already cancelled, SB025 participant not found.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- api.calendar_resources: bookable instruments, rooms and equipment.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."calendar_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid,
  "name" text NOT NULL,
  "code" text NOT NULL,
  "resource_type" text NOT NULL DEFAULT 'instrument',
  "location" text,
  "capacity" integer NOT NULL DEFAULT 1,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "status" text NOT NULL DEFAULT 'active',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  CONSTRAINT "calendar_resources_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_resources_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "calendar_resources_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "calendar_resources_updated_by_user_id_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_calendar_resources_name" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_calendar_resources_code" CHECK (length(btrim("code")) BETWEEN 1 AND 100),
  CONSTRAINT "chk_calendar_resources_type" CHECK ("resource_type" IN ('instrument','room','equipment')),
  CONSTRAINT "chk_calendar_resources_capacity" CHECK ("capacity" > 0),
  CONSTRAINT "chk_calendar_resources_status" CHECK ("status" IN ('active','inactive'))
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_calendar_resources_workspace_code" ON "api"."calendar_resources" ("workspace_id", "code");
--> statement-breakpoint
CREATE INDEX "idx_calendar_resources_workspace" ON "api"."calendar_resources" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_resources_workspace_type" ON "api"."calendar_resources" ("workspace_id", "resource_type");
--> statement-breakpoint
CREATE INDEX "idx_calendar_resources_project" ON "api"."calendar_resources" ("project_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.calendar_bookings: time-range bookings of a resource.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."calendar_bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "project_id" uuid,
  "title" text NOT NULL,
  "status" text NOT NULL DEFAULT 'tentative',
  "all_day" boolean NOT NULL DEFAULT false,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "location" text,
  "color" text,
  "notes" text,
  "linked_experiment_record_id" uuid,
  "linked_experiment_identifier" text,
  "linked_experiment_title" text,
  "metadata_version" integer NOT NULL DEFAULT 1,
  "cancelled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  CONSTRAINT "calendar_bookings_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_bookings_resource_id_calendar_resources_id_fk"
    FOREIGN KEY ("resource_id") REFERENCES "api"."calendar_resources"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_bookings_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "calendar_bookings_linked_experiment_record_id_records_id_fk"
    FOREIGN KEY ("linked_experiment_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "calendar_bookings_created_by_user_id_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "calendar_bookings_updated_by_user_id_user_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_calendar_bookings_title" CHECK (length(btrim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "chk_calendar_bookings_status" CHECK ("status" IN ('tentative','confirmed','cancelled')),
  CONSTRAINT "chk_calendar_bookings_range" CHECK ("ends_at" > "starts_at"),
  CONSTRAINT "chk_calendar_bookings_version" CHECK ("metadata_version" > 0),
  CONSTRAINT "chk_calendar_bookings_cancel" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))
);
--> statement-breakpoint

CREATE INDEX "idx_calendar_bookings_workspace" ON "api"."calendar_bookings" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_bookings_resource" ON "api"."calendar_bookings" ("resource_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_bookings_project" ON "api"."calendar_bookings" ("project_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_bookings_resource_starts" ON "api"."calendar_bookings" ("resource_id", "starts_at");
--> statement-breakpoint
CREATE INDEX "idx_calendar_bookings_active_range"
  ON "api"."calendar_bookings" ("resource_id", "starts_at", "ends_at")
  WHERE "status" <> 'cancelled';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.calendar_booking_participants: owner / participant rows.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."calendar_booking_participants" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "user_id" text,
  "display_name" text,
  "role" text NOT NULL DEFAULT 'participant',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_booking_participants_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_booking_participants_booking_id_calendar_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "api"."calendar_bookings"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_booking_participants_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_calendar_booking_participants_role" CHECK ("role" IN ('owner','participant')),
  CONSTRAINT "chk_calendar_booking_participants_identity"
    CHECK ("user_id" IS NOT NULL OR "display_name" IS NOT NULL)
);
--> statement-breakpoint

CREATE UNIQUE INDEX "uq_calendar_booking_participants_booking_user"
  ON "api"."calendar_booking_participants" ("booking_id", "user_id")
  WHERE "user_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_calendar_booking_participants_workspace" ON "api"."calendar_booking_participants" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_booking_participants_booking" ON "api"."calendar_booking_participants" ("booking_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api.calendar_booking_samples: required samples linked to a booking.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."calendar_booking_samples" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "booking_id" uuid NOT NULL,
  "sample_record_id" uuid,
  "sample_identifier" text,
  "sample_title" text,
  "quantity_value" numeric,
  "quantity_unit" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_booking_samples_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_booking_samples_booking_id_calendar_bookings_id_fk"
    FOREIGN KEY ("booking_id") REFERENCES "api"."calendar_bookings"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "calendar_booking_samples_sample_record_id_records_id_fk"
    FOREIGN KEY ("sample_record_id") REFERENCES "api"."records"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_calendar_booking_samples_quantity"
    CHECK ("quantity_value" IS NULL OR "quantity_value" > 0)
);
--> statement-breakpoint

CREATE INDEX "idx_calendar_booking_samples_workspace" ON "api"."calendar_booking_samples" ("workspace_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_booking_samples_booking" ON "api"."calendar_booking_samples" ("booking_id");
--> statement-breakpoint
CREATE INDEX "idx_calendar_booking_samples_sample"
  ON "api"."calendar_booking_samples" ("sample_record_id")
  WHERE "sample_record_id" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants. Resources are CRUD-able by members (RLS scoped); bookings,
-- participants and samples are read-only to authenticated and written only
-- through the controlled RPCs so overlap detection is always enforced.
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "api"."calendar_resources" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_bookings" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_booking_participants" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_booking_samples" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_resources" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_bookings" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_booking_participants" TO api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."calendar_booking_samples" TO api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Row Level Security.
-- ---------------------------------------------------------------------------

ALTER TABLE "api"."calendar_resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."calendar_bookings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."calendar_booking_participants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."calendar_booking_samples" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "calendar_resources_select" ON "api"."calendar_resources"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "calendar_resources_select_api_client" ON "api"."calendar_resources"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint
CREATE POLICY "calendar_resources_write" ON "api"."calendar_resources"
  FOR ALL TO authenticated
  USING ("api"."storage_member_using"("workspace_id"))
  WITH CHECK ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint

CREATE POLICY "calendar_bookings_select" ON "api"."calendar_bookings"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "calendar_bookings_select_api_client" ON "api"."calendar_bookings"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "calendar_booking_participants_select" ON "api"."calendar_booking_participants"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "calendar_booking_participants_select_api_client" ON "api"."calendar_booking_participants"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

CREATE POLICY "calendar_booking_samples_select" ON "api"."calendar_booking_samples"
  FOR SELECT TO authenticated USING ("api"."storage_member_using"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "calendar_booking_samples_select_api_client" ON "api"."calendar_booking_samples"
  FOR SELECT TO api_client USING ("workspace_id" = "api"."current_workspace_id"());
--> statement-breakpoint

-- ===========================================================================
-- create_calendar_resource: create a bookable resource. Any workspace member
-- may add instruments/rooms; RLS scopes reads to the workspace.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_calendar_resource"(
  p_workspace_id uuid,
  p_name text,
  p_code text,
  p_resource_type text DEFAULT 'instrument',
  p_location text DEFAULT NULL,
  p_capacity integer DEFAULT 1,
  p_timezone text DEFAULT 'UTC',
  p_project_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS "api"."calendar_resources"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."calendar_resources";
BEGIN
  IF NOT "api"."storage_member_using"(p_workspace_id) THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;
  IF p_resource_type NOT IN ('instrument','room','equipment') THEN
    RAISE EXCEPTION 'unsupported resource type: %', p_resource_type USING ERRCODE = 'SB005';
  END IF;
  IF p_capacity IS NULL OR p_capacity < 1 THEN
    RAISE EXCEPTION 'capacity must be at least 1' USING ERRCODE = 'SB005';
  END IF;

  INSERT INTO "api"."calendar_resources"
    (workspace_id, project_id, name, code, resource_type, location,
     capacity, timezone, metadata, created_by_user_id, updated_by_user_id)
  VALUES
    (p_workspace_id, p_project_id, btrim(p_name), btrim(p_code),
     p_resource_type, p_location, p_capacity, COALESCE(p_timezone, 'UTC'),
     COALESCE(p_metadata, '{}'::jsonb),
     "api"."current_user_id"(), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_calendar_resource"(uuid, text, text, text, text, integer, text, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_calendar_resource"(uuid, text, text, text, text, integer, text, uuid, jsonb) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- create_booking: create a booking with participants and required samples.
-- Locks the resource row FOR UPDATE (serialising concurrent bookings for the
-- same resource) then rejects overlaps against active bookings.
--
-- p_participants: JSONB array of {userId?, displayName?, role} objects.
-- p_samples:      JSONB array of {sampleRecordId?, sampleIdentifier?,
--                 sampleTitle?, quantityValue?, quantityUnit?} objects.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."create_booking"(
  p_workspace_id uuid,
  p_resource_id uuid,
  p_title text,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_timezone text DEFAULT 'UTC',
  p_status text DEFAULT 'tentative',
  p_all_day boolean DEFAULT false,
  p_location text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_linked_experiment_record_id uuid DEFAULT NULL,
  p_participants jsonb DEFAULT '[]'::jsonb,
  p_samples jsonb DEFAULT '[]'::jsonb
)
RETURNS "api"."calendar_bookings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_resource "api"."calendar_resources";
  v_booking "api"."calendar_bookings";
  v_conflict "api"."calendar_bookings";
  v_part jsonb;
  v_samp jsonb;
  v_sample_id uuid;
  v_sample_rec "api"."records";
  v_user_id text;
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  IF v_ws_id IS NULL OR v_ws_id <> p_workspace_id THEN
    RAISE EXCEPTION 'not a member of the target workspace' USING ERRCODE = '42501';
  END IF;

  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'invalid time range: ends_at must be after starts_at'
      USING ERRCODE = 'SB023';
  END IF;
  IF p_status NOT IN ('tentative','confirmed') THEN
    RAISE EXCEPTION 'invalid initial status: %', p_status USING ERRCODE = 'SB005';
  END IF;

  -- Lock the resource row to serialise concurrent bookings for it.
  SELECT * INTO v_resource FROM "api"."calendar_resources"
    WHERE id = p_resource_id AND workspace_id = v_ws_id FOR UPDATE;
  IF v_resource IS NULL THEN
    RAISE EXCEPTION 'resource not found in active workspace' USING ERRCODE = 'SB021';
  END IF;
  IF v_resource.status = 'inactive' THEN
    RAISE EXCEPTION 'resource is inactive and cannot be booked' USING ERRCODE = 'SB005';
  END IF;

  -- Overlap detection against active (non-cancelled) bookings.
  SELECT * INTO v_conflict FROM "api"."calendar_bookings"
    WHERE resource_id = p_resource_id
      AND workspace_id = v_ws_id
      AND status <> 'cancelled'
      AND tstzrange(starts_at, ends_at) && tstzrange(p_starts_at, p_ends_at)
    LIMIT 1;
  IF v_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'booking overlaps with % (%)', v_conflict.title, v_conflict.id
      USING ERRCODE = 'SB020';
  END IF;

  -- Validate linked experiment belongs to the workspace.
  IF p_linked_experiment_record_id IS NOT NULL THEN
    SELECT * INTO v_sample_rec FROM "api"."records" WHERE id = p_linked_experiment_record_id;
    IF v_sample_rec IS NULL OR v_sample_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked experiment not found in active workspace'
        USING ERRCODE = 'SB016';
    END IF;
    IF v_sample_rec.kind <> 'experiment' THEN
      RAISE EXCEPTION 'linked record % is not an experiment', p_linked_experiment_record_id
        USING ERRCODE = 'SB009';
    END IF;
  END IF;

  v_user_id := "api"."current_user_id"();

  INSERT INTO "api"."calendar_bookings"
    (workspace_id, resource_id, project_id, title, status, all_day,
     starts_at, ends_at, timezone, location, color, notes,
     linked_experiment_record_id, linked_experiment_identifier,
     linked_experiment_title, created_by_user_id, updated_by_user_id)
  VALUES
    (v_ws_id, p_resource_id, p_project_id, btrim(p_title), p_status, p_all_day,
     p_starts_at, p_ends_at, COALESCE(p_timezone, 'UTC'), p_location, p_color,
     p_notes, p_linked_experiment_record_id,
     CASE WHEN p_linked_experiment_record_id IS NOT NULL THEN v_sample_rec.identifier ELSE NULL END,
     CASE WHEN p_linked_experiment_record_id IS NOT NULL THEN v_sample_rec.title ELSE NULL END,
     v_user_id, v_user_id)
  RETURNING * INTO v_booking;

  -- Participants: insert the caller as owner if no owner is supplied, then
  -- append the provided list (skipping duplicates of the caller).
  IF jsonb_typeof(p_participants) <> 'array' THEN
    RAISE EXCEPTION 'p_participants must be a JSON array' USING ERRCODE = 'SB005';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_participants) e
      WHERE e ->> 'role' = 'owner'
  ) THEN
    INSERT INTO "api"."calendar_booking_participants"
      (workspace_id, booking_id, user_id, display_name, role)
    VALUES (v_ws_id, v_booking.id, v_user_id, NULL, 'owner');
  END IF;
  FOR v_part IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
    INSERT INTO "api"."calendar_booking_participants"
      (workspace_id, booking_id, user_id, display_name, role)
    VALUES
      (v_ws_id, v_booking.id,
       NULLIF(v_part ->> 'userId', '') ,
       v_part ->> 'displayName',
       COALESCE(v_part ->> 'role', 'participant'))
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- Required samples.
  IF jsonb_typeof(p_samples) <> 'array' THEN
    RAISE EXCEPTION 'p_samples must be a JSON array' USING ERRCODE = 'SB005';
  END IF;
  FOR v_samp IN SELECT * FROM jsonb_array_elements(p_samples) LOOP
    v_sample_id := NULLIF(v_samp ->> 'sampleRecordId', '')::uuid;
    IF v_sample_id IS NOT NULL THEN
      SELECT * INTO v_sample_rec FROM "api"."records" WHERE id = v_sample_id;
      IF v_sample_rec IS NULL OR v_sample_rec.workspace_id <> v_ws_id THEN
        RAISE EXCEPTION 'sample % not found in active workspace', v_sample_id
          USING ERRCODE = 'SB016';
      END IF;
      IF v_sample_rec.kind <> 'sample' THEN
        RAISE EXCEPTION 'linked record % is not a sample', v_sample_id USING ERRCODE = 'SB009';
      END IF;
    END IF;
    INSERT INTO "api"."calendar_booking_samples"
      (workspace_id, booking_id, sample_record_id, sample_identifier,
       sample_title, quantity_value, quantity_unit)
    VALUES
      (v_ws_id, v_booking.id, v_sample_id,
       COALESCE(v_samp ->> 'sampleIdentifier',
         CASE WHEN v_sample_id IS NOT NULL THEN v_sample_rec.identifier ELSE NULL END),
       COALESCE(v_samp ->> 'sampleTitle',
         CASE WHEN v_sample_id IS NOT NULL THEN v_sample_rec.title ELSE NULL END),
       NULLIF(v_samp ->> 'quantityValue', '')::numeric,
       v_samp ->> 'quantityUnit');
  END LOOP;

  RETURN v_booking;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."create_booking"(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text, boolean, text, text, text, uuid, uuid, jsonb, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_booking"(uuid, uuid, text, timestamp with time zone, timestamp with time zone, text, text, boolean, text, text, text, uuid, uuid, jsonb, jsonb) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- edit_booking: update a booking's mutable fields and replace participants
-- and required samples atomically. Re-checks overlap excluding the booking's
-- own row. p_expected_metadata_version guards against stale concurrent edits.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."edit_booking"(
  p_booking_id uuid,
  p_title text DEFAULT NULL,
  p_starts_at timestamp with time zone DEFAULT NULL,
  p_ends_at timestamp with time zone DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_all_day boolean DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_linked_experiment_record_id uuid DEFAULT NULL,
  p_participants jsonb DEFAULT NULL,
  p_samples jsonb DEFAULT NULL,
  p_expected_metadata_version integer DEFAULT NULL
)
RETURNS "api"."calendar_bookings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_booking "api"."calendar_bookings";
  v_resource "api"."calendar_resources";
  v_conflict "api"."calendar_bookings";
  v_new_start timestamp with time zone;
  v_new_end timestamp with time zone;
  v_part jsonb;
  v_samp jsonb;
  v_sample_id uuid;
  v_sample_rec "api"."records";
  v_exp_rec "api"."records";
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  SELECT * INTO v_booking FROM "api"."calendar_bookings"
    WHERE id = p_booking_id AND workspace_id = v_ws_id FOR UPDATE;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking not found in active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'cannot edit a cancelled booking' USING ERRCODE = 'SB024';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_booking.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_booking.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_new_start := COALESCE(p_starts_at, v_booking.starts_at);
  v_new_end := COALESCE(p_ends_at, v_booking.ends_at);
  IF v_new_end <= v_new_start THEN
    RAISE EXCEPTION 'invalid time range: ends_at must be after starts_at'
      USING ERRCODE = 'SB023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('tentative','confirmed','cancelled') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'SB005';
  END IF;

  -- Lock the resource and re-check overlap if the time range changed.
  SELECT * INTO v_resource FROM "api"."calendar_resources"
    WHERE id = v_booking.resource_id AND workspace_id = v_ws_id FOR UPDATE;

  IF v_new_start <> v_booking.starts_at OR v_new_end <> v_booking.ends_at THEN
    SELECT * INTO v_conflict FROM "api"."calendar_bookings"
      WHERE resource_id = v_booking.resource_id
        AND workspace_id = v_ws_id
        AND status <> 'cancelled'
        AND id <> p_booking_id
        AND tstzrange(starts_at, ends_at) && tstzrange(v_new_start, v_new_end)
      LIMIT 1;
    IF v_conflict.id IS NOT NULL THEN
      RAISE EXCEPTION 'booking overlaps with % (%)', v_conflict.title, v_conflict.id
        USING ERRCODE = 'SB020';
    END IF;
  END IF;

  -- Validate linked experiment.
  IF p_linked_experiment_record_id IS NOT NULL THEN
    SELECT * INTO v_exp_rec FROM "api"."records" WHERE id = p_linked_experiment_record_id;
    IF v_exp_rec IS NULL OR v_exp_rec.workspace_id <> v_ws_id THEN
      RAISE EXCEPTION 'linked experiment not found in active workspace' USING ERRCODE = 'SB016';
    END IF;
    IF v_exp_rec.kind <> 'experiment' THEN
      RAISE EXCEPTION 'linked record % is not an experiment', p_linked_experiment_record_id
        USING ERRCODE = 'SB009';
    END IF;
  END IF;

  UPDATE "api"."calendar_bookings"
    SET title = COALESCE(btrim(p_title), title),
        starts_at = v_new_start,
        ends_at = v_new_end,
        timezone = COALESCE(p_timezone, timezone),
        status = COALESCE(p_status, status),
        all_day = COALESCE(p_all_day, all_day),
        location = COALESCE(p_location, location),
        color = COALESCE(p_color, color),
        notes = COALESCE(p_notes, notes),
        project_id = COALESCE(p_project_id, project_id),
        linked_experiment_record_id = COALESCE(p_linked_experiment_record_id, linked_experiment_record_id),
        linked_experiment_identifier = CASE
          WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.identifier
          ELSE linked_experiment_identifier END,
        linked_experiment_title = CASE
          WHEN p_linked_experiment_record_id IS NOT NULL THEN v_exp_rec.title
          ELSE linked_experiment_title END,
        metadata_version = metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"(),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_booking;

  -- Replace participants if supplied.
  IF p_participants IS NOT NULL THEN
    IF jsonb_typeof(p_participants) <> 'array' THEN
      RAISE EXCEPTION 'p_participants must be a JSON array' USING ERRCODE = 'SB005';
    END IF;
    DELETE FROM "api"."calendar_booking_participants" WHERE booking_id = p_booking_id;
    FOR v_part IN SELECT * FROM jsonb_array_elements(p_participants) LOOP
      INSERT INTO "api"."calendar_booking_participants"
        (workspace_id, booking_id, user_id, display_name, role)
      VALUES
        (v_ws_id, p_booking_id,
         NULLIF(v_part ->> 'userId', ''),
         v_part ->> 'displayName',
         COALESCE(v_part ->> 'role', 'participant'));
    END LOOP;
  END IF;

  -- Replace required samples if supplied.
  IF p_samples IS NOT NULL THEN
    IF jsonb_typeof(p_samples) <> 'array' THEN
      RAISE EXCEPTION 'p_samples must be a JSON array' USING ERRCODE = 'SB005';
    END IF;
    DELETE FROM "api"."calendar_booking_samples" WHERE booking_id = p_booking_id;
    FOR v_samp IN SELECT * FROM jsonb_array_elements(p_samples) LOOP
      v_sample_id := NULLIF(v_samp ->> 'sampleRecordId', '')::uuid;
      IF v_sample_id IS NOT NULL THEN
        SELECT * INTO v_sample_rec FROM "api"."records" WHERE id = v_sample_id;
        IF v_sample_rec IS NULL OR v_sample_rec.workspace_id <> v_ws_id THEN
          RAISE EXCEPTION 'sample % not found in active workspace', v_sample_id
            USING ERRCODE = 'SB016';
        END IF;
        IF v_sample_rec.kind <> 'sample' THEN
          RAISE EXCEPTION 'linked record % is not a sample', v_sample_id USING ERRCODE = 'SB009';
        END IF;
      END IF;
      INSERT INTO "api"."calendar_booking_samples"
        (workspace_id, booking_id, sample_record_id, sample_identifier,
         sample_title, quantity_value, quantity_unit)
      VALUES
        (v_ws_id, p_booking_id, v_sample_id,
         COALESCE(v_samp ->> 'sampleIdentifier',
           CASE WHEN v_sample_id IS NOT NULL THEN v_sample_rec.identifier ELSE NULL END),
         COALESCE(v_samp ->> 'sampleTitle',
           CASE WHEN v_sample_id IS NOT NULL THEN v_sample_rec.title ELSE NULL END),
         NULLIF(v_samp ->> 'quantityValue', '')::numeric,
         v_samp ->> 'quantityUnit');
    END LOOP;
  END IF;

  RETURN v_booking;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."edit_booking"(uuid, text, timestamp with time zone, timestamp with time zone, text, text, boolean, text, text, text, uuid, uuid, jsonb, jsonb, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."edit_booking"(uuid, text, timestamp with time zone, timestamp with time zone, text, text, boolean, text, text, text, uuid, uuid, jsonb, jsonb, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- duplicate_booking: create a copy of an existing booking at a new time range
-- (or the same range). Participants and required samples are copied. Overlap
-- detection applies to the new range.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."duplicate_booking"(
  p_booking_id uuid,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_title text DEFAULT NULL
)
RETURNS "api"."calendar_bookings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_src "api"."calendar_bookings";
  v_part jsonb;
  v_samp jsonb;
  v_new "api"."calendar_bookings";
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  SELECT * INTO v_src FROM "api"."calendar_bookings"
    WHERE id = p_booking_id AND workspace_id = v_ws_id;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'booking not found in active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'invalid time range: ends_at must be after starts_at'
      USING ERRCODE = 'SB023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'userId', user_id, 'displayName', display_name, 'role', role
    )),
    '[]'::jsonb
  ) INTO v_part FROM "api"."calendar_booking_participants"
    WHERE booking_id = p_booking_id;

  SELECT COALESCE(
    jsonb_agg(jsonb_build_object(
      'sampleRecordId', sample_record_id, 'sampleIdentifier', sample_identifier,
      'sampleTitle', sample_title, 'quantityValue', quantity_value::text,
      'quantityUnit', quantity_unit
    )),
    '[]'::jsonb
  ) INTO v_samp FROM "api"."calendar_booking_samples"
    WHERE booking_id = p_booking_id;

  v_new := "api"."create_booking"(
    v_ws_id, v_src.resource_id,
    COALESCE(p_title, v_src.title),
    p_starts_at, p_ends_at,
    v_src.timezone, v_src.status, v_src.all_day, v_src.location, v_src.color,
    v_src.notes, v_src.project_id, v_src.linked_experiment_record_id,
    v_part, v_samp
  );

  RETURN v_new;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."duplicate_booking"(uuid, timestamp with time zone, timestamp with time zone, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."duplicate_booking"(uuid, timestamp with time zone, timestamp with time zone, text) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- cancel_booking: soft-cancel a booking (status → cancelled, cancelled_at).
-- A cancelled booking frees the resource slot (overlap checks exclude it).
-- ===========================================================================

CREATE OR REPLACE FUNCTION "api"."cancel_booking"(
  p_booking_id uuid,
  p_expected_metadata_version integer DEFAULT NULL
)
RETURNS "api"."calendar_bookings"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ws_id uuid;
  v_booking "api"."calendar_bookings";
BEGIN
  v_ws_id := "api"."current_workspace_id"();
  SELECT * INTO v_booking FROM "api"."calendar_bookings"
    WHERE id = p_booking_id AND workspace_id = v_ws_id FOR UPDATE;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'booking not found in active workspace' USING ERRCODE = 'SB022';
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is already cancelled' USING ERRCODE = 'SB024';
  END IF;
  IF p_expected_metadata_version IS NOT NULL
     AND v_booking.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_booking.metadata_version USING ERRCODE = 'SB001';
  END IF;
  UPDATE "api"."calendar_bookings"
    SET status = 'cancelled',
        cancelled_at = now(),
        metadata_version = metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"(),
        updated_at = now()
    WHERE id = p_booking_id
    RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "api"."cancel_booking"(uuid, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."cancel_booking"(uuid, integer) TO authenticated;
--> statement-breakpoint

-- ===========================================================================
-- Widen the change-events entity vocabulary for calendar entities.
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
    'plate_design', 'plate_well', 'plate_layout_template',
    'calendar_resource', 'calendar_booking', 'calendar_booking_participant',
    'calendar_booking_sample'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_calendar"()
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
REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_calendar"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "change_event_calendar_resources"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."calendar_resources"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_calendar"('calendar_resource');
--> statement-breakpoint
CREATE TRIGGER "change_event_calendar_bookings"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."calendar_bookings"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_calendar"('calendar_booking');
--> statement-breakpoint
CREATE TRIGGER "change_event_calendar_booking_participants"
  AFTER INSERT OR DELETE ON "api"."calendar_booking_participants"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_calendar"('calendar_booking_participant');
--> statement-breakpoint
CREATE TRIGGER "change_event_calendar_booking_samples"
  AFTER INSERT OR DELETE ON "api"."calendar_booking_samples"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_calendar"('calendar_booking_sample');
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
