-- ===========================================================================
-- REG-002: Samples registry — chain-of-custody / quantity event log and
-- controlled receive/consume/transfer mutations.
--
-- Samples are `records` rows with kind='sample'; their quantity, unit,
-- storage location and barcode live in `records.properties` JSONB (SCI-001,
-- decision 0026) and are validated by the existing
-- `internal.validate_record_properties` trigger against the workspace's
-- active `record_field_definitions`. This migration adds the durable,
-- append-only event log that records every custody and quantity change with
-- actor attribution, plus three SECURITY INVOKER RPCs that mutate a sample's
-- quantity/location atomically and append the matching event.
--
-- Design:
--   * `api.sample_events` is append-only. authenticated may SELECT (RLS,
--     members-read) and INSERT (RLS, actor = current_user_id, workspace
--     match) but never UPDATE or DELETE. The authoritative quantity is
--     always `records.properties`; the event log is the auditable history.
--   * `receive_sample`, `consume_sample`, `transfer_sample` are SECURITY
--     INVOKER (like `transition_record_status`): the records UPDATE and the
--     sample_events INSERT are both subject to records/sample_events RLS, so
--     PostgreSQL remains the access-control boundary. They lock the row,
--     check optimistic concurrency via metadata_version, enforce the
--     integrity rules (no negative quantity, no untraceable/same-location
--     transfer) and bump metadata_version with actor attribution.
--   * A change-event trigger widens the live feed so the inspector's custody
--     tab can be invalidated/replayed like every other domain entity.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- api.sample_events: append-only custody/quantity event log.
-- ---------------------------------------------------------------------------

CREATE TABLE "api"."sample_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "quantity_delta" numeric,
  "quantity_before" numeric,
  "quantity_after" numeric,
  "quantity_unit" text,
  "from_location" text,
  "to_location" text,
  "actor_user_id" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "sample_events_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sample_events_record_id_records_id_fk"
    FOREIGN KEY ("record_id") REFERENCES "api"."records"("id")
    ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "sample_events_actor_user_id_user_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id")
    ON DELETE set null ON UPDATE no action,
  CONSTRAINT "chk_sample_events_operation"
    CHECK ("operation" IN ('create','receive','consume','transfer','edit','archive','restore')),
  CONSTRAINT "chk_sample_events_quantity_presence"
    CHECK (("quantity_delta" IS NOT NULL) = ("quantity_before" IS NOT NULL)
           AND ("quantity_delta" IS NOT NULL) = ("quantity_after" IS NOT NULL)),
  CONSTRAINT "chk_sample_events_quantity_arithmetic"
    CHECK ("quantity_delta" IS NULL
           OR ("quantity_after" = ("quantity_before" + "quantity_delta")
               AND "quantity_after" >= 0)),
  CONSTRAINT "chk_sample_events_receive_delta"
    CHECK ("operation" <> 'receive' OR "quantity_delta" > 0),
  CONSTRAINT "chk_sample_events_consume_delta"
    CHECK ("operation" <> 'consume' OR "quantity_delta" < 0),
  CONSTRAINT "chk_sample_events_transfer_locations"
    CHECK ("operation" <> 'transfer'
           OR ("from_location" IS NOT NULL AND "to_location" IS NOT NULL
               AND "from_location" <> "to_location"))
);

CREATE INDEX "idx_sample_events_record_created"
  ON "api"."sample_events" ("record_id", "created_at");
CREATE INDEX "idx_sample_events_workspace_created"
  ON "api"."sample_events" ("workspace_id", "created_at");
CREATE INDEX "idx_sample_events_operation"
  ON "api"."sample_events" ("operation");

ALTER TABLE "api"."sample_events" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "api"."sample_events" TO authenticated;
GRANT SELECT ON "api"."sample_events" TO api_client;
GRANT INSERT ON "api"."sample_events" TO authenticated;

CREATE POLICY "sample_events_select" ON "api"."sample_events"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));

CREATE POLICY "sample_events_select_api_client" ON "api"."sample_events"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());

