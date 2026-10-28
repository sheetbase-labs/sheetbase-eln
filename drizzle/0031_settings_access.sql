-- Which roles can open and change each settings area is the workspace's
-- choice. Every area (General, Members and roles, Instruments, ...) has a
-- level per role: none, view or manage. A workspace owner always manages
-- everything and cannot be locked out. A role with no row keeps its default,
-- which is how the workspace behaved before this setting existed, plus Data
-- Stewards managing Instruments, Integrations and Storage and labels.
--
-- The server enforces it: api.has_capability resolves 'integrations.manage'
-- and 'settings.<area>.<view|manage>' through the same mapping, and the
-- settings RPCs below gate on their own area instead of owner-only.

CREATE TABLE api.settings_access (
    workspace_id uuid NOT NULL,
    area text NOT NULL,
    role text NOT NULL,
    level text NOT NULL,
    updated_by_user_id text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT settings_access_pkey PRIMARY KEY (workspace_id, area, role),
    CONSTRAINT chk_settings_access_area CHECK (area IN (
      'general', 'ai', 'members', 'signatures', 'clients', 'instruments',
      'integrations', 'storage', 'access', 'audit', 'diagnostics', 'usage')),
    CONSTRAINT chk_settings_access_role CHECK (role IN (
      'admin', 'steward', 'member', 'scientist', 'analyst', 'reviewer', 'viewer')),
    CONSTRAINT chk_settings_access_level CHECK (level IN ('none', 'view', 'manage'))
);
--> statement-breakpoint
ALTER TABLE api.settings_access OWNER TO migrator;
--> statement-breakpoint
ALTER TABLE ONLY api.settings_access
    ADD CONSTRAINT settings_access_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES api.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY api.settings_access
    ADD CONSTRAINT settings_access_updated_by_user_id_user_id_fk FOREIGN KEY (updated_by_user_id) REFERENCES internal."user"(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE api.settings_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY settings_access_select ON api.settings_access FOR SELECT TO authenticated USING (((workspace_id = api.current_workspace_id()) AND api.is_workspace_member(workspace_id)));
--> statement-breakpoint
GRANT SELECT ON TABLE api.settings_access TO authenticated;
--> statement-breakpoint
CREATE FUNCTION internal.settings_access_default(p_area text, p_role text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p_role = 'admin' THEN 'manage'
    WHEN p_role = 'steward' AND p_area IN ('instruments', 'integrations', 'storage') THEN 'manage'
    ELSE 'none'
  END
$$;
--> statement-breakpoint
ALTER FUNCTION internal.settings_access_default(p_area text, p_role text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION api.settings_access_level(p_workspace_id uuid, p_area text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_role text;
  v_level text;
BEGIN
  IF p_workspace_id IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'role', '') = 'api_client' THEN
    RETURN 'none';
  END IF;
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = p_workspace_id
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN RETURN 'none'; END IF;
  IF v_role = 'owner' THEN RETURN 'manage'; END IF;
  SELECT s.level INTO v_level
    FROM api.settings_access s
   WHERE s.workspace_id = p_workspace_id AND s.area = p_area AND s.role = v_role;
  RETURN coalesce(v_level, internal.settings_access_default(p_area, v_role));
END
$$;
--> statement-breakpoint
ALTER FUNCTION api.settings_access_level(p_workspace_id uuid, p_area text) OWNER TO migrator;
--> statement-breakpoint
CREATE FUNCTION api.has_settings_access(p_workspace_id uuid, p_area text, p_level text DEFAULT 'view') RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE api.settings_access_level(p_workspace_id, p_area)
    WHEN 'manage' THEN true
    WHEN 'view' THEN p_level = 'view'
    ELSE false
  END
$$;
--> statement-breakpoint
ALTER FUNCTION api.has_settings_access(p_workspace_id uuid, p_area text, p_level text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.settings_access_level(uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.settings_access_level(uuid, text) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.has_settings_access(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.has_settings_access(uuid, text, text) TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.set_settings_access(p_workspace_id uuid, p_area text, p_role text, p_level text) RETURNS api.settings_access
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.settings_access;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_level NOT IN ('none', 'view', 'manage') THEN
    RAISE EXCEPTION 'invalid access level' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.settings_access (workspace_id, area, role, level, updated_by_user_id)
  VALUES (p_workspace_id, p_area, p_role, p_level, api.current_user_id())
  ON CONFLICT (workspace_id, area, role) DO UPDATE
    SET level = excluded.level, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
  RETURNING * INTO v;
  PERFORM internal.emit_change_event(p_workspace_id, 'workspace_settings', p_workspace_id, 'update', NULL, NULL,
    jsonb_build_object('effect', 'settings_access', 'area', p_area, 'role', p_role, 'level', p_level));
  RETURN v;
END
$$;
--> statement-breakpoint
ALTER FUNCTION api.set_settings_access(p_workspace_id uuid, p_area text, p_role text, p_level text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_settings_access(uuid, text, text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.set_settings_access(uuid, text, text, text) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.has_capability(p_workspace_id uuid, p_capability text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
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
      RETURN api.has_settings_access(p_workspace_id, 'integrations', 'manage');
    WHEN p_capability ~ '^settings\.[a-z_]+\.(view|manage)$' THEN
      RETURN api.has_settings_access(
        p_workspace_id, split_part(p_capability, '.', 2), split_part(p_capability, '.', 3));
    WHEN p_capability = 'pipelines.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    WHEN p_capability = 'extensions.manage' THEN
      RETURN v_role IN ('owner', 'admin', 'steward');
    -- LAB-02 step 2: release is the authorised-person QC gate; quarantine and
    -- disposal are scientific actions. api_client stays fail-closed (the
    -- sample RPCs are not in the external allowlist).
    WHEN p_capability = 'sample.release' THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist', 'reviewer');
    WHEN p_capability IN ('sample.quarantine', 'sample.dispose') THEN
      RETURN v_role IN ('owner', 'admin', 'steward', 'scientist');
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
CREATE OR REPLACE FUNCTION api.update_workspace_settings(p_workspace_id uuid, p_registration_mode text DEFAULT NULL::text, p_review_workflow_enabled boolean DEFAULT NULL::boolean, p_review_workflow_config jsonb DEFAULT NULL::jsonb, p_signature_policy jsonb DEFAULT NULL::jsonb, p_audit_retention_days integer DEFAULT NULL::integer, p_integration_settings jsonb DEFAULT NULL::jsonb, p_require_change_reason boolean DEFAULT NULL::boolean, p_lock_on_sign boolean DEFAULT NULL::boolean, p_allow_offline_editing boolean DEFAULT NULL::boolean) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  -- Each setting is gated by the settings area it belongs to.
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR (p_registration_mode IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'members', 'manage'))
     OR ((p_review_workflow_enabled IS NOT NULL OR p_review_workflow_config IS NOT NULL
          OR p_require_change_reason IS NOT NULL OR p_lock_on_sign IS NOT NULL
          OR p_allow_offline_editing IS NOT NULL)
         AND NOT api.has_settings_access(p_workspace_id, 'general', 'manage'))
     OR (p_signature_policy IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'signatures', 'manage'))
     OR (p_audit_retention_days IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'audit', 'manage'))
     OR (p_integration_settings IS NOT NULL
         AND NOT api.has_settings_access(p_workspace_id, 'integrations', 'manage')) THEN
    RAISE EXCEPTION 'access required' USING ERRCODE = 'SB056';
  END IF;
  IF p_registration_mode IS NOT NULL AND p_registration_mode NOT IN ('open', 'invitation_only') THEN
    RAISE EXCEPTION 'invalid registration mode' USING ERRCODE = 'SB056';
  END IF;
  IF p_audit_retention_days IS NOT NULL AND p_audit_retention_days <= 0 THEN
    RAISE EXCEPTION 'invalid retention days' USING ERRCODE = 'SB057';
  END IF;
  INSERT INTO api.workspace_settings(
    workspace_id, registration_mode, review_workflow_enabled, review_workflow_config,
    signature_policy, audit_retention_days, integration_settings,
    require_change_reason, lock_on_sign, allow_offline_editing, created_by_user_id)
  VALUES (
    p_workspace_id, coalesce(p_registration_mode, 'open'), coalesce(p_review_workflow_enabled, false),
    coalesce(p_review_workflow_config, '{}'), coalesce(p_signature_policy, '{}'),
    coalesce(p_audit_retention_days, 2555), coalesce(p_integration_settings, '{}'),
    coalesce(p_require_change_reason, false), coalesce(p_lock_on_sign, true),
    coalesce(p_allow_offline_editing, true), api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET
    registration_mode = coalesce(p_registration_mode, api.workspace_settings.registration_mode),
    review_workflow_enabled = coalesce(p_review_workflow_enabled, api.workspace_settings.review_workflow_enabled),
    review_workflow_config = coalesce(p_review_workflow_config, api.workspace_settings.review_workflow_config),
    signature_policy = coalesce(p_signature_policy, api.workspace_settings.signature_policy),
    audit_retention_days = coalesce(p_audit_retention_days, api.workspace_settings.audit_retention_days),
    integration_settings = coalesce(p_integration_settings, api.workspace_settings.integration_settings),
    require_change_reason = coalesce(p_require_change_reason, api.workspace_settings.require_change_reason),
    lock_on_sign = coalesce(p_lock_on_sign, api.workspace_settings.lock_on_sign),
    allow_offline_editing = coalesce(p_allow_offline_editing, api.workspace_settings.allow_offline_editing),
    updated_at = now()
  RETURNING * INTO v;
  IF p_require_change_reason IS NOT NULL OR p_lock_on_sign IS NOT NULL OR p_allow_offline_editing IS NOT NULL THEN
    PERFORM internal.emit_change_event(v.workspace_id, 'workspace_settings', v.workspace_id, 'update', NULL, NULL,
      jsonb_build_object('effect', 'editing_rules',
        'requireChangeReason', v.require_change_reason,
        'lockOnSign', v.lock_on_sign,
        'allowOfflineEditing', v.allow_offline_editing));
  END IF;
  RETURN v;
END $$;
--> statement-breakpoint
-- api.change_member_role: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.change_member_role(p_workspace_id uuid, p_user_id text, p_new_role text, p_client_id uuid DEFAULT NULL::uuid) RETURNS api.workspace_memberships
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF (p_new_role = 'owner' OR EXISTS (SELECT 1 FROM api.workspace_memberships x WHERE x.workspace_id = p_workspace_id AND x.user_id = p_user_id AND x.role = 'owner')) AND NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only a workspace admin can change an owner' USING ERRCODE='SB052';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage')
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052';
  END IF;
  IF p_new_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer','client_viewer') THEN
    RAISE EXCEPTION 'invalid role' USING ERRCODE='SB053';
  END IF;
  IF p_new_role = 'client_viewer' THEN
    IF p_client_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM api.clients c WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'a client viewer needs a client' USING ERRCODE='SB053';
    END IF;
  ELSIF p_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'only client viewers carry a client' USING ERRCODE='SB053';
  END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot change own role' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND p_new_role<>'owner'
     AND (SELECT count(*) FROM api.workspace_memberships
           WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN
    RAISE EXCEPTION 'cannot demote last owner' USING ERRCODE='SB051';
  END IF;
  UPDATE api.workspace_memberships
     SET role=p_new_role,client_id=p_client_id,updated_at=now()
   WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
-- api.create_invitation: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.create_invitation(p_workspace_id uuid, p_email text, p_role text DEFAULT 'member'::text, p_expires_after_days integer DEFAULT 7, p_client_id uuid DEFAULT NULL::uuid, p_project_grants jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v api.workspace_invitations;
  v_token text:=gen_random_uuid()::text;
  v_grant jsonb;
  v_grants jsonb:=coalesce(p_project_grants,'[]'::jsonb);
BEGIN
  IF (p_role = 'owner') AND NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only a workspace admin can change an owner' USING ERRCODE='SB052';
  END IF;
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061';
  END IF;
  IF p_email IS NULL OR btrim(p_email) !~ '^[^@]+@[^@]+\.[^@]+$'
     OR p_role NOT IN ('owner','admin','member','steward','scientist','analyst','reviewer','viewer','client_viewer')
     OR p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN
    RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061';
  END IF;
  IF p_role = 'client_viewer' THEN
    IF p_client_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM api.clients c
       WHERE c.id = p_client_id AND c.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'a client viewer invitation needs a client' USING ERRCODE='SB061';
    END IF;
  ELSIF p_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'only client viewers carry a client' USING ERRCODE='SB061';
  END IF;
  IF jsonb_typeof(v_grants) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'project grants must be a list' USING ERRCODE='SB061';
  END IF;
  IF jsonb_array_length(v_grants) > 0 AND p_role = 'client_viewer' THEN
    RAISE EXCEPTION 'a client viewer joins through the client portal, not projects' USING ERRCODE='SB061';
  END IF;
  -- Each grant is the inviter's own authority: they must be able to manage the
  -- project, exactly as when they add the person after the fact.
  FOR v_grant IN SELECT * FROM jsonb_array_elements(v_grants) LOOP
    IF coalesce(v_grant->>'access_level','') NOT IN ('owner','editor','reviewer','viewer')
       OR NOT EXISTS (
         SELECT 1 FROM api.projects p
          WHERE p.id = (v_grant->>'project_id')::uuid
            AND p.workspace_id = p_workspace_id
            AND internal.can_manage_project(p.id)
       ) THEN
      RAISE EXCEPTION 'you cannot grant access to that project' USING ERRCODE='SB061';
    END IF;
  END LOOP;
  INSERT INTO api.workspace_invitations(
    workspace_id,email,role,client_id,project_grants,token_hash,expires_at,created_by_user_id
  ) VALUES(
    p_workspace_id,
    lower(btrim(p_email)),
    p_role,
    p_client_id,
    v_grants,
    encode(sha256(convert_to(v_token,'UTF8')),'hex'),
    now()+make_interval(days=>p_expires_after_days),
    api.current_user_id()
  ) RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $_$;
--> statement-breakpoint
-- api.reissue_invitation: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.reissue_invitation(p_workspace_id uuid, p_invitation_id uuid, p_expires_after_days integer DEFAULT 7) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_invitations; v_token text:=gen_random_uuid()::text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN
    RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061';
  END IF;
  IF p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN
    RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061';
  END IF;
  SELECT * INTO v FROM api.workspace_invitations
   WHERE id=p_invitation_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF v IS NULL OR v.status NOT IN ('pending','expired') THEN
    RAISE EXCEPTION 'invitation is not pending' USING ERRCODE='SB061';
  END IF;
  UPDATE api.workspace_invitations
     SET token_hash=encode(sha256(convert_to(v_token,'UTF8')),'hex'),
         status='pending',
         expires_at=now()+make_interval(days=>p_expires_after_days),
         updated_at=now()
   WHERE id=v.id RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;
--> statement-breakpoint
-- api.revoke_invitation: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.revoke_invitation(p_workspace_id uuid, p_invitation_id uuid) RETURNS api.workspace_invitations
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_invitations;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.has_settings_access(p_workspace_id, 'members', 'manage') THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061'; END IF;
  UPDATE api.workspace_invitations SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=p_invitation_id AND workspace_id=p_workspace_id AND status='pending' RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'pending invitation not found' USING ERRCODE='SB061'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
-- api.remove_member: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.remove_member(p_workspace_id uuid, p_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF (EXISTS (SELECT 1 FROM api.workspace_memberships x WHERE x.workspace_id = p_workspace_id AND x.user_id = p_user_id AND x.role = 'owner')) AND NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only a workspace admin can change an owner' USING ERRCODE='SB052';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot remove self' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN RAISE EXCEPTION 'cannot remove last owner' USING ERRCODE='SB051'; END IF;
  DELETE FROM api.workspace_memberships WHERE id=v.id;
END $$;
--> statement-breakpoint
-- api.suspend_member: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.suspend_member(p_workspace_id uuid, p_user_id text) RETURNS api.workspace_memberships
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF (EXISTS (SELECT 1 FROM api.workspace_memberships x WHERE x.workspace_id = p_workspace_id AND x.user_id = p_user_id AND x.role = 'owner')) AND NOT api.has_capability(p_workspace_id, 'workspace.admin') THEN
    RAISE EXCEPTION 'only a workspace admin can change an owner' USING ERRCODE='SB052';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot suspend self' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND v.suspended_at IS NULL AND (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN RAISE EXCEPTION 'cannot suspend last owner' USING ERRCODE='SB051'; END IF;
  UPDATE api.workspace_memberships SET suspended_at=now(),updated_at=now() WHERE id=v.id RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
-- api.reinstate_member: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.reinstate_member(p_workspace_id uuid, p_user_id text) RETURNS api.workspace_memberships
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  UPDATE api.workspace_memberships SET suspended_at=NULL,updated_at=now() WHERE workspace_id=p_workspace_id AND user_id=p_user_id RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF; RETURN v;
END $$;
--> statement-breakpoint
-- api.list_workspace_sessions: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.list_workspace_sessions(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB055'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s."userId",'user_name',u.name,'ip_address',s."ipAddress",'user_agent',s."userAgent",'created_at',s."createdAt",'expires_at',s."expiresAt") ORDER BY s."createdAt" DESC),'[]'::jsonb)
    FROM internal.session s JOIN api.workspace_memberships m ON m.user_id=s."userId" AND m.workspace_id=p_workspace_id JOIN internal."user" u ON u.id=s."userId");
END $$;
--> statement-breakpoint
-- api.revoke_user_session: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.revoke_user_session(p_workspace_id uuid, p_session_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_user text;
BEGIN
  IF NOT api.has_settings_access(p_workspace_id, 'members', 'manage') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB055'; END IF;
  SELECT "userId" INTO v_user FROM internal.session WHERE id=p_session_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'session not found' USING ERRCODE='SB054'; END IF;
  IF NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=v_user) THEN RAISE EXCEPTION 'session belongs to different workspace' USING ERRCODE='SB055'; END IF;
  DELETE FROM internal.session WHERE id=p_session_id; RETURN jsonb_build_object('success',true,'session_id',p_session_id);
END $$;
--> statement-breakpoint
-- api.workspace_member_status: gate is now the members settings area (view).
CREATE OR REPLACE FUNCTION api.workspace_member_status() RETURNS TABLE(user_id text, last_active_at timestamp with time zone, training_required bigint, training_overdue bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  WITH required AS (
    SELECT m.user_id, v.id AS version_id, v.review_due_at
      FROM api.workspace_memberships m
      JOIN api.project_access a
        ON a.workspace_id = m.workspace_id
       AND (a.user_id = m.user_id
            OR EXISTS (SELECT 1 FROM api.workspace_group_memberships g
                        WHERE g.workspace_id = m.workspace_id AND g.group_id = a.group_id
                          AND g.user_id = m.user_id))
      JOIN api.projects p ON p.id = a.project_id AND p.workspace_id = m.workspace_id
      JOIN api.project_protocols pp ON pp.project_id = p.id AND pp.workspace_id = m.workspace_id
      JOIN api.protocol_versions v ON v.id = pp.protocol_version_id
     WHERE m.workspace_id = api.current_workspace_id()
       AND m.suspended_at IS NULL
       AND m.role <> 'client_viewer'
       AND coalesce(a.can_view OR a.can_edit OR a.can_review OR a.can_manage, false)
       AND v.status = 'effective'
       AND internal.protocol_version_is_eligible(v.id, false)
  ), outstanding AS (
    SELECT r.user_id, r.review_due_at
      FROM required r
     WHERE NOT EXISTS (SELECT 1 FROM api.protocol_acknowledgements ack
                        WHERE ack.protocol_version_id = r.version_id AND ack.user_id = r.user_id)
  )
  SELECT m.user_id,
         (SELECT max(s."updatedAt") FROM internal.session s WHERE s."userId" = m.user_id),
         coalesce((SELECT count(*) FROM outstanding o WHERE o.user_id = m.user_id), 0),
         coalesce((SELECT count(*) FROM outstanding o
                    WHERE o.user_id = m.user_id AND o.review_due_at IS NOT NULL
                      AND o.review_due_at < now()), 0)
    FROM api.workspace_memberships m
   WHERE m.workspace_id = api.current_workspace_id()
     AND m.suspended_at IS NULL
     AND api.has_settings_access(m.workspace_id, 'members', 'view')
$$;
--> statement-breakpoint
-- api.create_workspace_group: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.create_workspace_group(p_name text) RETURNS api.workspace_groups
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE result api.workspace_groups;
BEGIN
  IF NOT api.has_settings_access(api.current_workspace_id(), 'members', 'manage') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.workspace_groups(workspace_id,name) VALUES(api.current_workspace_id(),btrim(p_name)) RETURNING * INTO result;
  RETURN result;
END $$;
--> statement-breakpoint
-- api.delete_workspace_group: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.delete_workspace_group(p_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT api.has_settings_access(api.current_workspace_id(), 'members', 'manage') OR NOT EXISTS(SELECT 1 FROM api.workspace_groups WHERE id=p_group_id AND workspace_id=api.current_workspace_id()) THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  UPDATE api.workspace_settings SET integration_settings=integration_settings-'projectAccessDefaults',updated_at=now()
    WHERE workspace_id=api.current_workspace_id() AND integration_settings->'projectAccessDefaults'->>'qaViewGroupId'=p_group_id::text;
  DELETE FROM api.workspace_groups WHERE id=p_group_id;
END $$;
--> statement-breakpoint
-- api.set_workspace_group_member: gate is now the members settings area (manage).
CREATE OR REPLACE FUNCTION api.set_workspace_group_member(p_group_id uuid, p_user_id text, p_is_member boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE workspace uuid;
BEGIN
  SELECT workspace_id INTO workspace FROM api.workspace_groups WHERE id=p_group_id FOR UPDATE;
  IF workspace IS DISTINCT FROM api.current_workspace_id() OR NOT api.has_settings_access(workspace, 'members', 'manage')
    OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=workspace AND user_id=p_user_id AND suspended_at IS NULL) THEN RAISE EXCEPTION 'Active same-workspace member and administrator required' USING ERRCODE='42501'; END IF;
  IF p_is_member THEN
    IF EXISTS(SELECT 1 FROM api.project_access a JOIN api.projects p ON p.id=a.project_id JOIN api.workspace_memberships m ON m.workspace_id=workspace AND m.user_id=p_user_id WHERE a.group_id=p_group_id AND a.client_portal AND (m.role<>'client_viewer' OR m.client_id IS DISTINCT FROM p.client_id)) THEN RAISE EXCEPTION 'Portal group is restricted to its project client' USING ERRCODE='42501'; END IF;
    INSERT INTO api.workspace_group_memberships(workspace_id,group_id,user_id) VALUES(workspace,p_group_id,p_user_id) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM api.workspace_group_memberships WHERE group_id=p_group_id AND user_id=p_user_id;
  END IF;
END $$;
--> statement-breakpoint
-- api.update_workspace_general: gate is now the general settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_general(p_workspace_id uuid, p_site text DEFAULT NULL::text, p_timezone text DEFAULT NULL::text, p_date_format text DEFAULT NULL::text, p_number_format text DEFAULT NULL::text) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_number_format IS NOT NULL
     AND p_number_format NOT IN ('decimal', 'scientific') THEN
    RAISE EXCEPTION 'unknown number format' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.workspace_settings (workspace_id, created_by_user_id)
  VALUES (p_workspace_id, api.current_user_id())
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE api.workspace_settings
    SET site = p_site,
        timezone = coalesce(p_timezone, timezone),
        date_format = coalesce(p_date_format, date_format),
        number_format = coalesce(p_number_format, number_format),
        updated_at = now()
    WHERE workspace_id = p_workspace_id
    RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
-- api.update_workspace_name: gate is now the general settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_name(p_workspace_id uuid, p_name text) RETURNS api.workspaces
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.workspaces;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'workspace name must be 1–120 characters' USING ERRCODE = '22023';
  END IF;
  UPDATE api.workspaces
     SET name = btrim(p_name), updated_at = now()
   WHERE id = p_workspace_id
   RETURNING * INTO v;
  RETURN v;
END;
$$;
--> statement-breakpoint
-- api.update_workspace_id_prefixes: gate is now the general settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_id_prefixes(p_workspace_id uuid, p_prefixes jsonb) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v api.workspace_settings;
  key text;
  value text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(coalesce(p_prefixes, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'id prefixes must be an object' USING ERRCODE = '22023';
  END IF;
  FOR key, value IN SELECT * FROM jsonb_each_text(coalesce(p_prefixes, '{}'::jsonb)) LOOP
    IF key !~ '^[a-z][a-z0-9_]{0,59}$'
       OR value !~ '^[A-Z][A-Z0-9]{0,9}$' THEN
      RAISE EXCEPTION 'invalid identifier prefix' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO api.workspace_settings (workspace_id, created_by_user_id, id_prefixes)
  VALUES (p_workspace_id, api.current_user_id(), coalesce(p_prefixes, '{}'::jsonb))
  ON CONFLICT (workspace_id) DO UPDATE
    SET id_prefixes = EXCLUDED.id_prefixes, updated_at = now()
  RETURNING * INTO v;
  RETURN v;
END;
$_$;
--> statement-breakpoint
-- api.update_workspace_publication_policy: gate is now the general settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_publication_policy(p_workspace_id uuid, p_required boolean) RETURNS api.workspace_settings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT api.has_settings_access(p_workspace_id, 'general', 'manage') THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_required IS NULL THEN
    RAISE EXCEPTION 'publication policy is required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.workspace_settings(workspace_id,created_by_user_id)
    VALUES(p_workspace_id,api.current_user_id()) ON CONFLICT(workspace_id) DO NOTHING;
  UPDATE api.workspace_settings SET publication_approval_required=p_required, updated_at=now()
    WHERE workspace_id=p_workspace_id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
-- api.export_audit_log: gate is now the audit settings area (view).
CREATE OR REPLACE FUNCTION api.export_audit_log(p_workspace_id uuid, p_from_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 1000) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT api.has_settings_access(p_workspace_id, 'audit', 'view') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB060'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>5000 THEN RAISE EXCEPTION 'limit exceeds maximum' USING ERRCODE='SB060'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(e)-'payload'||jsonb_build_object('payload',e.payload-'token'-'token_hash'-'session_secret'-'sessionSecret'-'ip_address'-'ipAddress') ORDER BY e.sequence),'[]'::jsonb)
    FROM (SELECT * FROM api.change_events WHERE workspace_id=p_workspace_id AND internal.can_read_change_event(change_events) AND (p_from_date IS NULL OR created_at>=p_from_date) AND (p_to_date IS NULL OR created_at<=p_to_date) ORDER BY sequence LIMIT p_limit) e);
END $$;
--> statement-breakpoint
-- api.run_audit_verification: gate is now the audit settings area (manage).
CREATE OR REPLACE FUNCTION api.run_audit_verification(p_workspace_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_chain record;
  v_signed record;
  v_result jsonb;
  v_sequence bigint;
BEGIN
  -- User-facing callers must be an admin of the workspace they verify. The
  -- scheduled runner has no claim probe at all and is accepted only because it
  -- connects as this function's owner (the migrator role that applied it).
  IF api.claim_probe() IS NOT NULL THEN
    IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
       OR NOT api.has_settings_access(p_workspace_id, 'audit', 'manage') THEN
      RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT pg_has_role(
      current_user,
      (SELECT proowner FROM pg_proc
        WHERE oid = 'api.run_audit_verification(uuid)'::regprocedure),
      'USAGE') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_chain FROM internal.verify_audit_chain(p_workspace_id);
  SELECT * INTO v_signed FROM internal.verify_signed_revisions(p_workspace_id);

  v_result := jsonb_build_object(
    'ok', v_chain.ok AND v_signed.ok,
    'verifiedAt', now(),
    'chain', jsonb_build_object(
      'ok', v_chain.ok,
      'entriesChecked', v_chain.checked,
      'firstBadSequence', v_chain.first_bad_sequence,
      'firstBadId', v_chain.first_bad_id),
    'signedRevisions', jsonb_build_object(
      'ok', v_signed.ok,
      'checked', v_signed.checked,
      'firstBadSignatureId', v_signed.first_bad_signature_id,
      'firstBadRevisionId', v_signed.first_bad_revision_id));

  -- A System entry: no actor, subject 'system', the result as the payload. It is
  -- written directly because internal.emit_change_event is a no-op without a
  -- claim probe, and the job deliberately runs without a user session.
  INSERT INTO api.workspace_change_seq(workspace_id,last_seq) VALUES(p_workspace_id,1)
    ON CONFLICT(workspace_id) DO UPDATE
      SET last_seq=api.workspace_change_seq.last_seq+1, updated_at=now()
    RETURNING last_seq INTO v_sequence;
  INSERT INTO api.change_events(id,workspace_id,sequence,entity_type,entity_uuid,operation,payload)
    VALUES(gen_random_uuid(), p_workspace_id, v_sequence, 'system', gen_random_uuid(), 'create', v_result);

  RETURN v_result;
END $$;
--> statement-breakpoint
-- api.verify_audit_chain: gate is now the audit settings area (view).
CREATE OR REPLACE FUNCTION api.verify_audit_chain(p_workspace_id uuid) RETURNS TABLE(ok boolean, checked integer, first_bad_sequence bigint, first_bad_id uuid)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'audit', 'view') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM internal.verify_audit_chain(p_workspace_id);
END $$;
--> statement-breakpoint
-- api.set_project_access_defaults: gate is now the access settings area (manage).
CREATE OR REPLACE FUNCTION api.set_project_access_defaults(p_qa_view_group_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT api.has_settings_access(api.current_workspace_id(), 'access', 'manage') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  IF p_qa_view_group_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM api.workspace_groups g WHERE g.workspace_id=api.current_workspace_id() AND g.id=p_qa_view_group_id)
    OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g JOIN api.workspace_memberships m ON m.workspace_id=g.workspace_id AND m.user_id=g.user_id WHERE g.group_id=p_qa_view_group_id AND m.role='client_viewer')) THEN RAISE EXCEPTION 'Explicit internal workspace group required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.workspace_settings(workspace_id,created_by_user_id,integration_settings)
    VALUES(api.current_workspace_id(),api.current_user_id(),jsonb_build_object('projectAccessDefaults',jsonb_build_object('qaViewGroupId',p_qa_view_group_id)))
  ON CONFLICT(workspace_id) DO UPDATE SET integration_settings=workspace_settings.integration_settings||excluded.integration_settings,updated_at=now();
END $$;
--> statement-breakpoint
-- api.set_instrument_qualification: gate is now the instruments settings area (manage).
CREATE OR REPLACE FUNCTION api.set_instrument_qualification(p_instrument_id uuid, p_user_id text, p_valid_until timestamp with time zone, p_qualified_for text DEFAULT NULL::text) RETURNS api.instrument_qualifications
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_instrument api.instruments;
  v_row api.instrument_qualifications;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_settings_access(v_instrument.workspace_id, 'instruments', 'manage') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
     WHERE m.workspace_id = v_instrument.workspace_id
       AND m.user_id = p_user_id
       AND m.suspended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'an active workspace member is required' USING ERRCODE = '22023';
  END IF;
  IF p_valid_until IS NULL OR p_valid_until <= now() THEN
    RAISE EXCEPTION 'a future qualification expiry is required' USING ERRCODE = '22023';
  END IF;
  IF p_qualified_for IS NOT NULL AND length(btrim(p_qualified_for)) > 200 THEN
    RAISE EXCEPTION 'the qualified-for scope is too long' USING ERRCODE = '22023';
  END IF;

  IF p_qualified_for IS NOT NULL THEN
    UPDATE api.instruments
       SET qualified_for = nullif(btrim(p_qualified_for), ''),
           updated_at = now(),
           updated_by_user_id = api.current_user_id()
     WHERE id = v_instrument.id;
  END IF;

  INSERT INTO api.instrument_qualifications(
    workspace_id, instrument_id, user_id, valid_until, granted_by_user_id)
  VALUES (v_instrument.workspace_id, v_instrument.id, p_user_id, p_valid_until, api.current_user_id())
  ON CONFLICT (instrument_id, user_id) DO UPDATE
    SET valid_until = excluded.valid_until,
        granted_by_user_id = excluded.granted_by_user_id,
        updated_at = now()
  RETURNING * INTO v_row;

  UPDATE api.instrument_qualification_requests
     SET status = 'granted', decided_by_user_id = api.current_user_id(), updated_at = now()
   WHERE instrument_id = v_instrument.id
     AND user_id = p_user_id
     AND status = 'pending';

  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_granted', 'userId', p_user_id,
      'validUntil', p_valid_until, 'qualifiedFor', p_qualified_for));
  RETURN v_row;
END $$;
--> statement-breakpoint
-- api.revoke_instrument_qualification: gate is now the instruments settings area (manage).
CREATE OR REPLACE FUNCTION api.revoke_instrument_qualification(p_instrument_id uuid, p_user_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE v_instrument api.instruments;
BEGIN
  SELECT * INTO v_instrument FROM api.instruments
   WHERE id = p_instrument_id AND workspace_id = api.current_workspace_id();
  IF v_instrument.id IS NULL THEN
    RAISE EXCEPTION 'instrument not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_settings_access(v_instrument.workspace_id, 'instruments', 'manage') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  DELETE FROM api.instrument_qualifications
   WHERE instrument_id = v_instrument.id AND user_id = p_user_id;
  PERFORM internal.emit_change_event(v_instrument.workspace_id, 'instrument', v_instrument.id, 'update',
    NULL, NULL,
    jsonb_build_object('effect', 'qualification_revoked', 'userId', p_user_id));
END $$;
--> statement-breakpoint
-- api.dismiss_instrument_qualification_request: gate is now the instruments settings area (manage).
CREATE OR REPLACE FUNCTION api.dismiss_instrument_qualification_request(p_request_id uuid) RETURNS api.instrument_qualification_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.instrument_qualification_requests;
BEGIN
  SELECT * INTO v_row FROM api.instrument_qualification_requests
   WHERE id = p_request_id AND workspace_id = api.current_workspace_id();
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'request not found in active workspace' USING ERRCODE = '42501';
  END IF;
  IF NOT api.has_settings_access(v_row.workspace_id, 'instruments', 'manage') THEN
    RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
  END IF;
  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'this request has already been settled' USING ERRCODE = '22023';
  END IF;
  UPDATE api.instrument_qualification_requests
     SET status = 'dismissed', decided_by_user_id = api.current_user_id(), updated_at = now()
   WHERE id = v_row.id
   RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
-- api.update_workspace_ai_settings: gate is now the ai settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_ai_settings(
  p_workspace_id uuid,
  p_enabled boolean,
  p_provider_profile text,
  p_model text,
  p_cloud_egress_enabled boolean,
  p_max_tokens integer,
  p_max_cost integer
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.workspace_settings;
BEGIN
  -- A browser session carries `session_id`; a personal or service credential
  -- does not. Administration changes therefore cannot be driven by a token.
  IF api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'session_id', '') = ''
     OR coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'human session required for AI settings' USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF p_model IS NULL
     OR p_model NOT IN ('sheetbase-assist-1', 'sheetbase-summarise-1')
     OR p_max_tokens IS NULL
     OR p_max_tokens NOT BETWEEN 1 AND 100000
     OR p_max_cost IS NULL
     OR p_max_cost NOT BETWEEN 0 AND 10000000
     OR (p_provider_profile IS NOT NULL
         AND length(btrim(p_provider_profile)) NOT BETWEEN 1 AND 80) THEN
    RAISE EXCEPTION 'invalid AI settings' USING ERRCODE = '22023';
  END IF;

  UPDATE api.workspace_settings
     SET ai_enabled = p_enabled,
         ai_provider_profile = nullif(btrim(p_provider_profile), ''),
         ai_model = p_model,
         ai_cloud_egress_enabled = p_cloud_egress_enabled,
         ai_max_tokens_per_call = p_max_tokens,
         ai_max_cost_microusd_per_call = p_max_cost,
         ai_updated_by_user_id = api.current_user_id(),
         updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$$;
--> statement-breakpoint
-- api.update_workspace_ai_feature_flags: gate is now the ai settings area (manage).
CREATE OR REPLACE FUNCTION api.update_workspace_ai_feature_flags(
  p_workspace_id uuid,
  p_feature_flags jsonb
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.workspace_settings;
BEGIN
  -- A browser session carries `session_id`; a personal or service credential
  -- does not. Flags are human-owned and cannot be changed by an agent token.
  IF api.current_user_id() IS NULL
     OR coalesce(api.claim_probe()->>'session_id', '') = ''
     OR coalesce(api.claim_probe()->>'credential_id', '') <> '' THEN
    RAISE EXCEPTION 'human session required for AI access flags'
      USING ERRCODE = '42501';
  END IF;
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id()
     OR NOT api.has_settings_access(p_workspace_id, 'ai', 'manage') THEN
    RAISE EXCEPTION 'workspace owner required' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.valid_ai_feature_flags(p_feature_flags) THEN
    RAISE EXCEPTION 'invalid AI feature flags' USING ERRCODE = '22023';
  END IF;

  UPDATE api.workspace_settings
     SET ai_feature_flags = p_feature_flags,
         ai_updated_by_user_id = api.current_user_id(),
         updated_at = now()
   WHERE workspace_id = p_workspace_id
   RETURNING * INTO v_result;

  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'workspace settings not found' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$$;
--> statement-breakpoint
-- The audit log can be narrowed to one project.
DROP FUNCTION api.audit_events(text, text, text, timestamp with time zone, timestamp with time zone, text, uuid, bigint, integer);
--> statement-breakpoint
CREATE FUNCTION api.audit_events(p_entity_type text DEFAULT NULL::text, p_operation text DEFAULT NULL::text, p_actor_user_id text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_search text DEFAULT NULL::text, p_object uuid DEFAULT NULL::uuid, p_before_sequence bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 50, p_project_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_claims jsonb;
  v_workspace uuid;
  v_role text;
  v_privileged boolean;
  v_search_like text;
  v_limit integer;
BEGIN
  v_claims := api.claim_probe();
  IF v_claims IS NULL
     OR nullif(v_claims->>'sub', '') IS NULL
     OR nullif(v_claims->>'session_id', '') IS NULL
     OR v_claims->>'role' <> 'authenticated' THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;
  v_workspace := nullif(v_claims->>'workspace_id', '')::uuid;
  IF v_workspace IS NULL OR NOT api.is_workspace_member(v_workspace) THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;

  -- Suspended members lost their seat: fail closed entirely rather than
  -- serving the workspace-scoped subset.
  SELECT membership.role INTO v_role
    FROM api.workspace_memberships membership
   WHERE membership.workspace_id = v_workspace
     AND membership.user_id = api.current_user_id()
     AND membership.suspended_at IS NULL;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'audit denied' USING ERRCODE = '42501';
  END IF;
  v_privileged := v_role IN ('owner', 'admin', 'steward');

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  -- ILIKE wildcard escaping: backslash first, then escape % and _ each as
  -- themselves (\% and \_) so user input matches literally.
  v_search_like := '%' ||
    replace(replace(replace(btrim(COALESCE(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_') ||
    '%';

  RETURN (
    WITH matches AS MATERIALIZED (
      SELECT e.sequence AS seq,
             e.id AS event_id,
             e.created_at AS created_at,
             e.entity_type AS entity_type,
             e.entity_uuid AS entity_uuid,
             e.operation AS operation,
             e.record_id AS record_id,
             e.project_id AS project_id,
             e.actor_user_id AS actor_user_id,
             e.actor_credential_id AS actor_credential_id,
             e.client_id AS client_id,
             e.payload AS payload,
             actor.name AS actor_name
      FROM api.change_events e
      LEFT JOIN "internal"."user" actor ON actor.id = e.actor_user_id
      WHERE e.workspace_id = v_workspace AND internal.can_read_change_event(e)
        AND (p_entity_type IS NULL OR e.entity_type = p_entity_type)
        AND (p_operation IS NULL OR e.operation = p_operation)
        AND (p_actor_user_id IS NULL OR e.actor_user_id = p_actor_user_id)
        AND (p_project_id IS NULL OR e.project_id = p_project_id)
        AND (p_from IS NULL OR e.created_at >= p_from)
        AND (p_to IS NULL OR e.created_at < p_to)
        AND (p_before_sequence IS NULL OR e.sequence < p_before_sequence)
        -- Object-readability boundary. See the contract note in 0134: this
        -- implements each underlying object's canonical SELECT rule, which
        -- is workspace membership for every governed class, narrowed
        -- further for admin/security event classes.
        AND (
          v_privileged
          OR e.entity_type NOT IN (
            'api_credential', 'workspace_invitation', 'workspace_settings',
            'project_access'
          )
        )
        AND (
          btrim(COALESCE(p_search, '')) = ''
          OR e.payload::text ILIKE v_search_like
          OR e.entity_type ILIKE v_search_like
          OR e.operation ILIKE v_search_like
        )
        AND (
          p_object IS NULL
          OR e.entity_uuid = p_object
          OR e.record_id = p_object
          OR e.payload->>'datasetId' = p_object::text
          OR e.payload->>'templateId' = p_object::text
          OR e.payload->>'definitionId' = p_object::text
          OR e.payload->>'instanceId' = p_object::text
          OR e.payload->>'rotatedFromCredentialId' = p_object::text
          OR e.payload->>'rotatedToCredentialId' = p_object::text
          OR e.payload->>'extension_id' = p_object::text
          OR e.payload->>'extensionId' = p_object::text
        )
    ),
    page AS (
      SELECT * FROM matches ORDER BY seq DESC LIMIT v_limit
    )
    SELECT jsonb_build_object(
      'formatVersion', 1,
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'sequence', seq,
          'id', event_id,
          'createdAt', to_char(created_at AT TIME ZONE 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'entityType', entity_type,
          'entityUuid', entity_uuid,
          'operation', operation,
          'recordId', record_id,
          'projectId', project_id,
          'actorUserId', actor_user_id,
          'actorName', actor_name,
          'actorCredentialId', actor_credential_id,
          'clientId', client_id,
          'payload', payload
        ) ORDER BY seq DESC)
        FROM page
      ), '[]'::jsonb),
      'hasMore', EXISTS (SELECT 1 FROM matches OFFSET v_limit),
      'nextCursor', (SELECT MIN(seq) FROM page)
    )
  );
END;
$$;
--> statement-breakpoint
ALTER FUNCTION api.audit_events(p_entity_type text, p_operation text, p_actor_user_id text, p_from timestamp with time zone, p_to timestamp with time zone, p_search text, p_object uuid, p_before_sequence bigint, p_limit integer) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.audit_events(text, text, text, timestamp with time zone, timestamp with time zone, text, uuid, bigint, integer, uuid) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.audit_events(text, text, text, timestamp with time zone, timestamp with time zone, text, uuid, bigint, integer, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.audit_events(text, text, text, timestamp with time zone, timestamp with time zone, text, uuid, bigint, integer, uuid) TO authenticated;
