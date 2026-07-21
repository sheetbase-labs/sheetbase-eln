CREATE TABLE "api"."record_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"field_name" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"display_order" integer NOT NULL,
	"logical_type" text NOT NULL,
	"nullable" boolean DEFAULT true NOT NULL,
	"default_value" jsonb,
	"unit" jsonb,
	"validation" jsonb DEFAULT '{}' NOT NULL,
	"lifecycle" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text NOT NULL,
	CONSTRAINT "uq_record_field_definitions_workspace_kind_field" UNIQUE("workspace_id","kind","field_name"),
	CONSTRAINT "chk_record_field_definitions_kind" CHECK ("api"."record_field_definitions"."kind" IN ('sample', 'reagent', 'protocol_template')),
	CONSTRAINT "chk_record_field_definitions_type" CHECK ("api"."record_field_definitions"."logical_type" IN ('text','integer','decimal','boolean','date','timestamp','category')),
	CONSTRAINT "chk_record_field_definitions_lifecycle" CHECK ("api"."record_field_definitions"."lifecycle" IN ('active', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "api"."records" DROP CONSTRAINT "chk_records_kind";--> statement-breakpoint
ALTER TABLE "api"."records" ADD COLUMN "properties" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "api"."record_field_definitions" ADD CONSTRAINT "record_field_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_field_definitions" ADD CONSTRAINT "record_field_definitions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_record_field_definitions_workspace_kind" ON "api"."record_field_definitions" USING btree ("workspace_id","kind");--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "chk_records_kind" CHECK ("api"."records"."kind" IN ('experiment', 'protocol_template', 'report', 'sample', 'reagent'));
-- ===========================================================================
-- SCI-001: scientific record foundations (decision 0026).
-- The generated DDL above added record_field_definitions, records.properties
-- and widened chk_records_kind. The procedural parts below add workspace RLS,
-- change-event emission, immutable-identity guards, the widened create_record
-- (sample/reagent + properties) and the transition_record_status lifecycle
-- RPC. No applied migration is modified.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- RLS on record_field_definitions. Workspace-isolated; members read, owners
-- write the configurable schema. api_client reads with workspace pinning.
-- Mirrors the scientific_columns policy shape (migration 0013).
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."record_field_definitions" ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON "api"."record_field_definitions" TO authenticated;
GRANT SELECT ON "api"."record_field_definitions" TO api_client;

CREATE POLICY "record_field_definitions_select" ON "api"."record_field_definitions"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id"));

CREATE POLICY "record_field_definitions_select_api_client" ON "api"."record_field_definitions"
  FOR SELECT TO api_client
  USING ("workspace_id" = "api"."current_workspace_id"());

CREATE POLICY "record_field_definitions_insert" ON "api"."record_field_definitions"
  FOR INSERT TO authenticated
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"()
              AND "api"."is_workspace_member"("workspace_id", 'owner')
              AND "created_by_user_id" = "api"."current_user_id"());

CREATE POLICY "record_field_definitions_update" ON "api"."record_field_definitions"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id", 'owner'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"());

CREATE POLICY "record_field_definitions_delete" ON "api"."record_field_definitions"
  FOR DELETE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"()
         AND "api"."is_workspace_member"("workspace_id", 'owner'));

-- ---------------------------------------------------------------------------
-- Immutable identity guard: workspace_id, kind and field_name are immutable
-- after creation. Renaming a field renames the label, not the storage key, so
-- records.properties keys stay stable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."guard_record_field_definitions_identity"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.field_name IS DISTINCT FROM OLD.field_name THEN
      RAISE EXCEPTION 'record field definition identity (workspace_id, kind, field_name) is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."guard_record_field_definitions_identity"() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER "record_field_definitions_immutable"
  BEFORE UPDATE ON "api"."record_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_record_field_definitions_identity"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Change-event trigger for record_field_definitions, following the pattern in
