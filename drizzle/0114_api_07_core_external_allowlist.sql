-- API-07: Core external allowlist cut-over.
-- Grant api_client EXECUTE on the same Dataset/Sheet/Notebook RPCs the
-- product UI uses, plus workspace-pinned table reads (and Dataset create).
-- Schema-authoring RPCs stay revoked. Unknown paths stay fail-closed at the
-- proxy (`src/lib/external-token.ts`).
--
-- api_client is not a workspace member. Treat a matching workspace_id claim
-- as membership for 1-arg checks, and grant only data-plane capabilities
-- (record.create / record.link / instance.upgrade). schema.edit/publish/retire
-- stay false so Dataset Schema Version and Sheet Definition authoring cannot
-- hide behind datasets:* or sheets:write even if EXECUTE were granted.

CREATE OR REPLACE FUNCTION api.is_workspace_member(p_workspace_id uuid, p_role text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
      p_workspace_id IS NOT DISTINCT FROM api.current_workspace_id()
      AND p_role IS NULL
    ELSE EXISTS (
      SELECT 1
        FROM api.workspace_memberships m
       WHERE m.workspace_id = p_workspace_id
         AND m.user_id = api.current_user_id()
         AND m.suspended_at IS NULL
         AND (p_role IS NULL OR m.role = p_role)
    )
  END
$$;
--> statement-breakpoint

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
  IF p_workspace_id IS NULL
     OR p_capability IS NULL
     OR btrim(p_capability) = ''
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RETURN false;
  END IF;
  IF coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RETURN p_capability IN ('record.create', 'record.link', 'instance.upgrade');
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
  IF session_user = 'migrator' THEN
    v_mask := nullif(btrim(current_setting('sheetbase.capability_mask', true)), '');
    IF v_mask IS NOT NULL THEN
      RETURN p_capability = ANY (
        string_to_array(regexp_replace(v_mask, '\s', '', 'g'), ',')
      );
    END IF;
  END IF;
  CASE
    WHEN p_capability = 'workspace.admin' THEN
      RETURN v_role = 'owner';
    WHEN p_capability IN ('schema.edit', 'schema.publish', 'schema.retire') THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability IN ('record.link', 'record.create', 'instance.upgrade') THEN
      RETURN v_role IN (
        'owner',
        'admin',
        'member',
        'steward',
        'scientist',
        'analyst',
        'reviewer'
      );
    ELSE
      RETURN false;
  END CASE;
END;
$$;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION api.is_workspace_member(uuid, text) TO api_client;
GRANT EXECUTE ON FUNCTION api.is_workspace_writer(uuid) TO api_client;
GRANT EXECUTE ON FUNCTION api.has_capability(uuid, text) TO api_client;
GRANT EXECUTE ON FUNCTION api.current_user_id() TO api_client;
--> statement-breakpoint

DO $api07_rpc$
DECLARE
  names text[] := ARRAY[
    'create_project',
    'create_record',
    'create_record_with_blocks',
    'update_block_payload',
    'move_block',
    'archive_record',
    'restore_record',
    'create_record_link',
    'insert_block',
    'delete_block',
    'transition_record_status',
    'instantiate_template',
    'query_dataset_rows',
    'query_dataset_version_rows',
    'validate_dataset_row_batch',
    'commit_dataset_row_batch',
    'snapshot_dataset',
    'archive_dataset',
    'restore_dataset',
    'query_sheet_instance_rows',
    'read_sheet_instance_calculation_results',
    'resolve_sheet_instance_row_identity',
    'preview_sheet_instance_composition_adoption',
    'preview_sheet_materialization',
    'preview_sheet_instance_definition_upgrade',
    'create_sheet_instance',
    'create_sheet_instance_from_definition',
    'update_sheet_instance',
    'archive_sheet_instance',
    'restore_sheet_instance',
    'duplicate_sheet_instance',
    'mutate_sheet_instance_local_state',
    'mutate_sheet_instance_calculations',
    'insert_sheet_instance_block',
    'duplicate_sheet_instance_block',
    'apply_sheet_instance_composition_adoption',
    'materialize_sheet_instance',
    'apply_sheet_instance_definition_upgrade',
    'validate_sheet_record_batch',
    'search',
    'search_sheet_records',
    'update_record_custom_fields',
    'create_and_link_sheet_record',
    'commit_sheet_record_batch',
    'preview_submission_digest',
    'run_revision_checks',
    'submit_record_revision',
    'instantiate_notebook_template_version',
    'preview_notebook_template_upgrade',
    'apply_notebook_template_upgrade'
  ];
  fn text;
  r record;
BEGIN
  FOREACH fn IN ARRAY names LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'api'
         AND p.proname = fn
    ) THEN
      RAISE EXCEPTION 'API-07 allowlist RPC missing: api.%', fn;
    END IF;
  END LOOP;
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'api'
       AND p.proname = ANY (names)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO api_client', r.sig);
  END LOOP;
  EXECUTE 'GRANT EXECUTE ON FUNCTION internal.ad_hoc_sheet_instance_state() TO api_client';
