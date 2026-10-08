CREATE TABLE "api"."record_model_version_upgrades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"from_version_id" uuid,
	"to_version_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upgraded_by_user_id" text
);
--> statement-breakpoint
CREATE TABLE "api"."record_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"lifecycle" text DEFAULT 'draft' NOT NULL,
	"definition" jsonb DEFAULT '{"fields":[]}'::jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_record_model_versions_model_version" UNIQUE("model_id","version"),
	CONSTRAINT "chk_record_model_versions_version" CHECK ("api"."record_model_versions"."version" > 0),
	CONSTRAINT "chk_record_model_versions_revision" CHECK ("api"."record_model_versions"."revision" > 0),
	CONSTRAINT "chk_record_model_versions_lifecycle" CHECK ("api"."record_model_versions"."lifecycle" IN ('draft','published'))
);
--> statement-breakpoint
ALTER TABLE "api"."records" ADD COLUMN "model_version_id" uuid;--> statement-breakpoint
ALTER TABLE "api"."record_model_version_upgrades" ADD CONSTRAINT "record_model_version_upgrades_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_version_upgrades" ADD CONSTRAINT "record_model_version_upgrades_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_version_upgrades" ADD CONSTRAINT "record_model_version_upgrades_from_version_id_record_model_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "api"."record_model_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_version_upgrades" ADD CONSTRAINT "record_model_version_upgrades_to_version_id_record_model_versions_id_fk" FOREIGN KEY ("to_version_id") REFERENCES "api"."record_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_version_upgrades" ADD CONSTRAINT "record_model_version_upgrades_upgraded_by_user_id_user_id_fk" FOREIGN KEY ("upgraded_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_versions" ADD CONSTRAINT "record_model_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_versions" ADD CONSTRAINT "record_model_versions_model_id_record_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "api"."record_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_versions" ADD CONSTRAINT "record_model_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."record_model_versions" ADD CONSTRAINT "record_model_versions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_record_model_version_upgrades_record" ON "api"."record_model_version_upgrades" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "idx_record_model_version_upgrades_to" ON "api"."record_model_version_upgrades" USING btree ("to_version_id");--> statement-breakpoint
CREATE INDEX "idx_record_model_versions_workspace" ON "api"."record_model_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_record_model_versions_model" ON "api"."record_model_versions" USING btree ("model_id");
--> statement-breakpoint
ALTER TABLE "api"."records" ADD CONSTRAINT "records_model_version_id_record_model_versions_id_fk"
  FOREIGN KEY ("model_version_id") REFERENCES "api"."record_model_versions"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Record Model version create/publish are ordinary immutable change events.
DO $$ DECLARE expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint
    WHERE conrelid='api.change_events'::regclass AND conname='chk_change_events_entity_type';
  IF strpos(expression,'''review_submission''::text')=0 THEN RAISE EXCEPTION 'Unexpected event vocabulary'; END IF;
  expression:=replace(expression,'''review_submission''::text','''review_submission''::text, ''record_model_version''::text');
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '||expression;
END $$;--> statement-breakpoint

ALTER TABLE "api"."record_model_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "api"."record_model_versions" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "api"."record_model_versions" TO authenticated;--> statement-breakpoint
CREATE POLICY "record_model_versions_select" ON "api"."record_model_versions"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint
CREATE POLICY "record_model_versions_insert" ON "api"."record_model_versions"
  FOR INSERT TO authenticated
  WITH CHECK (
    "workspace_id" = "api"."current_workspace_id"()
    AND "api"."has_capability"("workspace_id", 'schema.edit')
    AND "created_by_user_id" = "api"."current_user_id"()
  );--> statement-breakpoint
CREATE POLICY "record_model_versions_update" ON "api"."record_model_versions"
  FOR UPDATE TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."has_capability"("workspace_id", 'schema.edit'))
  WITH CHECK ("workspace_id" = "api"."current_workspace_id"() AND "api"."has_capability"("workspace_id", 'schema.edit'));--> statement-breakpoint