-- migration 0012. Emits record_field_definition create/update/delete events
-- so configurable-schema changes are durable and live-reconcilable.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."trg_change_event_record_field_definitions"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
  v_payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'create';
    v_payload := jsonb_build_object(
      'kind', NEW.kind, 'fieldName', NEW.field_name, 'label', NEW.label,
      'logicalType', NEW.logical_type, 'lifecycle', NEW.lifecycle
    );
  ELSIF TG_OP = 'UPDATE' THEN
    v_op := 'update';
    v_payload := jsonb_build_object(
      'kind', NEW.kind, 'fieldName', NEW.field_name, 'label', NEW.label,
      'lifecycle', NEW.lifecycle,
      'changedLabel', (OLD.label IS DISTINCT FROM NEW.label),
      'changedLifecycle', (OLD.lifecycle IS DISTINCT FROM NEW.lifecycle)
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_op := 'delete';
    v_payload := jsonb_build_object(
      'kind', OLD.kind, 'fieldName', OLD.field_name
    );
  END IF;
  PERFORM "internal"."emit_change_event"(
    COALESCE(NEW.workspace_id, OLD.workspace_id),
    'record_field_definition',
    COALESCE(NEW.id, OLD.id),
    v_op,
    COALESCE(NEW.id, OLD.id),
    NULL,
    v_payload
  );
  RETURN NULL;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "internal"."trg_change_event_record_field_definitions"() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER "change_event_record_field_definitions"
  AFTER INSERT OR UPDATE OR DELETE ON "api"."record_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."trg_change_event_record_field_definitions"();--> statement-breakpoint

-- updated_at maintenance for record_field_definitions.
CREATE TRIGGER "set_updated_at_record_field_definitions"
  BEFORE UPDATE ON "api"."record_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Widen create_record: accept sample and reagent kinds and an optional
-- p_properties JSONB argument. The kind->prefix CASE gains SMP and RGT. The
-- per-(project, prefix, year) sequence and all existing guards are unchanged.
-- SECURITY INVOKER: the INSERT is still subject to records RLS.
-- ---------------------------------------------------------------------------
-- Drop the existing signatures first: CREATE OR REPLACE with a different
-- argument count would create an overload, leaving the old 5-arg
-- create_record and 6-arg create_record_with_blocks callable and making
-- calls ambiguous. DROP + CREATE replaces cleanly.
DROP FUNCTION IF EXISTS "api"."create_record"(uuid, text, text, text, text[]);
DROP FUNCTION IF EXISTS "api"."create_record_with_blocks"(uuid, text, text, text, text[], jsonb);
CREATE OR REPLACE FUNCTION "api"."create_record"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_properties jsonb DEFAULT '{}'
)
RETURNS "api"."records"
LANGUAGE plpgsql
AS $$
DECLARE
  v_workspace_id uuid;
  v_prefix text;
  v_year text := to_char(now(), 'YYYY');
  v_seq int;
  v_identifier text;
  v_row "api"."records";
