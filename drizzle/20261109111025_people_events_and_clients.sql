-- People and workspace for the API, webhooks and pipelines.
--
-- 1. Change events for what had none: membership changes, clients, client
--    sharing and portal messages, workspace name; settings changes now say
--    which settings changed (names only, never values) and have a producer of
--    their own so a pipeline can start on them.
-- 2. Client calls (create, rename, archive) so clients are not table writes only.

DO $$
DECLARE
  v_def text;
  v_type text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'api.change_events'::regclass
     AND conname = 'chk_change_events_entity_type';
  IF v_def IS NULL OR position('::text]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for chk_change_events_entity_type';
  END IF;
  FOREACH v_type IN ARRAY ARRAY['workspace_membership', 'workspace_setting', 'workspace', 'client', 'client_portal_share', 'client_portal_message'] LOOP
    IF position('''' || v_type || '''' IN v_def) = 0 THEN
      v_def := replace(v_def, '::text]', '::text, ''' || v_type || '''::text]');
    END IF;
  END LOOP;
  EXECUTE 'ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type';
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type ' || v_def;
END $$;
--> statement-breakpoint

-- Settings: a producer of its own, and the names of what changed.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('internal.trg_change_event_admin()'::regprocedure) INTO v_def;
  IF position('ELSIF v_entity=''workspace_settings'' THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.trg_change_event_admin';
  END IF;
  v_def := replace(v_def, 'ELSIF v_entity=''workspace_settings'' THEN', 'ELSIF v_entity IN (''workspace_settings'',''workspace_setting'') THEN');
  v_def := replace(v_def, '''integration_setting_keys'',v_integration_keys);',
    '''integration_setting_keys'',v_integration_keys,
      ''changedFields'',CASE WHEN TG_OP=''UPDATE'' THEN (SELECT COALESCE(jsonb_agg(k ORDER BY k),''[]''::jsonb) FROM jsonb_object_keys(v_row) k WHERE k NOT IN (''updated_at'',''updated_by_user_id'') AND v_row->k IS DISTINCT FROM to_jsonb(OLD)->k) END);');
  EXECUTE v_def;
END $$;
--> statement-breakpoint
DROP TRIGGER change_event_workspace_settings ON api.workspace_settings;
--> statement-breakpoint
CREATE TRIGGER change_event_workspace_settings AFTER INSERT OR UPDATE ON api.workspace_settings
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_admin('workspace_setting');
--> statement-breakpoint

-- People, clients and client sharing.
CREATE FUNCTION internal.trg_change_event_people() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  v_entity text := TG_ARGV[0];
  v_op text;
  v_payload jsonb;
  v_record uuid;
  v_project uuid;
BEGIN
  IF v_entity = 'workspace_membership' THEN
    IF TG_OP = 'INSERT' THEN v_op := 'create';
    ELSIF TG_OP = 'DELETE' THEN v_op := 'delete';
    ELSIF NEW.suspended_at IS NOT NULL AND OLD.suspended_at IS NULL THEN v_op := 'suspend';
    ELSIF NEW.suspended_at IS NULL AND OLD.suspended_at IS NOT NULL THEN v_op := 'restore';
    ELSIF NEW.role IS DISTINCT FROM OLD.role OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN v_op := 'update';
    ELSE RETURN NULL;
    END IF;
    v_payload := jsonb_build_object('userId', v_row->'user_id', 'role', v_row->'role',
      'roleSource', v_row->'role_source', 'clientId', v_row->'client_id');
    IF v_op = 'update' THEN v_payload := v_payload || jsonb_build_object('previousRole', to_jsonb(OLD)->'role'); END IF;
  ELSIF v_entity = 'client' THEN
    IF TG_OP = 'INSERT' THEN v_op := 'create';
    ELSIF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL THEN v_op := 'archive';
    ELSIF NEW.archived_at IS NULL AND OLD.archived_at IS NOT NULL THEN v_op := 'restore';
    ELSIF NEW.name IS DISTINCT FROM OLD.name THEN v_op := 'update';
    ELSE RETURN NULL;
    END IF;
    v_payload := jsonb_build_object('code', v_row->'code', 'name', v_row->'name');
  ELSIF v_entity = 'client_portal_share' THEN
    v_op := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'delete' END;
    v_record := (v_row->>'record_id')::uuid;
    v_project := (v_row->>'project_id')::uuid;
    v_payload := jsonb_build_object('clientId', v_row->'client_id', 'recordId', v_row->'record_id', 'projectId', v_row->'project_id');
  ELSIF v_entity = 'client_portal_message' THEN
    v_op := 'create';
    v_project := (v_row->>'project_id')::uuid;
    v_payload := jsonb_build_object('clientId', v_row->'client_id', 'projectId', v_row->'project_id', 'authorKind', v_row->'author_kind');
  ELSE
    IF TG_OP = 'INSERT' OR NEW.name IS NOT DISTINCT FROM OLD.name THEN RETURN NULL; END IF;
    v_op := 'update';
    v_payload := jsonb_build_object('name', v_row->'name');
  END IF;
  PERFORM internal.emit_change_event(
    (CASE WHEN v_entity = 'workspace' THEN v_row->>'id' ELSE v_row->>'workspace_id' END)::uuid, v_entity,
    COALESCE((v_row->>'id')::uuid, (v_row->>'workspace_id')::uuid), v_op, v_record, v_project, v_payload);
  RETURN NULL;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.trg_change_event_people() OWNER TO migrator;
--> statement-breakpoint
CREATE TRIGGER change_event_workspace_memberships AFTER INSERT OR UPDATE OR DELETE ON api.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_people('workspace_membership');
--> statement-breakpoint
CREATE TRIGGER change_event_clients AFTER INSERT OR UPDATE ON api.clients
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_people('client');
--> statement-breakpoint
CREATE TRIGGER change_event_client_portal_shares AFTER INSERT OR DELETE ON api.client_portal_shares
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_people('client_portal_share');
--> statement-breakpoint
CREATE TRIGGER change_event_client_portal_messages AFTER INSERT ON api.client_portal_messages
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_people('client_portal_message');
--> statement-breakpoint
CREATE TRIGGER change_event_workspaces AFTER UPDATE OF name ON api.workspaces
  FOR EACH ROW EXECUTE FUNCTION internal.trg_change_event_people('workspace');
--> statement-breakpoint

INSERT INTO internal.webhook_event_names (name) VALUES
  ('workspace.invitation.created'), ('workspace.invitation.updated'), ('workspace.invitation.deleted'),
  ('workspace.settings.created'), ('workspace.settings.updated'), ('workspace.settings_access.changed'),
  ('workspace.renamed'),
  ('project.access.granted'), ('project.access.updated'), ('project.access.revoked'),
  ('project.access.requested'), ('project.access.request_decided'),
  ('workspace.group.created'), ('workspace.group.deleted'),
  ('workspace.group.member_added'), ('workspace.group.member_removed'),
  ('member.joined'), ('member.role_changed'), ('member.suspended'), ('member.reinstated'), ('member.removed'),
  ('client.created'), ('client.updated'), ('client.archived'), ('client.restored'),
  ('client.record_shared'), ('client.record_unshared'), ('client.message_posted')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Events a pipeline can start on (those without a payload test).
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('api.normalize_pipeline_event_type(text)'::regprocedure) INTO v_def;
  IF position('''experiment.part_opened'',' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for api.normalize_pipeline_event_type';
  END IF;
  v_def := replace(v_def, '''experiment.part_opened'',',
    '''experiment.part_opened'', ''workspace.invitation.created'', ''workspace.invitation.updated'', ''workspace.invitation.deleted'', ''workspace.settings.updated'', ''workspace.renamed'', ''project.access.granted'', ''project.access.updated'', ''project.access.revoked'', ''project.access.requested'', ''project.access.request_decided'', ''workspace.group.created'', ''workspace.group.deleted'', ''workspace.group.member_added'', ''workspace.group.member_removed'', ''member.joined'', ''member.role_changed'', ''member.suspended'', ''member.reinstated'', ''member.removed'', ''client.created'', ''client.updated'', ''client.archived'', ''client.restored'', ''client.record_shared'', ''client.record_unshared'', ''client.message_posted'',');
  EXECUTE v_def;
END $$;
--> statement-breakpoint

-- Clients: the same rule the table policies had, as calls.
CREATE FUNCTION api.create_client(p_name text) RETURNS api.clients
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text := btrim(p_name);
  v api.clients;
BEGIN
  IF api.current_workspace_id() IS NULL OR NOT api.is_workspace_writer(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'client access required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A client name is 1 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.clients (workspace_id, name, created_by_user_id)
  VALUES (api.current_workspace_id(), v_name, api.current_user_id())
  RETURNING * INTO v;
  RETURN v;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.rename_client(p_client_id uuid, p_name text) RETURNS api.clients
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_name text := btrim(p_name);
  v api.clients;
BEGIN
  IF api.current_workspace_id() IS NULL OR NOT api.is_workspace_writer(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'client access required' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A client name is 1 to 200 characters.' USING ERRCODE = '22023';
  END IF;
  UPDATE api.clients SET name = v_name, updated_at = now()
   WHERE id = p_client_id AND workspace_id = api.current_workspace_id()
  RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION 'client not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
CREATE FUNCTION api.set_client_archived(p_client_id uuid, p_archived boolean) RETURNS api.clients
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v api.clients;
BEGIN
  IF api.current_workspace_id() IS NULL OR NOT api.is_workspace_writer(api.current_workspace_id()) THEN
    RAISE EXCEPTION 'client access required' USING ERRCODE = '42501';
  END IF;
  UPDATE api.clients
     SET archived_at = CASE WHEN p_archived THEN COALESCE(archived_at, now()) ELSE NULL END, updated_at = now()
   WHERE id = p_client_id AND workspace_id = api.current_workspace_id()
  RETURNING * INTO v;
  IF v.id IS NULL THEN RAISE EXCEPTION 'client not found' USING ERRCODE = 'P0002'; END IF;
  RETURN v;
END $$;
--> statement-breakpoint
ALTER FUNCTION api.create_client(text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.rename_client(uuid, text) OWNER TO migrator;
--> statement-breakpoint
ALTER FUNCTION api.set_client_archived(uuid, boolean) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.create_client(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.rename_client(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.set_client_archived(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.create_client(text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.rename_client(uuid, text) TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.set_client_archived(uuid, boolean) TO authenticated;

-- The database's own catalogue of pipeline actions (the run checks a saved
-- pipeline against it) learns the people and workspace actions.
DO $$
DECLARE
  v_def text;
  v_added text := $added$,{"operation":"revoke_user_session","rpc":"revoke_user_session","label":"Sign a session out","description":"Ends one open session of a member of this workspace. Needs members access.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_session_id","type":"text","required":true,"nullable":false}]},{"operation":"change_member_role","rpc":"change_member_role","label":"Change a member’s role","description":"Gives a member a new role. A client viewer needs a client; no one else may have one. Only an admin changes an owner, you cannot change your own role and the last owner cannot be demoted. Needs members access. Returns the membership. Sends `member.role_changed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_new_role","type":"text","required":true,"nullable":false},{"name":"p_client_id","type":"uuid","required":false,"nullable":true}]},{"operation":"suspend_member","rpc":"suspend_member","label":"Suspend a member","description":"Switches a member off without removing them or their work. Not yourself, and not the last owner. Needs members access. Sends `member.suspended`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"reinstate_member","rpc":"reinstate_member","label":"Reinstate a member","description":"Lifts a suspension. Needs members access. Sends `member.reinstated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"remove_member","rpc":"remove_member","label":"Remove a member","description":"Takes a person out of the workspace. Their work stays. Not yourself, and not the last owner. Needs members access. Sends `member.removed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"set_member_username","rpc":"set_member_username","label":"Set a member’s username","description":"A username is 3 to 40 letters, numbers, dots, dashes or underscores, and unique in the workspace. Leave it out to clear it. Needs members access. Returns the membership.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_username","type":"text","required":true,"nullable":true}]},{"operation":"create_invitation","rpc":"create_invitation","label":"Invite someone","description":"Makes an invitation for an email address with a role, optionally for a client (client viewers) and with projects the person joins on accepting: `[{ \"project_id\": \"…\", \"access_level\": \"viewer\" }]`. Returns the invitation and its one-time `token`; the link is `/accept-invitation?token=<token>`. The token is shown once and never stored, so keep it or reissue. Needs members access. Sends `workspace.invitation.created`. In a pipeline the token is left out of the step output.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_email","type":"text","required":true,"nullable":false},{"name":"p_role","type":"text","required":false,"nullable":false},{"name":"p_expires_after_days","type":"integer","required":false,"nullable":false},{"name":"p_client_id","type":"uuid","required":false,"nullable":true},{"name":"p_project_grants","type":"jsonb","required":false,"nullable":false}]},{"operation":"reissue_invitation","rpc":"reissue_invitation","label":"Send an invitation again","description":"Replaces the link of a pending or expired invitation; the old link stops working. Returns the invitation and its new one-time `token`. Needs members access. In a pipeline the token is left out of the step output.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_invitation_id","type":"uuid","required":true,"nullable":false},{"name":"p_expires_after_days","type":"integer","required":false,"nullable":false}]},{"operation":"revoke_invitation","rpc":"revoke_invitation","label":"Withdraw an invitation","description":"Stops a pending invitation being accepted. Needs members access. Returns the invitation.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_invitation_id","type":"uuid","required":true,"nullable":false}]},{"operation":"set_project_access_defaults","rpc":"set_project_access_defaults","label":"Set the project access defaults","description":"Names the group whose members can view every project (null for none). Needs access to manage project settings.","arguments":[{"name":"p_qa_view_group_id","type":"uuid","required":true,"nullable":true}]},{"operation":"grant_project_access","rpc":"grant_project_access","label":"Give someone access to a project","description":"Adds a person to a project at an access level, with an optional project role (`lead`, `scientist`, `default_reviewer` or `oversight`). Needs to be project lead or an admin. Returns the access rule. Sends `project.access.granted` or `project.access.updated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_access_level","type":"text","required":false,"nullable":false},{"name":"p_project_role","type":"text","required":false,"nullable":true}]},{"operation":"revoke_project_access","rpc":"revoke_project_access","label":"Take someone off a project","description":"Removes a person’s access rule from a project. Needs to be project lead or an admin. Sends `project.access.revoked`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"set_project_member","rpc":"set_project_member","label":"Set a person’s access level on a project","description":"Gives a person one access level on a project, replacing what they had. Returns the access rule.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_access_level","type":"text","required":true,"nullable":false}]},{"operation":"remove_project_member","rpc":"remove_project_member","label":"Remove a person from a project","description":"Removes every access rule a person has on the project.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false}]},{"operation":"set_project_access_rule","rpc":"set_project_access_rule","label":"Set a project access rule","description":"Gives a person (`p_user_id`) or a group (`p_group_id`) exactly the permissions named. Needs to be project lead or an admin. Returns the access rule.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":false,"nullable":true},{"name":"p_group_id","type":"uuid","required":false,"nullable":true},{"name":"p_can_view","type":"boolean","required":true,"nullable":false},{"name":"p_can_edit","type":"boolean","required":true,"nullable":false},{"name":"p_can_review","type":"boolean","required":true,"nullable":false},{"name":"p_client_portal","type":"boolean","required":true,"nullable":false},{"name":"p_can_manage","type":"boolean","required":true,"nullable":false}]},{"operation":"remove_project_access_rule","rpc":"remove_project_access_rule","label":"Remove a project access rule","description":"Removes one rule by its id.","arguments":[{"name":"p_rule_id","type":"uuid","required":true,"nullable":false}]},{"operation":"update_project_settings","rpc":"update_project_settings","label":"Change a project’s rules","description":"Whether the project needs an effective protocol, an independent reviewer, and shares approved work with its client automatically. Leave out what stays. Returns the project.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_require_effective_protocol","type":"boolean","required":false,"nullable":true},{"name":"p_require_independent_reviewer","type":"boolean","required":false,"nullable":true},{"name":"p_auto_share_to_client","type":"boolean","required":false,"nullable":true}]},{"operation":"request_project_edit_access","rpc":"request_project_edit_access","label":"Ask for edit access to a project","description":"Asks the project’s leads for edit access, with a reason. Returns the request. Sends `project.access.requested`.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_reason","type":"text","required":true,"nullable":false}]},{"operation":"decide_project_access_request","rpc":"decide_project_access_request","label":"Decide a request for edit access","description":"Approving gives the person edit access. Needs to be project lead or an admin. Sends `project.access.request_decided`.","arguments":[{"name":"p_request_id","type":"uuid","required":true,"nullable":false},{"name":"p_approve","type":"boolean","required":true,"nullable":false}]},{"operation":"create_workspace_group","rpc":"create_workspace_group","label":"Make a group","description":"Makes an empty group, which can then be given access to projects. Needs members access. Returns the group. Sends `workspace.group.created`.","arguments":[{"name":"p_name","type":"text","required":true,"nullable":false}]},{"operation":"delete_workspace_group","rpc":"delete_workspace_group","label":"Delete a group","description":"Deletes the group and the access rules that named it. Needs members access. Sends `workspace.group.deleted`.","arguments":[{"name":"p_group_id","type":"uuid","required":true,"nullable":false}]},{"operation":"set_workspace_group_member","rpc":"set_workspace_group_member","label":"Add or remove a group member","description":"Needs members access. Sends `workspace.group.member_added` or `workspace.group.member_removed`.","arguments":[{"name":"p_group_id","type":"uuid","required":true,"nullable":false},{"name":"p_user_id","type":"text","required":true,"nullable":false},{"name":"p_is_member","type":"boolean","required":true,"nullable":false}]},{"operation":"update_workspace_name","rpc":"update_workspace_name","label":"Rename the workspace","description":"Needs access to manage General settings. Returns the workspace. Sends `workspace.renamed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false}]},{"operation":"update_workspace_general","rpc":"update_workspace_general","label":"Change the general settings","description":"Site, time zone, date format and number format; leave out what stays. Needs access to manage General settings. Returns the settings. Sends `workspace.settings.updated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_site","type":"text","required":false,"nullable":true},{"name":"p_timezone","type":"text","required":false,"nullable":true},{"name":"p_date_format","type":"text","required":false,"nullable":true},{"name":"p_number_format","type":"text","required":false,"nullable":true}]},{"operation":"update_workspace_settings","rpc":"update_workspace_settings","label":"Change the workspace rules","description":"Registration mode, the review workflow, the signature policy, audit retention, editing rules and integration settings; leave out what stays. Needs the matching settings access. Returns the settings. Sends `workspace.settings.updated`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_registration_mode","type":"text","required":false,"nullable":true},{"name":"p_review_workflow_enabled","type":"boolean","required":false,"nullable":true},{"name":"p_review_workflow_config","type":"jsonb","required":false,"nullable":true},{"name":"p_signature_policy","type":"jsonb","required":false,"nullable":true},{"name":"p_audit_retention_days","type":"integer","required":false,"nullable":true},{"name":"p_integration_settings","type":"jsonb","required":false,"nullable":true},{"name":"p_require_change_reason","type":"boolean","required":false,"nullable":true},{"name":"p_lock_on_sign","type":"boolean","required":false,"nullable":true},{"name":"p_allow_offline_editing","type":"boolean","required":false,"nullable":true}]},{"operation":"update_workspace_id_prefixes","rpc":"update_workspace_id_prefixes","label":"Change the identifier prefixes","description":"A JSON object of kind to prefix, such as `{ \"experiment\": \"EXP\" }`. Needs General settings access. Returns the settings.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_prefixes","type":"jsonb","required":true,"nullable":false}]},{"operation":"update_workspace_publication_policy","rpc":"update_workspace_publication_policy","label":"Require approval to publish","description":"Returns the settings.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_required","type":"boolean","required":true,"nullable":false}]},{"operation":"update_workspace_data_access_roles","rpc":"update_workspace_data_access_roles","label":"Choose who has data access","description":"The roles that see keys, API routes and database names and can make a read-only SQL login (never `client_viewer`). Returns the settings.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_roles","type":"text[]","required":true,"nullable":false}]},{"operation":"update_workspace_ai_settings","rpc":"update_workspace_ai_settings","label":"Change the AI settings","description":"Switch AI on or off, the provider profile and model, whether prompts may leave the install, and the limits per call. Needs AI settings access. Returns the settings.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_enabled","type":"boolean","required":true,"nullable":false},{"name":"p_provider_profile","type":"text","required":true,"nullable":true},{"name":"p_model","type":"text","required":true,"nullable":false},{"name":"p_cloud_egress_enabled","type":"boolean","required":true,"nullable":false},{"name":"p_max_tokens","type":"integer","required":true,"nullable":false},{"name":"p_max_cost","type":"integer","required":true,"nullable":false}]},{"operation":"update_workspace_ai_feature_flags","rpc":"update_workspace_ai_feature_flags","label":"Change what agents may use","description":"A JSON object of switches: `assistant`, `mcp_read`, `mcp_draft`, `mcp_workflow`, `mcp_admin_read`, `mcp_admin_propose`, `mcp_lab`. Needs AI settings access. Returns the settings.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_feature_flags","type":"jsonb","required":true,"nullable":false}]},{"operation":"set_settings_access","rpc":"set_settings_access","label":"Set who can open a settings area","description":"The level (`none`, `view` or `manage`) a role has in one settings area. Needs a workspace admin. Returns the rule. Sends `workspace.settings_access.changed`.","arguments":[{"name":"p_workspace_id","type":"uuid","required":true,"nullable":false},{"name":"p_area","type":"text","required":true,"nullable":false},{"name":"p_role","type":"text","required":true,"nullable":false},{"name":"p_level","type":"text","required":true,"nullable":false}]},{"operation":"create_client","rpc":"create_client","label":"Add a client","description":"The code (CL-001 and so on) is made for you. Needs to be able to write in the workspace. Returns the client. Sends `client.created`.","arguments":[{"name":"p_name","type":"text","required":true,"nullable":false}]},{"operation":"rename_client","rpc":"rename_client","label":"Rename a client","description":"Returns the client. Sends `client.updated`.","arguments":[{"name":"p_client_id","type":"uuid","required":true,"nullable":false},{"name":"p_name","type":"text","required":true,"nullable":false}]},{"operation":"set_client_archived","rpc":"set_client_archived","label":"Archive or restore a client","description":"Returns the client. Sends `client.archived` or `client.restored`.","arguments":[{"name":"p_client_id","type":"uuid","required":true,"nullable":false},{"name":"p_archived","type":"boolean","required":true,"nullable":false}]},{"operation":"share_record_with_client","rpc":"share_record_with_client","label":"Share a record with a client","description":"Shows an approved record in the client’s portal. Returns the share. Sends `client.record_shared`.","arguments":[{"name":"p_client_id","type":"uuid","required":true,"nullable":false},{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]},{"operation":"unshare_record_with_client","rpc":"unshare_record_with_client","label":"Stop sharing a record with a client","description":"Sends `client.record_unshared`.","arguments":[{"name":"p_client_id","type":"uuid","required":true,"nullable":false},{"name":"p_record_id","type":"uuid","required":true,"nullable":false}]},{"operation":"post_client_portal_message","rpc":"post_client_portal_message","label":"Message a client","description":"Posts to the client (optionally about one project). A client viewer posts in their own portal. Returns the message. Sends `client.message_posted`.","arguments":[{"name":"p_client_id","type":"uuid","required":true,"nullable":false},{"name":"p_project_id","type":"uuid","required":false,"nullable":true},{"name":"p_body","type":"text","required":false,"nullable":true}]},{"operation":"set_study_task_client_visible","rpc":"set_study_task_client_visible","label":"Show a study task to the client","description":"Returns the task.","arguments":[{"name":"p_task_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_client_visible","type":"boolean","required":true,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":true}]}$added$;
BEGIN
  SELECT pg_get_functiondef('internal.pipeline_action_errors(jsonb)'::regprocedure) INTO v_def;
  IF position(']$catalogue$::jsonb' IN v_def) = 0 THEN
    RAISE EXCEPTION 'unexpected shape for internal.pipeline_action_errors';
  END IF;
  v_def := replace(v_def, ']$catalogue$::jsonb', v_added || ']$catalogue$::jsonb');
  EXECUTE v_def;
END $$;
