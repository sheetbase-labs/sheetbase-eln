CREATE TABLE "api"."record_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"identifier_prefix" text NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_record_models_workspace_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "uq_record_models_workspace_identifier_prefix" UNIQUE("workspace_id","identifier_prefix"),
	CONSTRAINT "chk_record_models_key" CHECK ("api"."record_models"."key" ~ '^[a-z][a-z0-9_]{0,59}$'),
	CONSTRAINT "chk_record_models_identifier_prefix" CHECK ("api"."record_models"."identifier_prefix" ~ '^[A-Z][A-Z0-9]{0,7}$'),
	CONSTRAINT "chk_record_models_lifecycle" CHECK ("api"."record_models"."lifecycle" IN ('draft','published','retired')),
	CONSTRAINT "chk_record_models_current_version" CHECK ("api"."record_models"."current_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."record_models" ADD CONSTRAINT "record_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_models" ADD CONSTRAINT "record_models_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_models" ADD CONSTRAINT "record_models_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_record_models_workspace" ON "api"."record_models" USING btree ("workspace_id");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- MDL-01 step 1 — workspace-owned record model identity (ADR-0051).
--
-- `api.record_models` is the workspace-defined model registry. Built-in kinds
-- remain canonical in the global, migration-owned `api.model_kinds`; this table
-- holds only workspace-defined models, and `api.create_workspace_model` refuses
-- a key that shadows a built-in kind so the two registries cannot fork.
--
-- Versioned field/rule schemas and approval are MDL-03; step 1 is identity,
-- identifier prefix and RLS. `current_version` is the published-version
-- reference MDL-03 will advance. There is deliberately no version table here:
-- `api.record_field_definitions.kind` already stores a model key, so fields
-- attach to a workspace model without a parallel field store, and MDL-03 owns
-- the versioned schema snapshot and approval workflow.
--
-- RLS/membership mirrors the sibling Dataset schema gate: members of the
-- workspace read; only the `schema.edit` capability inserts/updates; another
-- workspace is invisible. Retire is a lifecycle state, never a delete.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."record_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON "api"."record_models" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."record_models" TO authenticated;--> statement-breakpoint

CREATE POLICY "record_models_select" ON "api"."record_models"
  FOR SELECT TO authenticated
  USING (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."is_workspace_member"("workspace_id")
  );--> statement-breakpoint

CREATE POLICY "record_models_insert" ON "api"."record_models"
  FOR INSERT TO authenticated
  WITH CHECK (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
    AND "created_by_user_id" = "api"."current_user_id"()
  );--> statement-breakpoint

CREATE POLICY "record_models_update" ON "api"."record_models"
  FOR UPDATE TO authenticated
  USING (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
  )
  WITH CHECK (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
  );--> statement-breakpoint

CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."record_models"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Create a workspace model. Capability-gated (`schema.edit`), matching Dataset
-- schema edits. A key that collides with a built-in `model_kinds` key is
-- refused (SB071); a duplicate workspace key or identifier prefix is refused
-- with SB082.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."create_workspace_model"(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_identifier_prefix text,
  p_description text DEFAULT NULL
)
RETURNS "api"."record_models"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text := "api"."current_user_id"();
  v_prefix text;
  v_model "api"."record_models";
BEGIN
  PERFORM "api"."require_capability"(p_workspace_id, 'schema.edit');

  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9_]{0,59}$' THEN
    RAISE EXCEPTION 'model key must be a lowercase slug' USING ERRCODE = 'SB071';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'model name must be 1-200 characters' USING ERRCODE = 'SB071';
  END IF;
  IF length(coalesce(p_description, '')) > 2000 THEN
    RAISE EXCEPTION 'model description must be at most 2000 characters' USING ERRCODE = 'SB071';
  END IF;
  -- Built-in kinds stay built-in: never shadow one in a workspace registry.
  IF EXISTS (SELECT 1 FROM "api"."model_kinds" WHERE key = p_key) THEN
    RAISE EXCEPTION 'model key % is a built-in kind', p_key USING ERRCODE = 'SB071';
  END IF;
  v_prefix := upper(btrim(coalesce(p_identifier_prefix, '')));
  IF v_prefix !~ '^[A-Z][A-Z0-9]{0,7}$' THEN
    RAISE EXCEPTION 'identifier prefix must start with a letter and use A-Z0-9' USING ERRCODE = 'SB071';
  END IF;

  INSERT INTO "api"."record_models"(
    workspace_id, key, name, description, identifier_prefix, lifecycle,
    current_version, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    v_prefix, 'draft', 1, v_actor, v_actor
  )
  RETURNING * INTO v_model;

  RETURN v_model;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'model key or identifier prefix already exists in this workspace'
      USING ERRCODE = 'SB082';
END;
$$;--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION "api"."create_workspace_model"(uuid, text, text, text, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_workspace_model"(uuid, text, text, text, text) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."create_workspace_model"(uuid, text, text, text, text) IS
  'MDL-01 step 1: create a workspace-owned record model identity (key, name, description, identifier prefix) gated by the schema.edit capability. Refuses a key that shadows a built-in model kind.';

-- ---------------------------------------------------------------------------
-- Per (workspace, identifier prefix) identifier allocation, e.g. CB-0007.
-- The durable counter lives in `internal.id_sequences` (workspace_id, kind);
-- `kind` is `model:<prefix>`, so the counter is per workspace and per prefix
-- and can never leak across workspaces or be reused. The
-- INSERT ... ON CONFLICT DO UPDATE ... RETURNING is a single atomic
-- statement, so concurrent callers receive distinct numbers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "api"."next_record_model_identifier"(p_model_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_model "api"."record_models";
  v_number bigint;
BEGIN
  SELECT * INTO v_model FROM "api"."record_models" WHERE id = p_model_id;
  IF v_model.id IS NULL THEN
    RAISE EXCEPTION 'model not found' USING ERRCODE = '42501';
  END IF;
  IF "api"."current_workspace_id"() IS DISTINCT FROM v_model.workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;

  INSERT INTO "internal"."id_sequences" (workspace_id, kind, last_number)
  VALUES (v_model.workspace_id, 'model:' || lower(v_model.identifier_prefix), 1)
  ON CONFLICT (workspace_id, kind)
  DO UPDATE SET last_number = "internal"."id_sequences".last_number + 1
  RETURNING last_number INTO v_number;

  RETURN v_model.identifier_prefix || '-' || lpad(v_number::text, 4, '0');
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION "api"."next_record_model_identifier"(uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."next_record_model_identifier"(uuid) TO authenticated;--> statement-breakpoint

COMMENT ON FUNCTION "api"."next_record_model_identifier"(uuid) IS
  'MDL-01 step 1: atomically allocate the next identifier for a workspace model, e.g. CB-0007. The counter is per (workspace, identifier prefix) in internal.id_sequences and is never reused.';

NOTIFY pgrst, 'reload schema';