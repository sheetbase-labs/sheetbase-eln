-- ADR-0054 / R5-CONFIG-06 — a booking's subject is the instrument.
--
-- Schedule books api.calendar_resources and the registry lists api.instruments, joined only by an
-- optional metadata.instrumentId convention. That made a registered instrument unbookable, left a
-- booking unable to name its instrument, and let migration 0366's qualification/calibration guard
-- be skipped by leaving the key out.
--
-- An instrument's calendar resource is now derived, never authored: every instrument has exactly
-- one api.calendar_resources row whose id IS the instrument id, resource_type is 'instrument', and
-- whose name, code, location and active/retired status are kept in step by a trigger on
-- api.instruments. A booking's resource_id is therefore the instrument id, so readers join
-- api.instruments i on i.id = b.resource_id and never parse metadata.
--
-- Existing bookings are repointed by matching the resource name to an instrument in the same
-- workspace; a booking whose resource names no instrument fails this migration loudly rather than
-- being orphaned or guessed. api.calendar_resources stays: the study planner
-- (api.study_task_resources.calendar_resource_id) and future rooms and benches use it.
--
-- Migration 0366 gated the booking guard on IF v_resource.metadata ? 'instrumentId'. That gate is
-- superseded here by internal.assert_instrument_bookable, which create_booking (and edit_booking,
-- when it moves a booking to a new slot) applies unconditionally for resource_type = 'instrument'.

-- ---------------------------------------------------------------------------
-- The registry owns the instrument resource.
-- ---------------------------------------------------------------------------

-- A hand-written instrument resource cannot drift from the registry: its identity fields are
-- derived from the instrument and a row whose id is not an instrument is refused. Capacity,
-- timezone, project and audit columns stay the caller's. metadata is deliberately not touched:
-- metadata.instrumentId is kept on generated rows for compatibility, but nothing depends on it
-- (ADR-0054), so a row that arrives without it stays without it.
CREATE OR REPLACE FUNCTION "internal"."derive_instrument_resource"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instrument "api"."instruments";
BEGIN
  IF NEW.resource_type <> 'instrument' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_instrument FROM "api"."instruments" WHERE id = NEW.id;
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'an instrument resource is derived from the instrument registry: no instrument %', NEW.id
      USING ERRCODE = 'SB021';
  END IF;
  NEW.workspace_id := v_instrument.workspace_id;
  NEW.name := v_instrument.name;
  NEW.code := coalesce(nullif(btrim(v_instrument.display_id), ''),
                      'INS-' || substr(v_instrument.id::text, 1, 8));
  NEW.location := v_instrument.location;
  NEW.status := CASE WHEN v_instrument.retired_at IS NULL THEN 'active' ELSE 'inactive' END;
  RETURN NEW;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."derive_instrument_resource"() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
CREATE TRIGGER "derive_instrument_resource"
  BEFORE INSERT OR UPDATE ON "api"."calendar_resources"
  FOR EACH ROW EXECUTE FUNCTION "internal"."derive_instrument_resource"();
--> statement-breakpoint

-- The resource is created with the instrument, kept in step with it, and removed with it.
CREATE OR REPLACE FUNCTION "internal"."sync_instrument_resource"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "api"."calendar_resources"
     WHERE id = OLD.id AND resource_type = 'instrument';
    RETURN NULL;
  END IF;

  INSERT INTO "api"."calendar_resources"
    (id, workspace_id, name, code, resource_type, location, capacity, timezone,
     status, metadata, created_by_user_id, updated_by_user_id)
  VALUES
    (NEW.id, NEW.workspace_id, NEW.name,
     coalesce(nullif(btrim(NEW.display_id), ''), 'INS-' || substr(NEW.id::text, 1, 8)),
     'instrument', NEW.location, 1, 'UTC',
     CASE WHEN NEW.retired_at IS NULL THEN 'active' ELSE 'inactive' END,
     jsonb_build_object('instrumentId', NEW.id),
     NEW.created_by_user_id, NEW.updated_by_user_id)
  ON CONFLICT (id) DO UPDATE
    SET name = excluded.name,
        code = excluded.code,
        location = excluded.location,
        status = excluded.status,
        metadata = excluded.metadata,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    WHERE "api"."calendar_resources"."name" IS DISTINCT FROM excluded.name
       OR "api"."calendar_resources"."code" IS DISTINCT FROM excluded.code
       OR "api"."calendar_resources"."location" IS DISTINCT FROM excluded.location
       OR "api"."calendar_resources"."status" IS DISTINCT FROM excluded.status;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."sync_instrument_resource"() FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
