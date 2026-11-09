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
  PERFORM internal.emit_change_event((v_row->>'workspace_id')::uuid, v_entity,
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