CREATE POLICY "sample_events_insert" ON "api"."sample_events"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_member"("workspace_id")
              AND "actor_user_id" = "api"."current_user_id"()
              AND EXISTS (
                SELECT 1 FROM "api"."records" r
                WHERE r.id = "record_id"
                  AND r.workspace_id = "workspace_id"
                  AND r.kind = 'sample'
              ));

-- ---------------------------------------------------------------------------
-- Widen the change-events entity vocabulary so sample_event rows emit a
-- durable, live-reconcilable event (decision 0016). The operation is always
-- 'create' for a new event row; the sample-specific operation rides inside
-- the payload.
-- ---------------------------------------------------------------------------

ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";
--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN (
    'project', 'folder', 'record', 'block', 'record_link',
    'scientific_table', 'scientific_row', 'formula', 'calculation',
    'record_field_definition', 'file', 'dataset_schema',
    'dataset_schema_field', 'dataset_schema_relationship', 'sample_event'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."trg_change_event_sample_events"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := jsonb_build_object(
    'operation', NEW.operation,
    'recordId', NEW.record_id,
    'quantityDelta', NEW.quantity_delta,
    'quantityAfter', NEW.quantity_after,
    'quantityUnit', NEW.quantity_unit,
    'fromLocation', NEW.from_location,
    'toLocation', NEW.to_location
  );
  PERFORM "internal"."emit_change_event"(
    NEW.workspace_id,
    'sample_event',
    NEW.id,
    'create',
    NEW.record_id,
    NULL,
    v_payload
  );
  RETURN NULL;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_sample_events"() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "change_event_sample_events"
  AFTER INSERT ON "api"."sample_events"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_sample_events"();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Controlled mutations. SECURITY INVOKER: the records UPDATE and the
-- sample_events INSERT are both subject to RLS, so workspace membership and
-- actor attribution are enforced by PostgreSQL. Each RPC locks the sample
-- row, checks optimistic concurrency via metadata_version, refuses to
-- operate on archived samples, and bumps metadata_version with the current
-- user as updated_by. Error codes follow the SB0xx convention (SB006
-- insufficient_quantity, SB007 same_location, SB008 missing_location,
-- SB009 not_a_sample).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."receive_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_unit text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_before numeric;
  v_after numeric;
  v_unit text;
  v_props jsonb;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'receive quantity must be positive' USING ERRCODE = 'SB006';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot receive an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_before := COALESCE(NULLIF(v_row.properties ->> 'quantity', '')::numeric, 0);
  v_after := v_before + p_quantity;
  v_unit := COALESCE(p_unit, v_row.properties ->> 'quantityUnit');
  v_props := v_row.properties
    || jsonb_build_object('quantity', v_after, 'quantityUnit', v_unit);
  IF p_location IS NOT NULL AND btrim(p_location) <> '' THEN
    v_props := v_props || jsonb_build_object('storageLocation', btrim(p_location));
  END IF;

  UPDATE "api"."records"
    SET properties = v_props,
        status = CASE WHEN v_row.status = 'consumed' THEN 'available' ELSE v_row.status END,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, quantity_delta, quantity_before,
     quantity_after, quantity_unit, to_location, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'receive', p_quantity, v_before, v_after,
     v_unit, p_location, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."receive_sample"(uuid, numeric, int, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."receive_sample"(uuid, numeric, int, text, text, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."consume_sample"(
  p_record_id uuid,
  p_quantity numeric,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_before numeric;
  v_after numeric;
  v_unit text;
  v_props jsonb;
  v_status text;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'consume quantity must be positive' USING ERRCODE = 'SB006';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot consume an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_before := NULLIF(v_row.properties ->> 'quantity', '')::numeric;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'sample has no quantity to consume' USING ERRCODE = 'SB006';
  END IF;
  v_after := v_before - p_quantity;
  IF v_after < 0 THEN
    RAISE EXCEPTION 'insufficient quantity: have %, consuming %', v_before, p_quantity
      USING ERRCODE = 'SB006';
  END IF;
  v_unit := v_row.properties ->> 'quantityUnit';
  v_props := v_row.properties || jsonb_build_object('quantity', v_after);
  -- When the sample is fully consumed, transition to the consumed lifecycle
  -- state (a permitted available/reserved -> consumed move).
  v_status := CASE WHEN v_after = 0 THEN 'consumed' ELSE v_row.status END;

  UPDATE "api"."records"
    SET properties = v_props,
        status = v_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, quantity_delta, quantity_before,
     quantity_after, quantity_unit, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'consume', -p_quantity, v_before, v_after,
     v_unit, "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."consume_sample"(uuid, numeric, int, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."transfer_sample"(
  p_record_id uuid,
  p_to_location text,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_from text;
  v_to text;
  v_props jsonb;
BEGIN
  v_to := btrim(COALESCE(p_to_location, ''));
  IF v_to = '' THEN
    RAISE EXCEPTION 'a destination location is required for transfer'
      USING ERRCODE = 'SB008';
  END IF;

  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot transfer an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_from := v_row.properties ->> 'storageLocation';
  IF v_from IS NOT NULL AND v_from = v_to THEN
    RAISE EXCEPTION 'sample is already at %', v_to USING ERRCODE = 'SB007';
  END IF;
  -- An untraceable move (no current location) is allowed only the first time:
  -- receiving establishes the location. A transfer must move FROM a known
  -- location TO a different one, so the chain of custody stays traceable.
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'sample has no current location to transfer from; receive it first'
      USING ERRCODE = 'SB008';
  END IF;

  v_props := v_row.properties || jsonb_build_object('storageLocation', v_to);

  UPDATE "api"."records"
    SET properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, from_location, to_location,
     actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'transfer', v_from, v_to,
     "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."transfer_sample"(uuid, text, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."transfer_sample"(uuid, text, int, text) TO authenticated;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- edit / archive / restore: single-record controlled mutations that update
-- the sample and append the matching custody event atomically. SECURITY
-- INVOKER: records UPDATE + sample_events INSERT are both RLS-gated.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "api"."edit_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_title text DEFAULT NULL,
  p_properties jsonb DEFAULT NULL,
  p_tags text[] DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
  v_props jsonb;
  v_title text;
  v_tags text[];
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'cannot edit an archived sample' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  v_props := v_row.properties;
  IF p_properties IS NOT NULL THEN
    -- quantity / quantityUnit / storageLocation are controlled by the
    -- audited receive / consume / transfer RPCs. edit_sample must not let a
    -- caller mutate them directly, or quantity and chain-of-custody changes
    -- would bypass the event log and its integrity checks.
    v_props := v_props || (
      p_properties - 'quantity' - 'quantityUnit' - 'storageLocation'
    );
  END IF;
  v_title := COALESCE(NULLIF(btrim(p_title), ''), v_row.title);
  v_tags := COALESCE(p_tags, v_row.tags);

  UPDATE "api"."records"
    SET title = v_title,
        tags = v_tags,
        properties = v_props,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'edit', "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."edit_sample"(uuid, int, text, jsonb, text[], text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."edit_sample"(uuid, int, text, jsonb, text[], text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."archive_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'sample is already archived' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
    SET archived_at = now(),
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'archive', "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."archive_sample"(uuid, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."archive_sample"(uuid, int, text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."restore_sample"(
  p_record_id uuid,
  p_expected_metadata_version int,
  p_notes text DEFAULT NULL
)
RETURNS "api"."records"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_row "api"."records";
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.kind <> 'sample' THEN
    RAISE EXCEPTION 'record % is not a sample', p_record_id USING ERRCODE = 'SB009';
  END IF;
  IF v_row.archived_at IS NULL THEN
    RAISE EXCEPTION 'sample is not archived' USING ERRCODE = 'SB004';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;

  UPDATE "api"."records"
    SET archived_at = NULL,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  INSERT INTO "api"."sample_events"
    (workspace_id, record_id, operation, actor_user_id, notes)
  VALUES
    (v_row.workspace_id, v_row.id, 'restore', "api"."current_user_id"(), p_notes);

  RETURN v_row;
END;
$$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."restore_sample"(uuid, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."restore_sample"(uuid, int, text) TO authenticated;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