END
$api07_rpc$;
--> statement-breakpoint

GRANT SELECT, INSERT ON api.datasets TO api_client;
GRANT SELECT ON api.dataset_versions TO api_client;
GRANT SELECT ON api.sheet_instances TO api_client;
GRANT SELECT ON api.dataset_schema_definitions TO api_client;
GRANT SELECT ON api.dataset_schema_versions TO api_client;
GRANT SELECT ON api.dataset_schema_version_fields TO api_client;
GRANT SELECT ON api.sheet_definitions TO api_client;
GRANT SELECT ON api.sheet_definition_versions TO api_client;
GRANT SELECT ON api.notebook_templates TO api_client;
GRANT SELECT ON api.notebook_template_versions TO api_client;
--> statement-breakpoint

CREATE POLICY datasets_select_api_client ON api.datasets
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY datasets_insert_api_client ON api.datasets
  FOR INSERT TO api_client
  WITH CHECK (workspace_id = api.current_workspace_id());
CREATE POLICY dataset_versions_select_api_client ON api.dataset_versions
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY sheet_instances_select_api_client ON api.sheet_instances
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY dataset_schema_definitions_select_api_client ON api.dataset_schema_definitions
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY dataset_schema_versions_select_api_client ON api.dataset_schema_versions
  FOR SELECT TO api_client
  USING (EXISTS (
    SELECT 1 FROM api.dataset_schema_definitions s
     WHERE s.id = schema_id
       AND s.workspace_id = api.current_workspace_id()
  ));
CREATE POLICY dataset_schema_version_fields_select_api_client ON api.dataset_schema_version_fields
  FOR SELECT TO api_client
  USING (EXISTS (
    SELECT 1
      FROM api.dataset_schema_versions v
      JOIN api.dataset_schema_definitions s ON s.id = v.schema_id
     WHERE v.id = schema_version_id
       AND s.workspace_id = api.current_workspace_id()
  ));
CREATE POLICY sheet_definitions_select_api_client ON api.sheet_definitions
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY sheet_definition_versions_select_api_client ON api.sheet_definition_versions
  FOR SELECT TO api_client
  USING (EXISTS (
    SELECT 1 FROM api.sheet_definitions d
     WHERE d.id = definition_id
       AND d.workspace_id = api.current_workspace_id()
  ));
CREATE POLICY notebook_templates_select_api_client ON api.notebook_templates
  FOR SELECT TO api_client
  USING (workspace_id = api.current_workspace_id());
CREATE POLICY notebook_template_versions_select_api_client ON api.notebook_template_versions
  FOR SELECT TO api_client
  USING (EXISTS (
    SELECT 1 FROM api.notebook_templates t
     WHERE t.id = template_id
       AND t.workspace_id = api.current_workspace_id()
  ));
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