CREATE TRIGGER "sync_instrument_resource"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."instruments"
  FOR EACH ROW EXECUTE FUNCTION "internal"."sync_instrument_resource"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill every existing instrument, then repoint existing bookings.
-- ---------------------------------------------------------------------------

INSERT INTO "api"."calendar_resources"
  (id, workspace_id, name, code, resource_type, location, capacity, timezone,
   status, metadata, created_by_user_id, updated_by_user_id)
SELECT i.id, i.workspace_id, i.name,
       coalesce(nullif(btrim(i.display_id), ''), 'INS-' || substr(i.id::text, 1, 8)),
       'instrument', i.location, 1, 'UTC',
       CASE WHEN i.retired_at IS NULL THEN 'active' ELSE 'inactive' END,
       jsonb_build_object('instrumentId', i.id),
       i.created_by_user_id, i.updated_by_user_id
  FROM "api"."instruments" i
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- A hand-authored instrument resource is now redundant: its bookings (and any planned allocation
-- that names it) move to the instrument of the same name, and the row is removed. A resource that
-- names no instrument while something depends on it stops the migration rather than being
-- orphaned, and an ambiguous name is not guessed at.
DO $repoint$
DECLARE
  v_resource record;
  v_matches uuid[];
BEGIN
  FOR v_resource IN
    SELECT r.id, r.workspace_id, r.name
      FROM "api"."calendar_resources" r
     WHERE r.resource_type = 'instrument'
       AND NOT EXISTS (SELECT 1 FROM "api"."instruments" i WHERE i.id = r.id)
     ORDER BY r.workspace_id, r.name
  LOOP
    SELECT array_agg(i.id ORDER BY i.id) INTO v_matches
      FROM "api"."instruments" i
     WHERE i.workspace_id = v_resource.workspace_id
       AND i.name = v_resource.name;

    IF v_matches IS NULL OR array_length(v_matches, 1) = 0 THEN
      IF EXISTS (SELECT 1 FROM "api"."calendar_bookings" b WHERE b.resource_id = v_resource.id)
         OR EXISTS (SELECT 1 FROM "api"."study_task_resources" t WHERE t.calendar_resource_id = v_resource.id) THEN
        RAISE EXCEPTION 'calendar resource % (%) is used but names no instrument in workspace %: register the instrument or move the booking, then re-run this migration',
          v_resource.id, v_resource.name, v_resource.workspace_id USING ERRCODE = 'SB021';
      END IF;
      RAISE NOTICE 'removing redundant instrument resource % (%)', v_resource.id, v_resource.name;
      DELETE FROM "api"."calendar_resources" WHERE id = v_resource.id;
      CONTINUE;
    END IF;

    IF array_length(v_matches, 1) > 1 THEN
      RAISE EXCEPTION 'calendar resource % (%) matches % instruments in workspace %: name them apart, then re-run this migration',
        v_resource.id, v_resource.name, array_length(v_matches, 1), v_resource.workspace_id
        USING ERRCODE = 'SB021';
    END IF;

    RAISE NOTICE 'repointing bookings and planned allocations from resource % (%) to instrument %',
      v_resource.id, v_resource.name, v_matches[1];
    UPDATE "api"."calendar_bookings"
       SET resource_id = v_matches[1], updated_at = now()
     WHERE resource_id = v_resource.id;
    UPDATE "api"."study_task_resources"
       SET calendar_resource_id = v_matches[1]
     WHERE calendar_resource_id = v_resource.id;
    DELETE FROM "api"."calendar_resources" WHERE id = v_resource.id;
  END LOOP;
END $repoint$;
--> statement-breakpoint

COMMENT ON TABLE "api"."calendar_resources" IS
  'ADR-0054 — bookable resources. An instrument''s row is derived from api.instruments (id = the instrument id, resource_type = ''instrument'', name/code/location/status kept in step by a trigger); rooms, benches and other resources are authored here.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The booking rules, applied unconditionally.
-- ---------------------------------------------------------------------------

