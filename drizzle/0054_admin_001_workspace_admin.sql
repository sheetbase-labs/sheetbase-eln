-- ADMIN-001: workspace permissions and administration.

ALTER TABLE api.workspace_memberships ADD COLUMN suspended_at timestamptz;
--> statement-breakpoint
CREATE INDEX idx_workspace_memberships_suspended_at ON api.workspace_memberships(suspended_at);
--> statement-breakpoint
ALTER TABLE api.workspace_memberships DROP CONSTRAINT chk_workspace_memberships_role;
--> statement-breakpoint
ALTER TABLE api.workspace_memberships ADD CONSTRAINT chk_workspace_memberships_role CHECK(role IN ('owner','admin','member','scientist','analyst','reviewer','viewer'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.is_workspace_member(p_workspace_id uuid, p_role text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id
      AND m.user_id=api.current_user_id()
      AND m.suspended_at IS NULL
      AND (p_role IS NULL OR m.role=p_role)
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.is_workspace_member(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.is_workspace_member(uuid,text) TO authenticated;
--> statement-breakpoint

CREATE TABLE api.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by_user_id text REFERENCES internal."user"(id) ON DELETE set null,
  revoked_at timestamptz,
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('pending','accepted','revoked','expired')),
  CHECK (role IN ('owner','admin','member','scientist','analyst','reviewer','viewer')),
  CHECK (email ~ '^[^@]+@[^@]+\.[^@]+$')
);
--> statement-breakpoint
CREATE INDEX idx_workspace_invitations_workspace ON api.workspace_invitations(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_workspace_invitations_email ON api.workspace_invitations(email);
--> statement-breakpoint
CREATE INDEX idx_workspace_invitations_status ON api.workspace_invitations(status);
--> statement-breakpoint

CREATE TABLE api.workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES api.workspaces(id) ON DELETE cascade,
  registration_mode text NOT NULL DEFAULT 'open',
  review_workflow_enabled boolean NOT NULL DEFAULT false,
  review_workflow_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  audit_retention_days integer NOT NULL DEFAULT 2555,
  integration_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (registration_mode IN ('open','invitation_only')),
  CHECK (audit_retention_days > 0)
);
--> statement-breakpoint

CREATE TABLE api.project_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES api.workspaces(id) ON DELETE cascade,
  project_id uuid NOT NULL REFERENCES api.projects(id) ON DELETE cascade,
  user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE cascade,
  access_level text NOT NULL DEFAULT 'viewer',
  granted_by_user_id text NOT NULL REFERENCES internal."user"(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,project_id,user_id),
  CHECK (access_level IN ('owner','editor','viewer'))
);
--> statement-breakpoint
CREATE INDEX idx_project_access_workspace ON api.project_access(workspace_id);
--> statement-breakpoint
CREATE INDEX idx_project_access_project ON api.project_access(project_id);
--> statement-breakpoint
CREATE INDEX idx_project_access_user ON api.project_access(user_id);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON api.workspace_invitations TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON api.workspace_settings TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON api.project_access TO authenticated;
--> statement-breakpoint
GRANT SELECT ON api.workspace_settings, api.project_access TO api_client;
--> statement-breakpoint
ALTER TABLE api.workspace_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.workspace_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api.project_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_invitations_select ON api.workspace_invitations FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_invitations_insert ON api.workspace_invitations FOR INSERT TO authenticated WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_invitations_update ON api.workspace_invitations FOR UPDATE TO authenticated USING (api.is_workspace_member(workspace_id,'owner')) WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_invitations_delete ON api.workspace_invitations FOR DELETE TO authenticated USING (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_settings_select ON api.workspace_settings FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY workspace_settings_insert ON api.workspace_settings FOR INSERT TO authenticated WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_settings_update ON api.workspace_settings FOR UPDATE TO authenticated USING (api.is_workspace_member(workspace_id,'owner')) WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY workspace_settings_client_select ON api.workspace_settings FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint
CREATE POLICY project_access_select ON api.project_access FOR SELECT TO authenticated USING (api.storage_member_using(workspace_id));
--> statement-breakpoint
CREATE POLICY project_access_insert ON api.project_access FOR INSERT TO authenticated WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY project_access_update ON api.project_access FOR UPDATE TO authenticated USING (api.is_workspace_member(workspace_id,'owner')) WITH CHECK (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY project_access_delete ON api.project_access FOR DELETE TO authenticated USING (api.is_workspace_member(workspace_id,'owner'));
--> statement-breakpoint
CREATE POLICY project_access_client_select ON api.project_access FOR SELECT TO api_client USING (workspace_id=api.current_workspace_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_invitation(p_workspace_id uuid,p_email text,p_role text DEFAULT 'member',p_expires_after_days integer DEFAULT 7) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations; v_token text:=gen_random_uuid()::text;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.is_workspace_member(p_workspace_id,'owner') THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061'; END IF;
  IF p_email IS NULL OR btrim(p_email) !~ '^[^@]+@[^@]+\.[^@]+$' OR p_role NOT IN ('owner','admin','member','scientist','analyst','reviewer','viewer') OR p_expires_after_days IS NULL OR p_expires_after_days <= 0 THEN RAISE EXCEPTION 'invalid invitation' USING ERRCODE='SB061'; END IF;
  INSERT INTO api.workspace_invitations(workspace_id,email,role,token_hash,expires_at,created_by_user_id)
  VALUES(p_workspace_id,lower(btrim(p_email)),p_role,encode(sha256(convert_to(v_token,'UTF8')),'hex'),now()+make_interval(days=>p_expires_after_days),api.current_user_id()) RETURNING * INTO v;
  RETURN to_jsonb(v)-'token_hash'||jsonb_build_object('token',v_token);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.create_invitation(uuid,text,text,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_invitation(uuid,text,text,integer) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.revoke_invitation(p_workspace_id uuid,p_invitation_id uuid) RETURNS api.workspace_invitations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id OR NOT api.is_workspace_member(p_workspace_id,'owner') THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB061'; END IF;
  UPDATE api.workspace_invitations SET status='revoked',revoked_at=now(),updated_at=now() WHERE id=p_invitation_id AND workspace_id=p_workspace_id AND status='pending' RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'pending invitation not found' USING ERRCODE='SB061'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.revoke_invitation(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.revoke_invitation(uuid,uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.accept_invitation(p_token text,p_user_id text) RETURNS api.workspace_invitations
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_invitations;
BEGIN
  IF p_user_id IS DISTINCT FROM api.current_user_id() THEN RAISE EXCEPTION 'user identity mismatch' USING ERRCODE='SB062'; END IF;
  SELECT * INTO v FROM api.workspace_invitations WHERE token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') FOR UPDATE;
  IF v IS NULL OR v.status <> 'pending' THEN RAISE EXCEPTION 'invitation is not pending' USING ERRCODE='SB061'; END IF;
  IF v.expires_at <= now() THEN UPDATE api.workspace_invitations SET status='expired',updated_at=now() WHERE id=v.id; RAISE EXCEPTION 'invitation expired' USING ERRCODE='SB061'; END IF;
  INSERT INTO api.workspace_memberships(workspace_id,user_id,role) VALUES(v.workspace_id,p_user_id,v.role)
    ON CONFLICT (workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role,suspended_at=NULL,updated_at=now();
  UPDATE api.workspace_invitations SET status='accepted',accepted_at=now(),accepted_by_user_id=p_user_id,updated_at=now() WHERE id=v.id RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.accept_invitation(text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.accept_invitation(text,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.change_member_role(p_workspace_id uuid,p_user_id text,p_new_role text) RETURNS api.workspace_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  IF p_new_role NOT IN ('owner','admin','member','scientist','analyst','reviewer','viewer') THEN RAISE EXCEPTION 'invalid role' USING ERRCODE='SB053'; END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot change own role' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND p_new_role<>'owner' AND (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN RAISE EXCEPTION 'cannot demote last owner' USING ERRCODE='SB051'; END IF;
  UPDATE api.workspace_memberships SET role=p_new_role,updated_at=now() WHERE id=v.id RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.change_member_role(uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.change_member_role(uuid,text,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.remove_member(p_workspace_id uuid,p_user_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot remove self' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN RAISE EXCEPTION 'cannot remove last owner' USING ERRCODE='SB051'; END IF;
  DELETE FROM api.workspace_memberships WHERE id=v.id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.remove_member(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.remove_member(uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.suspend_member(p_workspace_id uuid,p_user_id text) RETURNS api.workspace_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  IF p_user_id=api.current_user_id() THEN RAISE EXCEPTION 'cannot suspend self' USING ERRCODE='SB050'; END IF;
  SELECT * INTO v FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=p_user_id FOR UPDATE;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF;
  IF v.role='owner' AND v.suspended_at IS NULL AND (SELECT count(*) FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND role='owner' AND suspended_at IS NULL)=1 THEN RAISE EXCEPTION 'cannot suspend last owner' USING ERRCODE='SB051'; END IF;
  UPDATE api.workspace_memberships SET suspended_at=now(),updated_at=now() WHERE id=v.id RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.suspend_member(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.suspend_member(uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.reinstate_member(p_workspace_id uuid,p_user_id text) RETURNS api.workspace_memberships
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_memberships;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB052'; END IF;
  UPDATE api.workspace_memberships SET suspended_at=NULL,updated_at=now() WHERE workspace_id=p_workspace_id AND user_id=p_user_id RETURNING * INTO v;
  IF v IS NULL THEN RAISE EXCEPTION 'member not found' USING ERRCODE='SB052'; END IF; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.reinstate_member(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.reinstate_member(uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.list_workspace_sessions(p_workspace_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB055'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'user_id',s."userId",'user_name',u.name,'ip_address',s."ipAddress",'user_agent',s."userAgent",'created_at',s."createdAt",'expires_at',s."expiresAt") ORDER BY s."createdAt" DESC),'[]'::jsonb)
    FROM internal.session s JOIN api.workspace_memberships m ON m.user_id=s."userId" AND m.workspace_id=p_workspace_id JOIN internal."user" u ON u.id=s."userId");
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.list_workspace_sessions(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.list_workspace_sessions(uuid) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.revoke_user_session(p_workspace_id uuid,p_session_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_user text;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB055'; END IF;
  SELECT "userId" INTO v_user FROM internal.session WHERE id=p_session_id;
  IF v_user IS NULL THEN RAISE EXCEPTION 'session not found' USING ERRCODE='SB054'; END IF;
  IF NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=p_workspace_id AND user_id=v_user) THEN RAISE EXCEPTION 'session belongs to different workspace' USING ERRCODE='SB055'; END IF;
  DELETE FROM internal.session WHERE id=p_session_id; RETURN jsonb_build_object('success',true,'session_id',p_session_id);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.revoke_user_session(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.revoke_user_session(uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.update_workspace_settings(p_workspace_id uuid,p_registration_mode text DEFAULT NULL,p_review_workflow_enabled boolean DEFAULT NULL,p_review_workflow_config jsonb DEFAULT NULL,p_signature_policy jsonb DEFAULT NULL,p_audit_retention_days integer DEFAULT NULL,p_integration_settings jsonb DEFAULT NULL) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB056'; END IF;
  IF p_registration_mode IS NOT NULL AND p_registration_mode NOT IN ('open','invitation_only') THEN RAISE EXCEPTION 'invalid registration mode' USING ERRCODE='SB056'; END IF;
  IF p_audit_retention_days IS NOT NULL AND p_audit_retention_days<=0 THEN RAISE EXCEPTION 'invalid retention days' USING ERRCODE='SB057'; END IF;
  INSERT INTO api.workspace_settings(workspace_id,registration_mode,review_workflow_enabled,review_workflow_config,signature_policy,audit_retention_days,integration_settings,created_by_user_id)
  VALUES(p_workspace_id,COALESCE(p_registration_mode,'open'),COALESCE(p_review_workflow_enabled,false),COALESCE(p_review_workflow_config,'{}'),COALESCE(p_signature_policy,'{}'),COALESCE(p_audit_retention_days,2555),COALESCE(p_integration_settings,'{}'),api.current_user_id())
  ON CONFLICT (workspace_id) DO UPDATE SET registration_mode=COALESCE(p_registration_mode,api.workspace_settings.registration_mode),review_workflow_enabled=COALESCE(p_review_workflow_enabled,api.workspace_settings.review_workflow_enabled),review_workflow_config=COALESCE(p_review_workflow_config,api.workspace_settings.review_workflow_config),signature_policy=COALESCE(p_signature_policy,api.workspace_settings.signature_policy),audit_retention_days=COALESCE(p_audit_retention_days,api.workspace_settings.audit_retention_days),integration_settings=COALESCE(p_integration_settings,api.workspace_settings.integration_settings),updated_at=now() RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.update_workspace_settings(uuid,text,boolean,jsonb,jsonb,integer,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_workspace_settings(uuid,text,boolean,jsonb,jsonb,integer,jsonb) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.grant_project_access(p_workspace_id uuid,p_project_id uuid,p_user_id text,p_access_level text DEFAULT 'viewer') RETURNS api.project_access
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v api.project_access;
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB059'; END IF;
  IF p_access_level NOT IN ('owner','editor','viewer') THEN RAISE EXCEPTION 'invalid access level' USING ERRCODE='SB058'; END IF;
  IF NOT EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=p_workspace_id) THEN RAISE EXCEPTION 'project not found' USING ERRCODE='SB059'; END IF;
  INSERT INTO api.project_access(workspace_id,project_id,user_id,access_level,granted_by_user_id) VALUES(p_workspace_id,p_project_id,p_user_id,p_access_level,api.current_user_id())
  ON CONFLICT (workspace_id,project_id,user_id) DO UPDATE SET access_level=EXCLUDED.access_level,granted_by_user_id=EXCLUDED.granted_by_user_id,updated_at=now() RETURNING * INTO v; RETURN v;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.grant_project_access(uuid,uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.grant_project_access(uuid,uuid,text,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.revoke_project_access(p_workspace_id uuid,p_project_id uuid,p_user_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB059'; END IF;
  DELETE FROM api.project_access WHERE workspace_id=p_workspace_id AND project_id=p_project_id AND user_id=p_user_id;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.revoke_project_access(uuid,uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.revoke_project_access(uuid,uuid,text) TO authenticated;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.export_audit_log(p_workspace_id uuid,p_from_date timestamptz DEFAULT NULL,p_to_date timestamptz DEFAULT NULL,p_limit integer DEFAULT 1000) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT api.is_workspace_member(p_workspace_id,'owner') OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN RAISE EXCEPTION 'owner access required' USING ERRCODE='SB060'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>5000 THEN RAISE EXCEPTION 'limit exceeds maximum' USING ERRCODE='SB060'; END IF;
  RETURN (SELECT COALESCE(jsonb_agg(to_jsonb(e)-'payload'||jsonb_build_object('payload',e.payload-'token'-'token_hash'-'session_secret'-'sessionSecret'-'ip_address'-'ipAddress') ORDER BY e.sequence),'[]'::jsonb)
    FROM (SELECT * FROM api.change_events WHERE workspace_id=p_workspace_id AND (p_from_date IS NULL OR created_at>=p_from_date) AND (p_to_date IS NULL OR created_at<=p_to_date) ORDER BY sequence LIMIT p_limit) e);
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.export_audit_log(uuid,timestamptz,timestamptz,integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.export_audit_log(uuid,timestamptz,timestamptz,integer) TO authenticated;
--> statement-breakpoint

ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK(entity_type IN (
 'project','folder','record','block','record_link','scientific_table','scientific_row','formula','calculation','record_field_definition','file','dataset_schema','dataset_schema_field','dataset_schema_relationship','sample_event','comment','review_submission','signature','storage_site','storage_room','storage_unit','storage_shelf','storage_rack','storage_box','storage_position','storage_movement','plate_design','plate_well','plate_layout_template','calendar_resource','calendar_booking','calendar_booking_participant','calendar_booking_sample','study_workstream','study_task','study_task_dependency','study_task_assignment','study_task_resource','study_deliverable','instrument','instrument_run','instrument_run_stage','instrument_observation','instrument_plate_snapshot','instrument_qc_check','instrument_raw_file','instrument_run_link','report_definition','report_section','report_generation','workspace_invitation','workspace_settings','project_access'));
--> statement-breakpoint
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_operation;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_operation CHECK(operation IN ('create','update','move','delete','archive','restore','link','unlink','suspend','revoke'));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.trg_change_event_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row jsonb; v_payload jsonb; v_entity text:=TG_ARGV[0]; v_op text; v_integration_keys jsonb;
BEGIN
  v_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_op:=CASE WHEN TG_OP='INSERT' THEN 'create' WHEN TG_OP='DELETE' THEN 'delete' ELSE 'update' END;
  IF v_entity='workspace_invitation' THEN v_payload:=jsonb_build_object('id',v_row->'id','email',v_row->'email','role',v_row->'role','status',v_row->'status','expires_at',v_row->'expires_at');
  ELSIF v_entity='workspace_settings' THEN
    SELECT COALESCE(jsonb_agg(k ORDER BY k),'[]'::jsonb) INTO v_integration_keys FROM jsonb_object_keys(COALESCE(v_row->'integration_settings','{}'::jsonb)) k;
    v_payload:=jsonb_build_object('registration_mode',v_row->'registration_mode','review_workflow_enabled',v_row->'review_workflow_enabled','review_workflow_config',v_row->'review_workflow_config','signature_policy',v_row->'signature_policy','audit_retention_days',v_row->'audit_retention_days','integration_setting_keys',v_integration_keys);
  ELSE v_payload:=jsonb_build_object('id',v_row->'id','project_id',v_row->'project_id','user_id',v_row->'user_id','access_level',v_row->'access_level'); END IF;
  PERFORM internal.emit_change_event((v_row->>'workspace_id')::uuid,v_entity,(v_row->>'id')::uuid,v_op,NULL,CASE WHEN v_entity='project_access' THEN (v_row->>'project_id')::uuid ELSE NULL END,v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.trg_change_event_admin() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER change_event_workspace_invitations AFTER INSERT OR UPDATE OR DELETE ON api.workspace_invitations FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_admin('workspace_invitation');
--> statement-breakpoint
CREATE TRIGGER change_event_workspace_settings AFTER INSERT OR UPDATE ON api.workspace_settings FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_admin('workspace_settings');
--> statement-breakpoint
CREATE TRIGGER change_event_project_access AFTER INSERT OR UPDATE OR DELETE ON api.project_access FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_admin('project_access');
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
--> statement-breakpoint