CREATE OR REPLACE FUNCTION "internal"."guard_record_model_version_write"()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.lifecycle = 'published' THEN
    RAISE EXCEPTION 'published Record Model versions are immutable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.approval_requests r
     WHERE r.object_kind = 'record_model_version' AND r.object_id = OLD.id AND r.state = 'pending'
  ) THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."guard_record_model_version_write"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "record_model_versions_guard_write" BEFORE UPDATE ON "api"."record_model_versions"
  FOR EACH ROW EXECUTE FUNCTION "internal"."guard_record_model_version_write"();--> statement-breakpoint

ALTER TABLE "api"."record_model_version_upgrades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "api"."record_model_version_upgrades" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "api"."record_model_version_upgrades" TO authenticated;--> statement-breakpoint
CREATE POLICY "record_model_version_upgrades_select" ON "api"."record_model_version_upgrades"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

-- Create a draft version of a workspace model, copying the latest version's
-- definition so fields carry forward until explicitly edited.
CREATE OR REPLACE FUNCTION "api"."create_record_model_version"(p_model_id uuid, p_reason text)
RETURNS "api"."record_model_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_model "api"."record_models";
  v_latest "api"."record_model_versions";
  v_row "api"."record_model_versions";
  v_next integer;
BEGIN
  SELECT * INTO v_model FROM api.record_models WHERE id = p_model_id FOR UPDATE;
  IF v_model.id IS NULL OR v_model.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record Model not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_model.workspace_id, 'schema.edit');
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a version reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_latest FROM api.record_model_versions
    WHERE model_id = v_model.id ORDER BY version DESC LIMIT 1;
  v_next := coalesce(v_latest.version, 0) + 1;
  INSERT INTO api.record_model_versions(workspace_id, model_id, version, revision, lifecycle, definition, reason, created_by_user_id, updated_by_user_id)
  VALUES (
    v_model.workspace_id, v_model.id, v_next, 1, 'draft',
    coalesce(v_latest.definition, '{"fields":[]}'::jsonb), btrim(p_reason),
    api.current_user_id(), api.current_user_id()
  )
  RETURNING * INTO v_row;
  PERFORM internal.emit_change_event(v_model.workspace_id, 'record_model_version', v_row.id, 'create', NULL, NULL,
    jsonb_build_object('modelId', v_model.id, 'version', v_next));
  RETURN v_row;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."create_record_model_version"(uuid, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_record_model_version"(uuid, text) TO authenticated;--> statement-breakpoint

-- Replace a draft definition. The canonical field store is the single
-- `api.record_field_definitions` table keyed by the model key; fields absent
-- from the new definition retire rather than disappear.
CREATE OR REPLACE FUNCTION "api"."replace_record_model_version_definition"(
  p_version_id uuid, p_expected_revision bigint, p_definition jsonb, p_reason text
) RETURNS "api"."record_model_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version "api"."record_model_versions";
  v_model "api"."record_models";
  v_row "api"."record_model_versions";
  v_field jsonb;
  v_present uuid[] := '{}';
BEGIN
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record Model version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_version.workspace_id, 'schema.edit');
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Record Model versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS (SELECT 1 FROM api.approval_requests r
    WHERE r.object_kind = 'record_model_version' AND r.object_id = v_version.id AND r.state = 'pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_version.revision THEN
    RAISE EXCEPTION 'stale Record Model version revision' USING ERRCODE = 'SB001';
  END IF;
  IF p_definition IS NULL OR jsonb_typeof(p_definition) <> 'object'
    OR jsonb_typeof(coalesce(p_definition->'fields', 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'definition must be an object with a fields array' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'a change reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_model FROM api.record_models WHERE id = v_version.model_id;
  FOR v_field IN SELECT * FROM jsonb_array_elements(p_definition->'fields') LOOP
    v_present := v_present || (v_field->>'id')::uuid;
    INSERT INTO api.record_field_definitions(
      id, workspace_id, kind, field_name, label, description, display_order,
      logical_type, nullable, default_value, quantity, cardinality,
      category_source, relationship, validation, lifecycle, created_by_user_id
    ) VALUES (
      (v_field->>'id')::uuid, v_model.workspace_id, v_model.key, v_field->>'field_name',
      coalesce(nullif(v_field->>'label',''), v_field->>'field_name'), v_field->>'description',
      coalesce((v_field->>'display_order')::integer, 0),
      coalesce(nullif(v_field->>'logical_type',''), 'text'),
      coalesce((v_field->>'nullable')::boolean, true), v_field->'default_value',
      v_field->'quantity', coalesce(nullif(v_field->>'cardinality',''), 'one'),
      v_field->'category_source', v_field->'relationship',
      coalesce(v_field->'validation', '{}'::jsonb),
      coalesce(nullif(v_field->>'lifecycle',''), 'active'), api.current_user_id()
    )
    ON CONFLICT (id) DO UPDATE SET
      label = excluded.label, description = excluded.description,
      display_order = excluded.display_order, logical_type = excluded.logical_type,
      nullable = excluded.nullable, default_value = excluded.default_value,
      quantity = excluded.quantity, cardinality = excluded.cardinality,
      category_source = excluded.category_source, relationship = excluded.relationship,
      validation = excluded.validation, lifecycle = excluded.lifecycle,
      updated_at = now();
  END LOOP;
  UPDATE api.record_field_definitions
     SET lifecycle = 'retired', updated_at = now()
   WHERE workspace_id = v_model.workspace_id AND kind = v_model.key
     AND lifecycle = 'active' AND NOT (id = ANY(v_present));
  UPDATE api.record_model_versions
     SET definition = p_definition, revision = v_version.revision + 1,
         reason = btrim(p_reason), updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_version.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."replace_record_model_version_definition"(uuid, bigint, jsonb, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."replace_record_model_version_definition"(uuid, bigint, jsonb, text) TO authenticated;--> statement-breakpoint

-- Publish a Record Model version. Always gated by a completed approval request
-- covering every required approver role, independent of the Dataset policy.
CREATE OR REPLACE FUNCTION "api"."publish_record_model_version"(p_version_id uuid)
RETURNS "api"."record_model_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version "api"."record_model_versions";
  v_block text;
BEGIN
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record Model version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_version.workspace_id, 'schema.publish');
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Record Model versions may be published' USING ERRCODE = 'SB072';
  END IF;
  v_block := internal.approval_publish_blocker('record_model_version', v_version.id);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'Record Model version cannot be published: %', v_block USING ERRCODE = 'SB084';
  END IF;
  UPDATE api.record_model_versions
     SET lifecycle = 'published', published_at = now(), updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_version.id
  RETURNING * INTO v_version;
  UPDATE api.record_models
     SET current_version = v_version.version, lifecycle = 'published',
         updated_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_version.model_id;
  PERFORM internal.emit_change_event(v_version.workspace_id, 'record_model_version', v_version.id, 'update', NULL, NULL,
    jsonb_build_object('modelId', v_version.model_id, 'version', v_version.version, 'effect', 'published'));
  RETURN v_version;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."publish_record_model_version"(uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."publish_record_model_version"(uuid) TO authenticated;--> statement-breakpoint

-- Explicit pin upgrade. Changes only the definition pin; values are never
-- rewritten and no values argument is accepted.
CREATE OR REPLACE FUNCTION "api"."upgrade_record_model_record"(
  p_record_id uuid, p_version_id uuid, p_expected_metadata_version bigint, p_reason text
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_record "api"."records";
  v_version "api"."record_model_versions";
  v_model "api"."record_models";
  v_row "api"."records";
BEGIN
  SELECT * INTO v_record FROM api.records WHERE id = p_record_id FOR UPDATE;
  IF v_record.id IS NULL OR v_record.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'Record not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_record.workspace_id, 'schema.edit');
  IF p_expected_metadata_version IS NULL OR p_expected_metadata_version IS DISTINCT FROM v_record.metadata_version THEN
    RAISE EXCEPTION 'stale Record metadata revision' USING ERRCODE = 'SB001';
  END IF;
  SELECT * INTO v_version FROM api.record_model_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM v_record.workspace_id OR v_version.lifecycle <> 'published' THEN
    RAISE EXCEPTION 'published Record Model version not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_model FROM api.record_models WHERE id = v_version.model_id;
  IF v_model.key IS DISTINCT FROM v_record.kind THEN
    RAISE EXCEPTION 'version does not belong to the Record model' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'an upgrade reason is required' USING ERRCODE = '22023';
  END IF;
  UPDATE api.records
     SET model_version_id = v_version.id, metadata_version = v_record.metadata_version + 1,
         updated_at = now(), updated_by_user_id = api.current_user_id()
   WHERE id = v_record.id
  RETURNING * INTO v_row;
  INSERT INTO api.record_model_version_upgrades(workspace_id, record_id, from_version_id, to_version_id, reason, upgraded_by_user_id)
  VALUES (v_record.workspace_id, v_record.id, v_record.model_version_id, v_version.id, btrim(p_reason), api.current_user_id());
  PERFORM internal.emit_change_event(v_record.workspace_id, 'record', v_record.id, 'update', v_record.id, v_record.project_id,
    jsonb_build_object('effect', 'model_version_upgrade', 'modelVersionId', v_version.id, 'reason', btrim(p_reason)));
  RETURN v_row;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."upgrade_record_model_record"(uuid, uuid, bigint, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."upgrade_record_model_record"(uuid, uuid, bigint, text) TO authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."record_model_version_usage"(p_model_id uuid)
RETURNS TABLE(version_id uuid, record_count integer, created_record_count integer, upgraded_record_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v.id,
    (SELECT count(*)::int FROM api.records r WHERE r.model_version_id = v.id),
    (SELECT count(*)::int FROM api.records r WHERE r.model_version_id = v.id
       AND NOT EXISTS (SELECT 1 FROM api.record_model_version_upgrades u WHERE u.record_id = r.id AND u.to_version_id = v.id)),
    (SELECT count(*)::int FROM api.records r WHERE r.model_version_id = v.id
       AND EXISTS (SELECT 1 FROM api.record_model_version_upgrades u WHERE u.record_id = r.id AND u.to_version_id = v.id))
  FROM api.record_model_versions v
  WHERE v.model_id = p_model_id
    AND v.workspace_id = api.current_workspace_id()
    AND api.is_workspace_member(v.workspace_id)
  ORDER BY v.version DESC
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."record_model_version_usage"(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."record_model_version_usage"(uuid) TO authenticated;--> statement-breakpoint

-- Pin new Records of a workspace model to the current published version and
-- apply its field defaults. Built-in kinds keep their previous behaviour.
CREATE OR REPLACE FUNCTION "api"."create_model_record"(
  p_project_id uuid, p_kind text, p_title text, p_status text DEFAULT 'draft',
  p_tags text[] DEFAULT '{}', p_properties jsonb DEFAULT '{}', p_custom_fields jsonb DEFAULT '{}'
) RETURNS "api"."records"
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  workspace uuid := api.current_workspace_id();
  generated_identifier text;
  result api.records;
  v_model api.record_models;
  v_version api.record_model_versions;
  v_defaults jsonb := '{}'::jsonb;
BEGIN
  IF workspace IS NULL THEN RAISE EXCEPTION 'capability required: record.create' USING ERRCODE = '42501'; END IF;
  PERFORM api.require_capability(workspace, 'record.create');
  IF NOT EXISTS (SELECT 1 FROM api.projects WHERE id = p_project_id AND workspace_id = workspace) THEN
    RAISE EXCEPTION 'project not found in active workspace' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_model FROM api.record_models WHERE workspace_id = workspace AND key = p_kind;
  IF v_model.id IS NOT NULL THEN
    SELECT * INTO v_version FROM api.record_model_versions
      WHERE model_id = v_model.id AND lifecycle = 'published' ORDER BY version DESC LIMIT 1;
    IF v_version.id IS NULL THEN
      RAISE EXCEPTION 'Record Model % has no published version', p_kind USING ERRCODE = 'SB108';
    END IF;
    SELECT coalesce(jsonb_object_agg(f->>'field_name', f->'default_value'), '{}'::jsonb)
      INTO v_defaults
      FROM jsonb_array_elements(coalesce(v_version.definition->'fields', '[]'::jsonb)) f
      WHERE f ? 'default_value' AND f->'default_value' IS NOT NULL AND f->'default_value' <> 'null'::jsonb;
  END IF;
  generated_identifier := api.next_record_identifier(workspace, p_kind);
  INSERT INTO api.records(
    workspace_id, project_id, kind, identifier, title, status, tags, properties,
    custom_fields, model_version_id, created_by_user_id
  ) VALUES (
    workspace, p_project_id, p_kind, generated_identifier,
    coalesce(nullif(btrim(p_title), ''), generated_identifier), p_status,
    coalesce(p_tags, '{}'), coalesce(p_properties, '{}'),
    v_defaults || coalesce(p_custom_fields, '{}'), v_version.id, api.current_user_id()
  ) RETURNING * INTO result;
  RETURN result;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Extend the shared approval engine for Record Model versions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "internal"."approval_publish_blocker"(p_object_kind text, p_object_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH target AS (
    SELECT d.workspace_id, v.revision FROM api.dataset_schema_versions v
      JOIN api.dataset_schema_definitions d ON d.id = v.schema_id
      WHERE p_object_kind = 'dataset_schema_version' AND v.id = p_object_id
    UNION ALL
    SELECT m.workspace_id, v.revision FROM api.record_model_versions v
      JOIN api.record_models m ON m.id = v.model_id
      WHERE p_object_kind = 'record_model_version' AND v.id = p_object_id
  ), latest AS (
    SELECT r.* FROM api.approval_requests r JOIN target t ON t.workspace_id = r.workspace_id
      WHERE r.object_kind = p_object_kind AND r.object_id = p_object_id
      ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
  )
  SELECT CASE
    WHEN r.state = 'pending' THEN 'approval pending'
    WHEN r.id IS NOT NULL AND (r.state <> 'approved' OR r.object_revision IS DISTINCT FROM t.revision)
      THEN 'approval required for current revision'
    WHEN r.id IS NULL AND (p_object_kind = 'record_model_version' OR coalesce(s.publication_approval_required, false))
      THEN 'approval required'
    ELSE NULL END
  FROM target t LEFT JOIN latest r ON true
    LEFT JOIN api.workspace_settings s ON s.workspace_id = t.workspace_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."submit_approval_request"(
  p_workspace_id uuid, p_object_kind text, p_object_id uuid, p_required_approver_roles text[],
  p_reason text, p_require_independence boolean DEFAULT true, p_required_approvals integer DEFAULT 1,
  p_object_revision bigint DEFAULT NULL
) RETURNS "api"."approval_requests"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_roles text[];
  v_row api.approval_requests;
  v_version api.dataset_schema_versions;
  v_model_version api.record_model_versions;
  v_workspace uuid;
BEGIN
  IF v_actor IS NULL OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
    OR NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind IS NULL OR p_object_kind !~ '^[a-z][a-z0-9_]{0,63}$' OR p_object_id IS NULL THEN
    RAISE EXCEPTION 'invalid approval object' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'an approval reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(role ORDER BY role) INTO v_roles FROM (
    SELECT DISTINCT unnest(coalesce(p_required_approver_roles, '{}'::text[])) AS role
  ) roles WHERE role IS NOT NULL AND role <> '';
  IF coalesce(cardinality(v_roles), 0) = 0 OR NOT (v_roles <@ ARRAY['owner','admin','member','steward','scientist','analyst','reviewer','viewer']::text[]) THEN
    RAISE EXCEPTION 'invalid approver roles' USING ERRCODE = '22023';
  END IF;
  IF p_required_approvals IS NULL OR p_required_approvals < 1 OR p_required_approvals > 10 THEN
    RAISE EXCEPTION 'invalid required approval count' USING ERRCODE = '22023';
  END IF;
  IF p_object_kind = 'dataset_schema_version' THEN
    SELECT * INTO v_version FROM api.dataset_schema_versions WHERE id = p_object_id FOR UPDATE;
    SELECT workspace_id INTO v_workspace FROM api.dataset_schema_definitions WHERE id = v_version.schema_id;
    IF v_version.id IS NULL OR v_workspace IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'approval object not found' USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(v_workspace, 'schema.edit');
    IF v_version.lifecycle <> 'draft' THEN
      RAISE EXCEPTION 'only draft versions may be submitted' USING ERRCODE = 'SB072';
    END IF;
    IF p_object_revision IS NOT NULL AND p_object_revision IS DISTINCT FROM v_version.revision THEN
      RAISE EXCEPTION 'stale Dataset Schema Version revision' USING ERRCODE = 'SB001';
    END IF;
    p_object_revision := v_version.revision;
  ELSIF p_object_kind = 'record_model_version' THEN
    SELECT * INTO v_model_version FROM api.record_model_versions WHERE id = p_object_id FOR UPDATE;
    IF v_model_version.id IS NULL OR v_model_version.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'approval object not found' USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(v_model_version.workspace_id, 'schema.edit');
    IF v_model_version.lifecycle <> 'draft' THEN
      RAISE EXCEPTION 'only draft versions may be submitted' USING ERRCODE = 'SB072';
    END IF;
    -- Record Model versions require independent approval covering every named
    -- role; the client-supplied revision is never target authority.
    IF NOT coalesce(p_require_independence, true) OR p_required_approvals < cardinality(v_roles) THEN
      RAISE EXCEPTION 'Record Model approval requires independence and coverage of every named role' USING ERRCODE = '22023';
    END IF;
    p_object_revision := v_model_version.revision;
  END IF;
  INSERT INTO api.approval_requests(workspace_id, object_kind, object_id, object_revision,
    required_approver_roles, required_approvals, require_independence, state, reason, submitted_by_user_id, submitted_at)
  VALUES (p_workspace_id, p_object_kind, p_object_id, p_object_revision, v_roles, p_required_approvals,
    coalesce(p_require_independence, true), 'pending', btrim(p_reason), v_actor, clock_timestamp()) RETURNING * INTO v_row;
  RETURN v_row;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."approve_approval_request"(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS "api"."approval_requests"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
  v_approved_count integer;
  v_uncovered integer;
BEGIN
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL OR v_actor IS NULL OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be approved' USING ERRCODE = 'SB086';
  END IF;
  SELECT m.role INTO v_role FROM api.workspace_memberships m
   WHERE m.workspace_id = v_row.workspace_id AND m.user_id = v_actor AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY(v_row.required_approver_roles)) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.require_independence AND v_row.submitted_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'an approver cannot approve their own submission' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM api.approval_request_decisions d
    WHERE d.request_id = v_row.id AND d.user_id = v_actor AND d.decision = 'approved') THEN
    RAISE EXCEPTION 'already approved by this approver' USING ERRCODE = 'SB086';
  END IF;
  INSERT INTO api.approval_request_decisions(request_id, workspace_id, user_id, role, decision, reason)
  VALUES (v_row.id, v_row.workspace_id, v_actor, v_role, 'approved', nullif(btrim(coalesce(p_reason, '')), ''));
  SELECT count(DISTINCT d.user_id) INTO v_approved_count
    FROM api.approval_request_decisions d WHERE d.request_id = v_row.id AND d.decision = 'approved';
  -- Record Model approvals additionally require every named role to have at
  -- least one approval, not just the required count.
  IF v_row.object_kind = 'record_model_version' THEN
    SELECT count(*) INTO v_uncovered FROM unnest(v_row.required_approver_roles) AS required_role
     WHERE NOT EXISTS (SELECT 1 FROM api.approval_request_decisions d
        WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role = required_role);
  ELSE
    v_uncovered := 0;
  END IF;
  IF v_approved_count >= v_row.required_approvals AND v_uncovered = 0 THEN
    UPDATE api.approval_requests
       SET state = 'approved', approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor],
           decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           decided_by_user_id = v_actor, decided_at = now(), updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  ELSE
    UPDATE api.approval_requests
       SET approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor], updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';