BEGIN
  v_workspace_id := "api"."current_workspace_id"();
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'no active workspace in request claims' USING ERRCODE = '42804';
  END IF;
  IF NOT "api"."is_workspace_member"(v_workspace_id) THEN
    RAISE EXCEPTION 'caller is not a member of the active workspace' USING ERRCODE = '42501';
  END IF;

  -- Kind -> prefix. Widen here when a new record kind is added to the check
  -- constraint (decision 0015, 0026).
  v_prefix := CASE p_kind
    WHEN 'experiment' THEN 'EXP'
    WHEN 'protocol_template' THEN 'PRT'
    WHEN 'report' THEN 'RPT'
    WHEN 'sample' THEN 'SMP'
    WHEN 'reagent' THEN 'RGT'
    ELSE NULL
  END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'unsupported record kind: %', p_kind USING ERRCODE = '23514';
  END IF;

  -- Verify the project is in the caller's workspace (RLS also enforces this
  -- on the INSERT, but checking here gives a clear error before the INSERT).
  IF NOT EXISTS (
    SELECT 1 FROM "api"."projects" p
    WHERE p.id = p_project_id
      AND p.workspace_id = v_workspace_id
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;

  -- Per-(project, prefix, year) sequence from the existing identifiers.
  SELECT count(*) + 1 INTO v_seq
    FROM "api"."records"
    WHERE project_id = p_project_id
      AND identifier LIKE v_prefix || '-' || v_year || '-%';

  v_identifier := v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  -- Normalise the title.
  p_title := btrim(coalesce(p_title, ''));
  IF p_title = '' THEN
    p_title := v_identifier;
  END IF;

  INSERT INTO "api"."records"
    (workspace_id, project_id, kind, identifier, title, status, tags,
     properties, created_by_user_id)
  VALUES
    (v_workspace_id, p_project_id, p_kind, v_identifier, p_title, p_status,
     p_tags, COALESCE(p_properties, '{}'::jsonb), "api"."current_user_id"())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[], jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record"(uuid, text, text, text, text[], jsonb) TO authenticated;--> statement-breakpoint

-- The create_record_with_blocks RPC forwards to create_record; recreate it so
-- its call signature matches the widened create_record (it passes no
-- properties, defaulting to '{}'). The body is otherwise identical to
-- migration 0010.
CREATE OR REPLACE FUNCTION "api"."create_record_with_blocks"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_blocks jsonb DEFAULT '[]',
  p_properties jsonb DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_record "api"."records";
  v_blocks jsonb := coalesce(p_blocks, '[]'::jsonb);
  v_block jsonb;
  v_rows jsonb[] := ARRAY[]::jsonb[];
  v_order real;
  v_i int := 0;
  v_row "api"."blocks";
BEGIN
  v_record := "api"."create_record"(p_project_id, p_kind, p_title, p_status, p_tags, p_properties);

  FOR v_block IN SELECT * FROM jsonb_array_elements(v_blocks)
  LOOP
    v_i := v_i + 1;
    IF v_block ? 'order' THEN
      v_order := (v_block ->> 'order')::real;
    ELSE
      v_order := v_i::real;
    END IF;

    INSERT INTO "api"."blocks" (
      record_id, type, payload, payload_schema_version, "order",
      created_by_user_id
    ) VALUES (
      v_record.id,
      v_block ->> 'type',
      COALESCE(v_block -> 'payload', '{}'::jsonb),
      COALESCE((v_block ->> 'payload_schema_version')::int, 1),
      v_order,
      "api"."current_user_id"()
    )
    RETURNING * INTO v_row;

    v_rows := array_append(v_rows, to_jsonb(v_row));
  END LOOP;

  RETURN jsonb_build_object(
    'record', to_jsonb(v_record),
    'blocks', COALESCE(
      (SELECT jsonb_agg(e) FROM unnest(v_rows) AS e),
      '[]'::jsonb
    )
  );
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_record_with_blocks"(uuid, text, text, text, text[], jsonb, jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record_with_blocks"(uuid, text, text, text, text[], jsonb, jsonb) TO authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- transition_record_status: kind-specific lifecycle transition RPC. Enforces a
-- per-kind transition matrix at the database so a stale or hostile client
-- cannot move a record to an incoherent state. Bumps metadata_version, stamps
-- updated_by_user_id; the existing change_event_records trigger emits the
-- event. Raises SB004 invalid_transition for disallowed transitions or
-- unknown kinds. SECURITY INVOKER: the UPDATE is still subject to records RLS.
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

-- ---------------------------------------------------------------------------
-- Authoritative property validation (decision 0026 §2). The ADR states the
-- property schema is not a hard-coded check constraint (it is
-- workspace-configurable), but direct PostgREST CRUD on records.properties
-- must not bypass validation. This SECURITY-INVOKER trigger validates the
-- properties JSONB against the workspace's active record_field_definitions
-- for the record's kind on INSERT and whenever kind/properties change:
--   - non-nullable active fields must be present (null allowed only if nullable);
--   - values must match the logical_type (text/integer/decimal/boolean/date/
--     timestamp/category);
--   - category values must be one of validation.enum when present;
--   - unknown keys are allowed (retired fields keep their historical values);
--   - experiment/report records skip validation (no field definitions).
-- Raises SB005 invalid_properties so the REST proxy maps it to 422.
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
        IF jsonb_typeof(v_value) NOT IN ('true', 'false') THEN
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

CREATE TRIGGER "records_validate_properties"
  BEFORE INSERT OR UPDATE OF kind, properties, workspace_id ON "api"."records"
  FOR EACH ROW EXECUTE FUNCTION "internal"."validate_record_properties"();--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
