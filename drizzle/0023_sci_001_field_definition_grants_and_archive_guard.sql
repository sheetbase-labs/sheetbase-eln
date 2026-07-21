-- ===========================================================================
-- SCI-001 follow-up: record_field_definitions DML grants, archived-record
-- transition guard, and corrected property-validation trigger. Migration
-- 0022 defined RLS policies for owner-only writes on record_field_definitions
-- but did not grant INSERT/UPDATE/DELETE to authenticated, so PostgREST could
-- not reach the policies. It also left archived records transitionable, and
-- its validate_record_properties() checked boolean values with
-- jsonb_typeof(...) NOT IN ('true','false'), which never matches because
-- jsonb_typeof returns 'boolean' for both JSON true/false. This migration
-- fixes all three without modifying the applied 0022 migration.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Grant DML on record_field_definitions to authenticated. Owner-only writes
-- are enforced by the RLS policies from 0022; the table-level grants let
-- PostgREST (running as authenticated) reach the policies. Direct CRUD is the
-- intended surface (ADR 0026 §5), not RPCs.
-- ---------------------------------------------------------------------------
GRANT INSERT, UPDATE, DELETE ON "api"."record_field_definitions" TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen chk_change_events_entity_type to include record_field_definition,
-- emitted by the change-event trigger added in 0022. The original constraint
-- (0012) predated configurable property definitions.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."change_events" DROP CONSTRAINT "chk_change_events_entity_type";--> statement-breakpoint
ALTER TABLE "api"."change_events" ADD CONSTRAINT "chk_change_events_entity_type"
  CHECK ("api"."change_events"."entity_type" IN ('project', 'folder', 'record', 'block', 'record_link', 'scientific_table', 'scientific_row', 'formula', 'calculation', 'record_field_definition'));--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Correct the boolean type-check in validate_record_properties(). The 0022
-- version used jsonb_typeof(v_value) NOT IN ('true','false'), but jsonb_typeof
-- returns 'boolean' for JSON booleans, so every boolean value was rejected.
-- Replace the whole function body with the corrected check; the signature and
-- trigger attachment from 0022 are unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."validate_record_properties"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_def record;
  v_value jsonb;
  v_raw text;
  v_enum text[];
BEGIN
  -- Only kinds that use configurable properties have definitions.
  IF NEW.kind NOT IN ('sample', 'reagent', 'protocol_template') THEN
    RETURN NEW;
  END IF;
  IF NEW.properties IS NULL THEN
    NEW.properties := '{}'::jsonb;
  END IF;

  FOR v_def IN
    SELECT field_name, logical_type, nullable, validation
      FROM "api"."record_field_definitions"
      WHERE workspace_id = NEW.workspace_id
        AND kind = NEW.kind
        AND lifecycle = 'active'
  LOOP
    v_value := NEW.properties -> v_def.field_name;
    -- A missing key is null for validation purposes.
    IF jsonb_typeof(v_value) = 'null' OR v_value IS NULL THEN
      IF NOT v_def.nullable THEN
        RAISE EXCEPTION 'property "%" is required for kind %',
          v_def.field_name, NEW.kind USING ERRCODE = 'SB005';
      END IF;
      CONTINUE;
    END IF;

    -- Type-check the value against the logical_type.
    v_raw := v_value #>> '{}';
    CASE v_def.logical_type
      WHEN 'text' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be text', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'integer' THEN
        IF jsonb_typeof(v_value) <> 'number'
           OR v_raw !~ '^-?[0-9]+$' THEN
          RAISE EXCEPTION 'property "%" must be an integer', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'decimal' THEN
        IF jsonb_typeof(v_value) <> 'number'
           OR v_raw !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
          RAISE EXCEPTION 'property "%" must be a decimal number', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'boolean' THEN
        IF jsonb_typeof(v_value) <> 'boolean' THEN
          RAISE EXCEPTION 'property "%" must be a boolean', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'date' THEN
        IF jsonb_typeof(v_value) <> 'string'
           OR v_raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           OR v_raw::date IS NULL THEN
          RAISE EXCEPTION 'property "%" must be a date (YYYY-MM-DD)', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'timestamp' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be a timestamp', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
      WHEN 'category' THEN
        IF jsonb_typeof(v_value) <> 'string' THEN
          RAISE EXCEPTION 'property "%" must be a category string', v_def.field_name
            USING ERRCODE = 'SB005';
        END IF;
        v_enum := COALESCE(
          ARRAY(SELECT jsonb_array_elements_text(v_def.validation -> 'enum')),
          ARRAY[]::text[]
        );
        IF array_length(v_enum, 1) IS NOT NULL AND NOT (v_raw = ANY(v_enum)) THEN
          RAISE EXCEPTION 'property "%" must be one of: %',
            v_def.field_name, array_to_string(v_enum, ', ')
            USING ERRCODE = 'SB005';
        END IF;
      ELSE
        RAISE EXCEPTION 'unknown logical_type "%" for field "%"',
          v_def.logical_type, v_def.field_name USING ERRCODE = 'SB005';
    END CASE;
  END LOOP;

  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."validate_record_properties"() FROM PUBLIC;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Replace transition_record_status with a version that rejects transitions on
-- archived records. An archived record is historically frozen; restore it
-- before changing its status. Same signature as 0022, so CREATE OR REPLACE
-- updates the body in place. Raises SB004 invalid_transition for archived
-- records so callers see the same error category as other disallowed
-- transitions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."transition_record_status"(
  p_record_id uuid,
  p_target_status text,
  p_expected_metadata_version int
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_row "api"."records";
  v_allowed text[];
  v_transition_key text;
BEGIN
  SELECT * INTO v_row FROM "api"."records" WHERE id = p_record_id FOR UPDATE;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'record not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF v_row.metadata_version <> p_expected_metadata_version THEN
    RAISE EXCEPTION 'metadata version mismatch: expected %, got %',
      p_expected_metadata_version, v_row.metadata_version USING ERRCODE = 'SB001';
  END IF;
  IF v_row.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'archived records are frozen; restore before transitioning'
      USING ERRCODE = 'SB004';
  END IF;

  -- Per-kind transition matrix (decision 0026). Each entry is
  -- "from_status->to_status". Unknown kinds (experiment/report) have no
  -- controlled transitions: their status is free-form and changed via direct
  -- PATCH, not this RPC.
  v_transition_key := v_row.kind || ':' || v_row.status || '->' || p_target_status;
  v_allowed := ARRAY[
    'sample:available->reserved',
    'sample:available->consumed',
    'sample:available->quarantined',
    'sample:reserved->available',
    'sample:reserved->consumed',
    'sample:quarantined->available',
    'reagent:available->reserved',
    'reagent:available->consumed',
    'reagent:available->quarantined',
    'reagent:available->expired',
    'reagent:reserved->available',
    'reagent:reserved->consumed',
    'reagent:quarantined->available',
    'protocol_template:draft->active',
    'protocol_template:draft->under_review',
    'protocol_template:under_review->active',
    'protocol_template:under_review->draft',
    'protocol_template:active->draft'
  ];

  IF NOT (v_transition_key = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid status transition for kind %: % -> %',
      v_row.kind, v_row.status, p_target_status USING ERRCODE = 'SB004';
  END IF;

  UPDATE "api"."records"
    SET status = p_target_status,
        metadata_version = v_row.metadata_version + 1,
        updated_by_user_id = "api"."current_user_id"()
    WHERE id = p_record_id
    RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."transition_record_status"(uuid, text, int) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."transition_record_status"(uuid, text, int) TO authenticated;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
