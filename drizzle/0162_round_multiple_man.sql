CREATE TABLE "api"."extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"source" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"credential_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_extensions_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "chk_extensions_key" CHECK ("api"."extensions"."key" ~ '^[a-z][a-z0-9-]{0,48}$'),
	CONSTRAINT "chk_extensions_name" CHECK (length(btrim("api"."extensions"."name")) BETWEEN 1 AND 200),
	CONSTRAINT "chk_extensions_status" CHECK ("api"."extensions"."status" IN ('installed', 'enabled', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "api"."extensions" ADD CONSTRAINT "extensions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."extensions" ADD CONSTRAINT "extensions_credential_id_api_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."extensions" ADD CONSTRAINT "extensions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."extensions" ADD CONSTRAINT "extensions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_extensions_workspace_key" ON "api"."extensions" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "idx_extensions_workspace" ON "api"."extensions" USING btree ("workspace_id");
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- EXT-01: Extension Contract & Capability Boundaries.
--
-- Greenfield registry: what an extension is allowed to contribute and which
-- canonical contracts it may use. Canonical Models/Datasets/Sheets/Pipelines
-- and capabilities stay authoritative; extensions use public/extension
-- contracts, never private tables or hidden browser state.
--
-- Layering (mirrors the INT-01 connector framework):
--   * api.extensions — workspace-scoped install rows (installed/enabled/
--     disabled). Manifest declares identity, authority (capabilities +
--     scopes) and contribution-point declarations. EXT-02 registers the
--     points themselves; EXT-01 stores and validates the declarations.
--   * extensions.manage — governed capability (owner/admin/steward) gating
--     install/enable/disable. api_client never holds it: extension RPCs are
--     absent from the external allowlist, so external credentials stay
--     fail-closed (no EXTERNAL_TABLE_ACCESS / EXTERNAL_RPC_SCOPES entries).
--   * Extensions act through ordinary scoped API credentials
--     (src/lib/extensions/credentials.ts): per-extension credentials carry
--     minimal manifest-declared scopes from VALID_SCOPES.
--   * api.assert_extension_capability — server-side check for every
--     extension-attributed call: extension enabled + capability declared +
--     api.has_capability. EXT-02 consumes this at each enforcement point.
--   * Lifecycle transitions are audited via change_events ('extension').
-- ---------------------------------------------------------------------------

-- extensions.manage joins the governed surface (owner/admin/steward).
-- api_client stays fail-closed: only member-class capabilities and the
-- AUTO-04 proposal path resolve true for external credentials.
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_mask text;
BEGIN
  v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
  IF v_mask IS NOT NULL
     AND coalesce(current_setting('role', true), '') = 'api_client' THEN
    RAISE EXCEPTION 'capability mask is not caller-controlled'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    IF p_capability IN ('record.create', 'record.link', 'instance.upgrade', 'integrations.manage') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM api.agent_operation_proposals proposal
      WHERE proposal.workspace_id = p_workspace_id
        AND proposal.status = 'executing'
        AND proposal.executed_by_credential_id = api.current_credential_id()
        AND (
          (proposal.operation_kind LIKE 'pipeline_definition.%'
           AND p_capability = 'pipelines.manage'
           AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
          OR (proposal.operation_kind IN (
            'dataset_schema.create',
            'sheet_definition.create',
            'sheet_definition.update_draft'
          ) AND p_capability = 'schema.edit'
          AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'schema:write')
        )
    );
  END IF;
  IF api.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RETURN false;
  END IF;
  IF session_user = 'migrator' AND v_mask IS NOT NULL THEN
    RETURN p_capability = ANY (
      string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
    );
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'integrations.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner', 'admin', 'member', 'steward', 'scientist', 'analyst', 'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.list_capabilities(p_workspace_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(capability ORDER BY capability), '{}'::text[])
    FROM unnest(ARRAY[
      'workspace.admin',
      'schema.edit',
      'schema.publish',
      'schema.retire',
      'record.link',
      'record.create',
      'instance.upgrade',
      'integrations.manage',
      'pipelines.manage',
      'extensions.manage'
    ]) AS capability
   WHERE api.has_capability(p_workspace_id, capability)
$$;
--> statement-breakpoint
-- Grants ride along CREATE OR REPLACE (authenticated + api_client on
-- has_capability; authenticated on list_capabilities) — no change here.

-- ---------------------------------------------------------------------------
-- Manifest validation (mirrors src/lib/extensions/manifest.ts for
-- direct-SQL writers; the TypeScript client normalizes aliases/dedupes
-- before sending, so SQL accepts canonical catalogue names only).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.validate_extension_manifest(p_manifest jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_point text;
  v_entry jsonb;
  v_value text;
  v_seen text[];
BEGIN
  IF p_manifest IS NULL OR jsonb_typeof(p_manifest) <> 'object' THEN
    RAISE EXCEPTION 'invalid extension manifest' USING ERRCODE = 'SB034';
  END IF;
  IF p_manifest->>'id' IS NULL
     OR (p_manifest->>'id') !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$' THEN
    RAISE EXCEPTION 'invalid extension id' USING ERRCODE = 'SB034';
  END IF;
  IF p_manifest->>'name' IS NULL
     OR length(btrim(p_manifest->>'name')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid extension name' USING ERRCODE = 'SB034';
  END IF;
  IF p_manifest->>'version' IS NULL
     OR (p_manifest->>'version') !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION 'invalid extension version' USING ERRCODE = 'SB034';
  END IF;
  IF p_manifest->>'source' IS NULL
     OR length(p_manifest->>'source') NOT BETWEEN 1 AND 500
     OR (
       left(p_manifest->>'source', 8) <> 'https://'
       AND (p_manifest->>'source') !~ '^[a-z][a-z0-9-]*:[^/][a-zA-Z0-9._/~?#%@!$&''()*+,;=-]+$'
     ) THEN
    RAISE EXCEPTION 'invalid extension source' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest ? 'capabilities') IS DISTINCT FROM true
     OR jsonb_typeof(p_manifest->'capabilities') <> 'array' THEN
    RAISE EXCEPTION 'invalid extension capabilities' USING ERRCODE = 'SB034';
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_manifest->'capabilities') LOOP
    IF jsonb_typeof(v_entry) <> 'string' THEN
      RAISE EXCEPTION 'unknown capability' USING ERRCODE = 'SB034';
    END IF;
    v_value := v_entry #>> '{}';
    IF v_value NOT IN (
      'workspace.admin', 'schema.edit', 'schema.publish', 'schema.retire',
      'record.link', 'record.create', 'instance.upgrade',
      'integrations.manage', 'pipelines.manage', 'extensions.manage'
    ) THEN
      RAISE EXCEPTION 'unknown capability: %', v_value USING ERRCODE = 'SB034';
    END IF;
  END LOOP;
  IF (p_manifest ? 'scopes') IS DISTINCT FROM true
     OR jsonb_typeof(p_manifest->'scopes') <> 'array' THEN
    RAISE EXCEPTION 'invalid extension scopes' USING ERRCODE = 'SB034';
  END IF;
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_manifest->'scopes') LOOP
    IF jsonb_typeof(v_entry) <> 'string' THEN
      RAISE EXCEPTION 'unknown scope' USING ERRCODE = 'SB034';
    END IF;
    v_value := v_entry #>> '{}';
    IF v_value NOT IN (
      'projects:read', 'projects:write',
      'datasets:read', 'datasets:write',
      'schema:read', 'schema:write', 'schema:publish',
      'sheets:read', 'sheets:write',
      'models:read', 'models:write',
      'templates:read', 'templates:write',
      'reviews:read', 'reviews:write',
      'files:read', 'files:write',
      'webhooks:read', 'webhooks:write',
      'agent_operations:read', 'agent_operations:write'
    ) THEN
      RAISE EXCEPTION 'unknown scope: %', v_value USING ERRCODE = 'SB034';
    END IF;
  END LOOP;
  IF jsonb_array_length(p_manifest->'capabilities')
     + jsonb_array_length(p_manifest->'scopes') = 0 THEN
    RAISE EXCEPTION 'extension must declare at least one capability or scope'
      USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest ? 'contributions') IS DISTINCT FROM true
     OR jsonb_typeof(p_manifest->'contributions') <> 'object' THEN
    RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
  END IF;
  -- Fail closed: a misspelled point never silently disables a declaration.
  SELECT k INTO v_point FROM jsonb_object_keys(p_manifest->'contributions') AS k
   WHERE k NOT IN ('object-actions', 'panels', 'commands', 'event-subscriptions')
   LIMIT 1;
  IF v_point IS NOT NULL THEN
    RAISE EXCEPTION 'unknown contribution point: %', v_point USING ERRCODE = 'SB034';
  END IF;
  FOR v_point IN
    SELECT * FROM unnest(ARRAY['object-actions', 'panels', 'commands'])
  LOOP
    IF (p_manifest->'contributions' ? v_point) IS DISTINCT FROM true THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(p_manifest->'contributions'->v_point) <> 'array' THEN
      RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
    END IF;
    v_seen := '{}';
    FOR v_entry IN
      SELECT * FROM jsonb_array_elements(p_manifest->'contributions'->v_point)
    LOOP
      IF jsonb_typeof(v_entry) <> 'object'
         OR (v_entry->>'id') IS NULL
         OR (v_entry->>'id') !~ '^[a-z][a-z0-9-]{0,48}$'
         OR (v_entry->>'title') IS NULL
         OR length(btrim(v_entry->>'title')) NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
      END IF;
      IF (v_entry->>'id') = ANY (v_seen) THEN
        RAISE EXCEPTION 'duplicate extension contribution id' USING ERRCODE = 'SB034';
      END IF;
      v_seen := v_seen || (v_entry->>'id');
    END LOOP;
  END LOOP;
  IF (p_manifest->'contributions' ? 'event-subscriptions') IS DISTINCT FROM true THEN
    RETURN;
  END IF;
  IF jsonb_typeof(p_manifest->'contributions'->'event-subscriptions') <> 'array' THEN
    RAISE EXCEPTION 'invalid extension contributions' USING ERRCODE = 'SB034';
  END IF;
  v_seen := '{}';
  FOR v_entry IN
    SELECT * FROM jsonb_array_elements(p_manifest->'contributions'->'event-subscriptions')
  LOOP
    IF jsonb_typeof(v_entry) <> 'object'
       OR (v_entry->>'eventType') IS NULL THEN
      RAISE EXCEPTION 'invalid event subscription' USING ERRCODE = 'SB034';
    END IF;
    v_value := v_entry->>'eventType';
    IF v_value NOT IN (
      'project.created', 'project.updated', 'project.deleted',
      'project.archived', 'project.restored',
      'record.created', 'record.updated', 'record.moved', 'record.deleted',
      'record.archived', 'record.restored', 'record.amended',
      'dataset.created', 'dataset.updated', 'dataset.archived',
      'dataset.restored', 'dataset.versioned',
      'sheet.created', 'sheet.updated', 'sheet.archived', 'sheet.restored',
      'sheet.definition.created', 'sheet.definition.updated',
      'sheet.definition.versioned',
      'notebook.submitted', 'notebook.amended',
      'review.decided', 'notebook.signed',
      'notebook.template.created', 'notebook.template.updated',
      'notebook.template.versioned',
      'pipeline.created', 'pipeline.updated', 'pipeline.deleted',
      'pipeline.version.created', 'pipeline.version.updated',
      'pipeline.run.created', 'pipeline.run.updated',
      'pipeline.schedule.created', 'pipeline.schedule.updated',
      'workspace.invitation.created', 'workspace.invitation.updated',
      'workspace.invitation.deleted',
      'workspace.settings.created', 'workspace.settings.updated',
      'project.access.granted', 'project.access.updated',
      'project.access.revoked',
      'workspace.credential.created', 'workspace.credential.revoked'
    ) THEN
      RAISE EXCEPTION 'unknown event subscription: %', v_value USING ERRCODE = 'SB034';
    END IF;
    IF v_value = ANY (v_seen) THEN
      RAISE EXCEPTION 'duplicate event subscription' USING ERRCODE = 'SB034';
    END IF;
    v_seen := v_seen || v_value;
  END LOOP;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.validate_extension_manifest(jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Lifecycle RPCs. Install needs extensions.manage; enable/disable move the
-- status machine (installed/enabled/disabled). Repeating a transition is a
-- no-op returning the row, so admin retries never fabricate audit noise.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.install_extension(
  p_workspace_id uuid,
  p_key text,
  p_name text,
  p_version text,
  p_source text,
  p_manifest jsonb
)
RETURNS api.extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
  v_name text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  IF p_key IS NULL OR p_key !~ '^[a-z][a-z0-9-]{0,48}$' THEN
    RAISE EXCEPTION 'invalid extension key' USING ERRCODE = 'SB034';
  END IF;
  v_name := btrim(p_name);
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid extension name' USING ERRCODE = 'SB034';
  END IF;
  IF p_version IS NULL
     OR p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$' THEN
    RAISE EXCEPTION 'invalid extension version' USING ERRCODE = 'SB034';
  END IF;
  IF p_source IS NULL
     OR length(p_source) NOT BETWEEN 1 AND 500
     OR (
       left(p_source, 8) <> 'https://'
       AND p_source !~ '^[a-z][a-z0-9-]*:[^/][a-zA-Z0-9._/~?#%@!$&''()*+,;=-]+$'
     ) THEN
    RAISE EXCEPTION 'invalid extension source' USING ERRCODE = 'SB034';
  END IF;
  PERFORM internal.validate_extension_manifest(p_manifest);
  -- Row columns mirror the manifest identity: one authority, no drift.
  IF btrim(p_manifest->>'name') IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'extension name must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'version') IS DISTINCT FROM p_version THEN
    RAISE EXCEPTION 'extension version must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  IF (p_manifest->>'source') IS DISTINCT FROM p_source THEN
    RAISE EXCEPTION 'extension source must match the manifest' USING ERRCODE = 'SB034';
  END IF;
  INSERT INTO api.extensions(
    workspace_id, key, name, version, source, manifest, status,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_key, v_name, p_version, p_source, p_manifest, 'installed',
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.install_extension(uuid, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.install_extension(uuid, text, text, text, text, jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.enable_extension(
  p_workspace_id uuid,
  p_extension_id uuid
)
RETURNS api.extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status = 'enabled' THEN
    RETURN v;
  END IF;
  UPDATE api.extensions SET
    status = 'enabled',
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_extension_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.enable_extension(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.enable_extension(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.disable_extension(
  p_workspace_id uuid,
  p_extension_id uuid
)
RETURNS api.extensions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'extensions.manage');
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status = 'disabled' THEN
    RETURN v;
  END IF;
  UPDATE api.extensions SET
    status = 'disabled',
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = p_extension_id
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.disable_extension(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.disable_extension(uuid, uuid) TO authenticated;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Extension-attributed authority: declared capabilities for a member reader,
-- and the per-call gate EXT-02 consumes at each enforcement point.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION api.extension_capabilities(
  p_workspace_id uuid,
  p_extension_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_manifest jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships membership
     WHERE membership.workspace_id = p_workspace_id
       AND membership.user_id = api.current_user_id()
       AND membership.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT manifest INTO v_manifest FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id;
  IF v_manifest IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  RETURN COALESCE(
    (SELECT array_agg(value ORDER BY value)
       FROM jsonb_array_elements_text(v_manifest->'capabilities') AS value),
    '{}'::text[]
  );
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.extension_capabilities(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.extension_capabilities(uuid, uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.assert_extension_capability(
  p_workspace_id uuid,
  p_extension_id uuid,
  p_capability text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v api.extensions;
  v_declared text[];
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  SELECT * INTO v FROM api.extensions
   WHERE id = p_extension_id AND workspace_id = p_workspace_id;
  IF v IS NULL THEN
    RAISE EXCEPTION 'extension not found' USING ERRCODE = 'SB036';
  END IF;
  IF v.status <> 'enabled' THEN
    RAISE EXCEPTION 'extension is not enabled' USING ERRCODE = 'SB042';
  END IF;
  SELECT array_agg(value) INTO v_declared
    FROM jsonb_array_elements_text(v.manifest->'capabilities') AS value;
  IF p_capability IS NULL OR NOT (p_capability = ANY (COALESCE(v_declared, '{}'::text[]))) THEN
    RAISE EXCEPTION 'capability required: %', COALESCE(p_capability, '')
      USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(p_workspace_id, p_capability);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.assert_extension_capability(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.assert_extension_capability(uuid, uuid, text) TO authenticated, api_client;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Table grants + RLS. Reads are member-visible; every mutation goes through
-- the SECURITY DEFINER RPCs above. No api_client grant and no external
-- allowlist entries: the extensions registry stays invisible to external
-- credentials (fail-closed; EXT-01 adds nothing to EXTERNAL_TABLE_ACCESS /
-- EXTERNAL_RPC_SCOPES).
-- ---------------------------------------------------------------------------
GRANT SELECT ON api.extensions TO authenticated;
--> statement-breakpoint
ALTER TABLE api.extensions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY extensions_select ON api.extensions FOR SELECT TO authenticated
  USING (api.storage_member_using(workspace_id));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- change_events vocabulary + trigger: every lifecycle transition audited.
-- ---------------------------------------------------------------------------
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK (
  entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link', 'scientific_table',
    'scientific_row', 'formula', 'calculation', 'record_field_definition',
    'model_field_option', 'file', 'dataset_schema', 'dataset_schema_field',
    'dataset_schema_relationship', 'dataset', 'dataset_version', 'sample_event',
    'comment', 'review_submission', 'signature', 'review_decision', 'storage_site',
    'storage_room', 'storage_unit', 'storage_shelf', 'storage_rack', 'storage_box',
    'storage_position', 'storage_movement', 'plate_design', 'plate_well',
    'plate_layout_template', 'calendar_resource', 'calendar_booking',
    'calendar_booking_participant', 'calendar_booking_sample', 'study_workstream',
    'study_task', 'study_task_dependency', 'study_task_assignment',
    'study_task_resource', 'study_deliverable', 'study_project', 'study_experiment',
    'study_plan_snapshot', 'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot', 'instrument_qc_check',
    'instrument_raw_file', 'instrument_run_link', 'report_definition',
    'report_section', 'report_generation', 'sheet_instance', 'sheet_definition',
    'sheet_definition_version', 'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential', 'connector', 'connector_run', 'pipeline_definition',
    'pipeline_definition_version', 'pipeline_run', 'pipeline_schedule',
    'webhook_subscription', 'webhook_delivery', 'agent_operation_policy',
    'agent_operation_proposal', 'extension'
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.trg_change_event_extension() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_op text; v_payload jsonb; BEGIN
  CASE TG_OP
    WHEN 'INSERT' THEN v_op := 'create'; v_payload := to_jsonb(NEW);
    WHEN 'UPDATE' THEN v_op := 'update'; v_payload := to_jsonb(NEW);
    WHEN 'DELETE' THEN v_op := 'delete'; v_payload := to_jsonb(OLD);
  END CASE;
  PERFORM internal.emit_change_event(COALESCE(NEW.workspace_id, OLD.workspace_id), 'extension', COALESCE(NEW.id, OLD.id), v_op, NULL, NULL, v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_extension() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_extensions AFTER INSERT OR UPDATE OR DELETE ON api.extensions
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_extension();
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';