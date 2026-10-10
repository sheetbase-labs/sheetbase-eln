ALTER TABLE "api"."records" DROP CONSTRAINT "chk_records_kind";--> statement-breakpoint
ALTER TABLE "api"."record_field_definitions" DROP CONSTRAINT "record_field_definitions_kind_model_fk";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- MDL-01 step 2 (ADR-0051) — records of a workspace-owned model.
--
-- `records.kind` used to be a fixed CHECK allowlist of built-in kinds. ADR-0051
-- §2 makes it a workspace-scoped reference: a kind is either a built-in
-- `model_kinds` record kind or a `record_models` key owned by the record's
-- workspace. A CHECK cannot query another table, so the allowlist moves into
-- the existing `internal.guard_record_kind` trigger (which continues to keep
-- kind immutable on update). Existing rows remain valid.
--
-- `record_field_definitions.kind` likewise referenced only `model_kinds`.
-- It now also accepts a workspace model key, so a workspace model's fields
-- live in the canonical field store rather than a parallel one.
-- `internal.validate_model_fields` already reads definitions by
-- (workspace, kind); `internal.model_key_for` now resolves a workspace model
-- key, so the existing custom-field validation and reference-edge triggers
-- treat a workspace model record exactly like a built-in one.
--
-- No new record system is introduced: these are still `api.records` rows and
-- the same `api.record_field_definitions` / `api.record_links` /
-- `api.change_events` machinery.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "internal"."guard_record_kind"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."kind" IS DISTINCT FROM OLD."kind" THEN
    RAISE EXCEPTION 'record kind is immutable' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."model_kinds"
    WHERE "identity_table" = 'api.records' AND "record_kind" = NEW."kind"
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."record_models"
    WHERE "workspace_id" = NEW."workspace_id" AND "key" = NEW."kind"
  ) THEN
    RETURN NEW;
  END IF;
  -- Preserve the historical CHECK constraint SQLSTATE for an unsupported
  -- kind; callers and tests already branch on 23514.
  RAISE EXCEPTION 'unknown record kind: %', NEW."kind" USING ERRCODE='23514';
END $$;
REVOKE EXECUTE ON FUNCTION "internal"."guard_record_kind"() FROM PUBLIC, authenticated, api_client;
DROP TRIGGER "guard_record_kind" ON "api"."records";
CREATE TRIGGER "guard_record_kind"
  BEFORE INSERT OR UPDATE OF "kind", "workspace_id" ON "api"."records"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_record_kind"();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."guard_record_field_definition_kind"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "api"."model_kinds" WHERE "key" = NEW."kind") THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "api"."record_models"
    WHERE "workspace_id" = NEW."workspace_id" AND "key" = NEW."kind"
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'unknown model key: %', NEW."kind" USING ERRCODE='SB071';
END $$;
REVOKE EXECUTE ON FUNCTION "internal"."guard_record_field_definition_kind"() FROM PUBLIC, authenticated, api_client;
CREATE TRIGGER "record_field_definitions_kind_guard"
  BEFORE INSERT OR UPDATE OF "kind", "workspace_id" ON "api"."record_field_definitions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_record_field_definition_kind"();
--> statement-breakpoint

-- Resolve a workspace model key in addition to a built-in model kind, so the
-- field-validation, projection and reference-edge paths see workspace models.
CREATE OR REPLACE FUNCTION "internal"."model_key_for"(p_table text, p_kind text DEFAULT NULL)
RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT coalesce(
    (SELECT "key" FROM "api"."model_kinds"
      WHERE "identity_table" = p_table
        AND ("record_kind" = p_kind OR ("record_kind" IS NULL AND p_kind IS NULL))),
    (SELECT "key" FROM "api"."record_models"
      WHERE p_table = 'api.records' AND p_kind IS NOT NULL AND "key" = p_kind)
  )
$$;
--> statement-breakpoint

-- A workspace model allocates from its own (workspace, prefix) sequence; a
-- built-in kind keeps the per-kind sequence. The kind allowlist trigger above
-- refuses a model key that this workspace does not own.
CREATE OR REPLACE FUNCTION "api"."create_model_record"(
  p_project_id uuid,
  p_kind text,
  p_title text,
  p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}',
  p_properties jsonb DEFAULT '{}',
  p_custom_fields jsonb DEFAULT '{}'
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  workspace uuid := "api"."current_workspace_id"();
  generated_identifier text;
  v_model_id uuid;
  result "api"."records";
BEGIN
  IF workspace IS NULL THEN
    RAISE EXCEPTION 'capability required: record.create' USING ERRCODE='42501';
  END IF;
  PERFORM "api"."require_capability"(workspace, 'record.create');
  IF NOT EXISTS (
    SELECT 1 FROM "api"."projects"
    WHERE "id" = p_project_id AND "workspace_id" = workspace
  ) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE='42501';
  END IF;

  SELECT "id" INTO v_model_id FROM "api"."record_models"
    WHERE "workspace_id" = workspace AND "key" = p_kind;
  IF v_model_id IS NOT NULL THEN
    generated_identifier := "api"."next_record_model_identifier"(v_model_id);
  ELSE
    generated_identifier := "api"."next_record_identifier"(workspace, p_kind);
  END IF;

  INSERT INTO "api"."records"(
    workspace_id, project_id, kind, identifier, title, status, tags, properties,
    custom_fields, created_by_user_id
  ) VALUES (
    workspace, p_project_id, p_kind, generated_identifier,
    coalesce(nullif(btrim(p_title), ''), generated_identifier), p_status,
    coalesce(p_tags, '{}'), coalesce(p_properties, '{}'),
    coalesce(p_custom_fields, '{}'), "api"."current_user_id"()
  ) RETURNING * INTO result;
  RETURN result;
END $$;
REVOKE EXECUTE ON FUNCTION "api"."create_model_record"(uuid, text, text, text, text[], jsonb, jsonb) FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION "api"."create_model_record"(uuid, text, text, text, text[], jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION "api"."create_model_record"(uuid, text, text, text, text[], jsonb, jsonb) IS
  'MDL-01 step 2: create a record of a built-in kind or a workspace-owned record model. A workspace model assigns its own prefix identifier and validates custom_fields against the model''s active record_field_definitions.';
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