-- One place states what booking an instrument requires, so create_booking and edit_booking cannot
-- drift: the instrument must exist in the workspace, must not be retired, the booker must hold a
-- current qualification (SB115), and the latest calibration must not be overdue (SB116). The codes
-- and messages are migration 0366's; only the metadata gate is gone.
CREATE OR REPLACE FUNCTION "internal"."assert_instrument_bookable"(
  p_resource "api"."calendar_resources"
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_instrument "api"."instruments";
BEGIN
  IF p_resource.resource_type IS DISTINCT FROM 'instrument' THEN
    RETURN;
  END IF;

  SELECT * INTO v_instrument FROM "api"."instruments"
   WHERE id = p_resource.id
     AND workspace_id = p_resource.workspace_id;
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB021';
  END IF;
  IF v_instrument.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'resource is inactive and cannot be booked' USING ERRCODE = 'SB005';
  END IF;
  IF NOT "internal"."instrument_qualified"(v_instrument.id, "api"."current_user_id"()) THEN
    RAISE EXCEPTION 'a current qualification is required to book this instrument' USING ERRCODE = 'SB115';
  END IF;
  IF EXISTS (SELECT 1 FROM "api"."instrument_calibrations" c
              WHERE c.instrument_id = v_instrument.id
                AND c.due_at IS NOT NULL AND c.due_at < now()) THEN
    RAISE EXCEPTION 'the instrument calibration is overdue' USING ERRCODE = 'SB116';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."assert_instrument_bookable"("api"."calendar_resources") FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint

DO $patch$
DECLARE
  definition text;
  anchor text;
BEGIN
  definition := pg_get_functiondef('api.create_booking(uuid,uuid,text,timestamptz,timestamptz,text,text,boolean,text,text,text,uuid,uuid,jsonb,jsonb)'::regprocedure);

  anchor := $anchor$
  -- LAB-06.3: an instrument resource needs a qualified booker and current
  -- calibration before it can be booked.
  IF v_resource.metadata ? 'instrumentId' THEN
    SELECT * INTO v_instrument FROM api.instruments
     WHERE id = nullif(v_resource.metadata->>'instrumentId', '')::uuid
       AND workspace_id = v_ws_id;
    IF v_instrument.id IS NULL THEN
      RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = 'SB021';
    END IF;
    IF NOT internal.instrument_qualified(v_instrument.id, api.current_user_id()) THEN
      RAISE EXCEPTION 'a current qualification is required to book this instrument' USING ERRCODE = 'SB115';
    END IF;
    IF EXISTS (SELECT 1 FROM api.instrument_calibrations c
                WHERE c.instrument_id = v_instrument.id
                  AND c.due_at IS NOT NULL AND c.due_at < now()) THEN
      RAISE EXCEPTION 'the instrument calibration is overdue' USING ERRCODE = 'SB116';
    END IF;
  END IF;$anchor$;
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'create_booking instrument guard anchor missing; refusing to patch blindly';
  END IF;

  EXECUTE replace(definition, anchor, $replacement$
  -- ADR-0054: a booking of an instrument resource IS a booking of that instrument
  -- (resource_id = instruments.id), so the rules apply unconditionally and no
  -- metadata key can switch them off.
  PERFORM internal.assert_instrument_bookable(v_resource);$replacement$);
END $patch$;
--> statement-breakpoint

-- Moving a booking to a new slot is booking that slot, so the same rules run when the time range
-- changes. A title or note edit of an existing booking stays an edit of history.
DO $patch$
DECLARE
  definition text;
  anchor text;
BEGIN
  definition := pg_get_functiondef('api.edit_booking(uuid,text,timestamptz,timestamptz,text,text,boolean,text,text,text,uuid,uuid,jsonb,jsonb,integer)'::regprocedure);

  anchor := E'  IF v_new_start <> v_booking.starts_at OR v_new_end <> v_booking.ends_at THEN\n';
  IF strpos(definition, anchor) = 0 THEN
    RAISE EXCEPTION 'edit_booking time-range anchor missing; refusing to patch blindly';
  END IF;

  EXECUTE replace(definition, anchor,
    anchor || E'    -- ADR-0054: a new slot for an instrument booking obeys the same rules.\n'
           || E'    PERFORM internal.assert_instrument_bookable(v_resource);\n');
END $patch$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
