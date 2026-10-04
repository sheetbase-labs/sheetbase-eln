-- SET-02 / ADR0050. Only explicit rules grant project authority. Preserve
-- existing explicit grants, not the former workspace-wide read bypass.
UPDATE api.project_access SET
  can_view=true, can_edit=access_level IN ('owner','editor'),
  can_review=access_level='owner', can_manage=access_level='owner';
--> statement-breakpoint
INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,access_level,granted_by_user_id)
SELECT p.workspace_id,p.id,p.lead_user_id,true,true,true,true,'owner',p.lead_user_id
FROM api.projects p JOIN api.workspace_memberships m
  ON m.workspace_id=p.workspace_id AND m.user_id=p.lead_user_id
WHERE m.suspended_at IS NULL AND m.role<>'client_viewer'
ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET can_view=true,can_edit=true,can_review=true,can_manage=true;
--> statement-breakpoint

CREATE FUNCTION internal.project_permissions_for(p_project_id uuid,p_user_id text)
RETURNS TABLE(can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT
    coalesce(bool_or(a.can_view OR a.can_edit OR a.can_review OR a.can_manage) FILTER(WHERE m.role<>'client_viewer'),false),
    coalesce(bool_or(a.can_edit) FILTER(WHERE m.role IN ('owner','admin','member','steward','scientist','analyst','reviewer')),false),
    coalesce(bool_or(a.can_review) FILTER(WHERE m.role IN ('owner','admin','member','steward','scientist','analyst','reviewer')),false),
    coalesce(bool_or(a.client_portal) FILTER(WHERE m.role='client_viewer' AND m.client_id=p.client_id),false),
    coalesce(bool_or(a.can_manage) FILTER(WHERE m.role IN ('owner','admin','member','steward','scientist','analyst','reviewer')),false)
  FROM api.projects p
  JOIN api.workspace_memberships m ON m.workspace_id=p.workspace_id AND m.user_id=p_user_id AND m.suspended_at IS NULL
  JOIN api.project_access a ON a.workspace_id=p.workspace_id AND a.project_id=p.id AND
    (a.user_id=m.user_id OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g
      WHERE g.workspace_id=p.workspace_id AND g.group_id=a.group_id AND g.user_id=m.user_id))
  WHERE p.id=p_project_id
$$;
REVOKE ALL ON FUNCTION internal.project_permissions_for(uuid,text) FROM PUBLIC,authenticated,api_client;
GRANT EXECUTE ON FUNCTION internal.project_permissions_for(uuid,text) TO service_role;
--> statement-breakpoint

CREATE FUNCTION internal.can_view_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT can_view AND coalesce(api.claim_probe()->>'role'='authenticated',false) AND EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=api.current_workspace_id()) FROM internal.project_permissions_for(p_project_id,api.current_user_id())
$$;
CREATE OR REPLACE FUNCTION internal.can_edit_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT can_edit AND coalesce(api.claim_probe()->>'role'='authenticated',false) AND EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=api.current_workspace_id()) FROM internal.project_permissions_for(p_project_id,api.current_user_id())
$$;
CREATE FUNCTION internal.can_review_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT can_review AND coalesce(api.claim_probe()->>'role'='authenticated',false) AND EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=api.current_workspace_id()) FROM internal.project_permissions_for(p_project_id,api.current_user_id())
$$;
CREATE OR REPLACE FUNCTION internal.can_manage_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT can_manage AND coalesce(api.claim_probe()->>'role'='authenticated',false) AND EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=api.current_workspace_id()) FROM internal.project_permissions_for(p_project_id,api.current_user_id())
$$;
CREATE FUNCTION internal.can_portal_project(p_project_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT client_portal AND coalesce(api.claim_probe()->>'role'='authenticated',false) AND EXISTS(SELECT 1 FROM api.projects WHERE id=p_project_id AND workspace_id=api.current_workspace_id()) FROM internal.project_permissions_for(p_project_id,api.current_user_id())
$$;
REVOKE ALL ON FUNCTION internal.can_view_project(uuid),internal.can_edit_project(uuid),internal.can_review_project(uuid),internal.can_manage_project(uuid),internal.can_portal_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.can_view_project(uuid),internal.can_edit_project(uuid),internal.can_review_project(uuid),internal.can_manage_project(uuid),internal.can_portal_project(uuid) TO authenticated,api_client;
--> statement-breakpoint

CREATE FUNCTION api.project_permissions(p_project_id uuid)
RETURNS TABLE(can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT internal.can_view_project(p_project_id),internal.can_edit_project(p_project_id),internal.can_review_project(p_project_id),internal.can_portal_project(p_project_id),internal.can_manage_project(p_project_id)
$$;
CREATE FUNCTION api.my_project_permissions()
RETURNS TABLE(project_id uuid,can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean,access_level text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT p.id,q.*,CASE WHEN q.can_manage THEN 'owner' WHEN q.can_edit THEN 'editor' WHEN q.can_review THEN 'reviewer' ELSE 'viewer' END
  FROM api.projects p CROSS JOIN LATERAL internal.project_permissions_for(p.id,api.current_user_id()) q
  WHERE p.workspace_id=api.current_workspace_id() AND api.claim_probe()->>'role'='authenticated' AND q.can_view
$$;
--> statement-breakpoint

CREATE FUNCTION internal.project_rule_display() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  NEW.access_level:=CASE WHEN NEW.can_manage THEN 'owner' WHEN NEW.can_edit THEN 'editor' WHEN NEW.can_review THEN 'reviewer' ELSE 'viewer' END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION internal.project_rule_display() FROM PUBLIC;
CREATE TRIGGER project_rule_display BEFORE INSERT OR UPDATE ON api.project_access
FOR EACH ROW EXECUTE FUNCTION internal.project_rule_display();
--> statement-breakpoint

CREATE FUNCTION api.set_project_access_rule(p_project_id uuid,p_user_id text,p_group_id uuid,p_can_view boolean,p_can_edit boolean,p_can_review boolean,p_client_portal boolean,p_can_manage boolean)
RETURNS api.project_access LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p api.projects; result api.project_access;
BEGIN
  SELECT * INTO p FROM api.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT internal.can_manage_project(p.id) THEN RAISE EXCEPTION 'Explicit project management rule required' USING ERRCODE='42501'; END IF;
  IF (p_user_id IS NULL)=(p_group_id IS NULL) THEN RAISE EXCEPTION 'Exactly one principal required' USING ERRCODE='22023'; END IF;
  IF p_user_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=p.workspace_id AND m.user_id=p_user_id AND m.suspended_at IS NULL) THEN
    RAISE EXCEPTION 'Active same-workspace member required' USING ERRCODE='42501';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api.workspace_groups g WHERE g.workspace_id=p.workspace_id AND g.id=p_group_id) THEN
    RAISE EXCEPTION 'Same-workspace group required' USING ERRCODE='42501';
  END IF;
  IF p_client_portal AND (p.client_id IS NULL OR EXISTS(
    SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=p.workspace_id
      AND (m.user_id=p_user_id OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g WHERE g.workspace_id=m.workspace_id AND g.group_id=p_group_id AND g.user_id=m.user_id))
      AND (m.role<>'client_viewer' OR m.client_id IS DISTINCT FROM p.client_id OR m.suspended_at IS NOT NULL))) THEN
    RAISE EXCEPTION 'Portal principal must belong to this project client' USING ERRCODE='42501';
  END IF;
  IF p_user_id IS NOT NULL THEN
    INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,client_portal,can_manage,granted_by_user_id)
    VALUES(p.workspace_id,p.id,p_user_id,p_can_view,p_can_edit,p_can_review,p_client_portal,p_can_manage,api.current_user_id())
    ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET can_view=excluded.can_view,can_edit=excluded.can_edit,can_review=excluded.can_review,client_portal=excluded.client_portal,can_manage=excluded.can_manage,granted_by_user_id=excluded.granted_by_user_id,updated_at=now() RETURNING * INTO result;
  ELSE
    INSERT INTO api.project_access(workspace_id,project_id,group_id,can_view,can_edit,can_review,client_portal,can_manage,granted_by_user_id)
    VALUES(p.workspace_id,p.id,p_group_id,p_can_view,p_can_edit,p_can_review,p_client_portal,p_can_manage,api.current_user_id())
    ON CONFLICT(workspace_id,project_id,group_id) DO UPDATE SET can_view=excluded.can_view,can_edit=excluded.can_edit,can_review=excluded.can_review,client_portal=excluded.client_portal,can_manage=excluded.can_manage,granted_by_user_id=excluded.granted_by_user_id,updated_at=now() RETURNING * INTO result;
  END IF;
  RETURN result;
END $$;
CREATE FUNCTION api.remove_project_access_rule(p_rule_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p uuid;
BEGIN
  SELECT project_id INTO p FROM api.project_access WHERE id=p_rule_id FOR UPDATE;
  IF NOT internal.can_manage_project(p) THEN RAISE EXCEPTION 'Explicit project management rule required' USING ERRCODE='42501'; END IF;
  DELETE FROM api.project_access WHERE id=p_rule_id;
END $$;
--> statement-breakpoint

-- Existing callers still choose a display level. Translate that input once
-- into the independent canonical flags; never read the display to authorize.
CREATE OR REPLACE FUNCTION api.set_project_member(p_project_id uuid,p_user_id text,p_access_level text)
RETURNS api.project_access LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_access_level NOT IN ('owner','editor','reviewer','viewer') THEN RAISE EXCEPTION 'Unknown access level' USING ERRCODE='22023'; END IF;
  RETURN api.set_project_access_rule(p_project_id,p_user_id,NULL,true,p_access_level IN ('owner','editor'),p_access_level IN ('owner','reviewer'),false,p_access_level='owner');
END $$;
CREATE OR REPLACE FUNCTION api.grant_project_access(p_workspace_id uuid,p_project_id uuid,p_user_id text,p_access_level text DEFAULT 'viewer')
RETURNS api.project_access LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN RAISE EXCEPTION 'Workspace mismatch' USING ERRCODE='42501'; END IF;
  RETURN api.set_project_member(p_project_id,p_user_id,p_access_level);
END $$;
CREATE OR REPLACE FUNCTION api.revoke_project_access(p_workspace_id uuid,p_project_id uuid,p_user_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_workspace_id IS DISTINCT FROM api.current_workspace_id() THEN RAISE EXCEPTION 'Workspace mismatch' USING ERRCODE='42501'; END IF;
  PERFORM api.remove_project_member(p_project_id,p_user_id);
END $$;
--> statement-breakpoint

CREATE FUNCTION api.project_access_rules(p_project_id uuid)
RETURNS TABLE(id uuid,project_id uuid,user_id text,group_id uuid,principal_name text,can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT a.id,a.project_id,a.user_id,a.group_id,coalesce(g.name,u.name),a.can_view,a.can_edit,a.can_review,a.client_portal,a.can_manage
  FROM api.project_access a LEFT JOIN api.workspace_groups g ON g.id=a.group_id LEFT JOIN internal."user" u ON u.id=a.user_id
  WHERE a.project_id=p_project_id AND internal.can_view_project(a.project_id)
$$;
CREATE FUNCTION api.workspace_project_access_rules()
RETURNS TABLE(id uuid,project_id uuid,user_id text,group_id uuid,principal_name text,can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT r.* FROM api.projects p CROSS JOIN LATERAL api.project_access_rules(p.id) r WHERE p.workspace_id=api.current_workspace_id()
$$;
CREATE OR REPLACE FUNCTION api.project_members(p_project_id uuid)
RETURNS TABLE(user_id text,name text,access_level text,workspace_role text,is_lead boolean,added_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id,u.name,CASE WHEN q.can_manage THEN 'owner' WHEN q.can_edit THEN 'editor' WHEN q.can_review THEN 'reviewer' ELSE 'viewer' END,m.role,p.lead_user_id=m.user_id,
    (SELECT min(a.created_at) FROM api.project_access a WHERE a.project_id=p.id AND (a.user_id=m.user_id OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g WHERE g.group_id=a.group_id AND g.user_id=m.user_id)))
  FROM api.projects p JOIN api.workspace_memberships m ON m.workspace_id=p.workspace_id AND m.suspended_at IS NULL
  JOIN internal."user" u ON u.id=m.user_id CROSS JOIN LATERAL internal.project_permissions_for(p.id,m.user_id) q
  WHERE p.id=p_project_id AND internal.can_view_project(p.id) AND q.can_view
  ORDER BY (p.lead_user_id=m.user_id) DESC,u.name
$$;
--> statement-breakpoint

CREATE FUNCTION api.workspace_groups_list() RETURNS TABLE(id uuid,name text,member_ids text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT g.id,g.name,ARRAY(SELECT gm.user_id FROM api.workspace_group_memberships gm JOIN api.workspace_memberships m ON m.workspace_id=gm.workspace_id AND m.user_id=gm.user_id AND m.suspended_at IS NULL WHERE gm.group_id=g.id ORDER BY gm.user_id)
  FROM api.workspace_groups g WHERE g.workspace_id=api.current_workspace_id() AND api.is_workspace_member(g.workspace_id) ORDER BY g.name
$$;
CREATE FUNCTION api.create_workspace_group(p_name text) RETURNS api.workspace_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.workspace_groups;
BEGIN
  IF NOT api.has_capability(api.current_workspace_id(),'workspace.admin') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.workspace_groups(workspace_id,name) VALUES(api.current_workspace_id(),btrim(p_name)) RETURNING * INTO result;
  RETURN result;
END $$;
CREATE FUNCTION api.delete_workspace_group(p_group_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT api.has_capability(api.current_workspace_id(),'workspace.admin') OR NOT EXISTS(SELECT 1 FROM api.workspace_groups WHERE id=p_group_id AND workspace_id=api.current_workspace_id()) THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  UPDATE api.workspace_settings SET integration_settings=integration_settings-'projectAccessDefaults',updated_at=now()
    WHERE workspace_id=api.current_workspace_id() AND integration_settings->'projectAccessDefaults'->>'qaViewGroupId'=p_group_id::text;
  DELETE FROM api.workspace_groups WHERE id=p_group_id;
END $$;
CREATE FUNCTION api.set_workspace_group_member(p_group_id uuid,p_user_id text,p_is_member boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE workspace uuid;
BEGIN
  SELECT workspace_id INTO workspace FROM api.workspace_groups WHERE id=p_group_id FOR UPDATE;
  IF workspace IS DISTINCT FROM api.current_workspace_id() OR NOT api.has_capability(workspace,'workspace.admin')
    OR NOT EXISTS(SELECT 1 FROM api.workspace_memberships WHERE workspace_id=workspace AND user_id=p_user_id AND suspended_at IS NULL) THEN RAISE EXCEPTION 'Active same-workspace member and administrator required' USING ERRCODE='42501'; END IF;
  IF p_is_member THEN
    IF EXISTS(SELECT 1 FROM api.project_access a JOIN api.projects p ON p.id=a.project_id JOIN api.workspace_memberships m ON m.workspace_id=workspace AND m.user_id=p_user_id WHERE a.group_id=p_group_id AND a.client_portal AND (m.role<>'client_viewer' OR m.client_id IS DISTINCT FROM p.client_id)) THEN RAISE EXCEPTION 'Portal group is restricted to its project client' USING ERRCODE='42501'; END IF;
    INSERT INTO api.workspace_group_memberships(workspace_id,group_id,user_id) VALUES(workspace,p_group_id,p_user_id) ON CONFLICT DO NOTHING;
  ELSE DELETE FROM api.workspace_group_memberships WHERE group_id=p_group_id AND user_id=p_user_id;
  END IF;
END $$;
--> statement-breakpoint

CREATE FUNCTION api.request_project_edit_access(p_project_id uuid,p_reason text) RETURNS api.project_access_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result api.project_access_requests;
BEGIN
  IF NOT internal.can_view_project(p_project_id) OR NOT api.is_workspace_writer(api.current_workspace_id()) THEN RAISE EXCEPTION 'Readable project and workspace writer required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.project_access_requests(workspace_id,project_id,user_id,reason) VALUES(api.current_workspace_id(),p_project_id,api.current_user_id(),btrim(p_reason)) RETURNING * INTO result;
  RETURN result;
END $$;
CREATE FUNCTION api.decide_project_access_request(p_request_id uuid,p_approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r api.project_access_requests; existing api.project_access;
BEGIN
  SELECT * INTO r FROM api.project_access_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT internal.can_manage_project(r.project_id) THEN RAISE EXCEPTION 'Explicit project management rule required' USING ERRCODE='42501'; END IF;
  IF r.status<>'pending' THEN RAISE EXCEPTION 'Request is already decided' USING ERRCODE='22023'; END IF;
  IF p_approve THEN
    SELECT * INTO existing FROM api.project_access WHERE project_id=r.project_id AND user_id=r.user_id;
    PERFORM api.set_project_access_rule(r.project_id,r.user_id,NULL,true,true,coalesce(existing.can_review,false),coalesce(existing.client_portal,false),coalesce(existing.can_manage,false));
  END IF;
  UPDATE api.project_access_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,decided_by_user_id=api.current_user_id(),updated_at=now() WHERE id=r.id;
END $$;
CREATE FUNCTION api.project_access_requests_list()
RETURNS TABLE(id uuid,project_id uuid,user_id text,name text,reason text,status text,created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT r.id,r.project_id,r.user_id,u.name,r.reason,r.status,r.created_at FROM api.project_access_requests r JOIN internal."user" u ON u.id=r.user_id
  WHERE r.workspace_id=api.current_workspace_id() AND (internal.can_manage_project(r.project_id) OR (r.user_id=api.current_user_id() AND internal.can_view_project(r.project_id))) ORDER BY r.created_at
$$;
--> statement-breakpoint

CREATE FUNCTION api.workspace_member_status()
RETURNS TABLE(user_id text,last_active_at timestamptz,training_required bigint,training_overdue bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id,(SELECT max(s."updatedAt") FROM internal.session s WHERE s."userId"=m.user_id),
    (SELECT count(*) FROM api.protocol_training t JOIN api.records r ON r.id=t.protocol_record_id WHERE t.workspace_id=m.workspace_id AND t.user_id=m.user_id AND t.status='required' AND internal.can_view_project(r.project_id)),
    (SELECT count(*) FROM api.protocol_training t JOIN api.records r ON r.id=t.protocol_record_id WHERE t.workspace_id=m.workspace_id AND t.user_id=m.user_id AND (t.status='expired' OR (t.status='required' AND t.due_at<now())) AND internal.can_view_project(r.project_id))
  FROM api.workspace_memberships m WHERE m.workspace_id=api.current_workspace_id() AND m.suspended_at IS NULL AND api.has_capability(m.workspace_id,'workspace.admin')
$$;
--> statement-breakpoint

-- The creator/lead receives an explicit owner rule atomically with creation.
CREATE FUNCTION internal.project_owner_rule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE principal text:=coalesce(NEW.lead_user_id,api.current_user_id()); default_group uuid;
BEGIN
  IF principal IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS(SELECT 1 FROM api.workspace_memberships m WHERE m.workspace_id=NEW.workspace_id AND m.user_id=principal AND m.suspended_at IS NULL AND m.role IN ('owner','admin','member','steward','scientist','analyst','reviewer')) THEN RAISE EXCEPTION 'Active writer lead required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.project_access(workspace_id,project_id,user_id,can_view,can_edit,can_review,can_manage,granted_by_user_id)
    VALUES(NEW.workspace_id,NEW.id,principal,true,true,true,true,principal)
  ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET can_view=true,can_edit=true,can_review=true,can_manage=true,updated_at=now();
  SELECT g.id INTO default_group FROM api.workspace_groups g JOIN api.workspace_settings s ON s.workspace_id=g.workspace_id
    WHERE g.workspace_id=NEW.workspace_id AND g.id::text=s.integration_settings->'projectAccessDefaults'->>'qaViewGroupId';
  IF default_group IS NOT NULL THEN
    INSERT INTO api.project_access(workspace_id,project_id,group_id,can_view,granted_by_user_id)
    VALUES(NEW.workspace_id,NEW.id,default_group,true,principal);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION internal.project_owner_rule() FROM PUBLIC;
CREATE TRIGGER project_owner_rule AFTER INSERT ON api.projects FOR EACH ROW EXECUTE FUNCTION internal.project_owner_rule();
ALTER FUNCTION api.create_project(text,uuid,text,text,text,text,text,date) SECURITY DEFINER SET search_path='';
--> statement-breakpoint

-- Group membership, rules and decisions are ordinary immutable change events.
DO $$ DECLARE expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint WHERE conrelid='api.change_events'::regclass AND conname='chk_change_events_entity_type';
  IF strpos(expression,'''project_access''::text')=0 THEN RAISE EXCEPTION 'Unexpected event vocabulary'; END IF;
  expression:=replace(expression,'''project_access''::text','''project_access''::text, ''workspace_group''::text, ''workspace_group_membership''::text, ''project_access_request''::text');
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '||expression;
END $$;
CREATE FUNCTION internal.emit_access_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row_data jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  PERFORM internal.emit_change_event((row_data->>'workspace_id')::uuid,TG_ARGV[0],(row_data->>'id')::uuid,CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'DELETE' THEN 'delete' ELSE 'update' END,NULL,(row_data->>'project_id')::uuid,jsonb_build_object('before',CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,'after',CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END));
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION internal.emit_access_change() FROM PUBLIC;
DROP TRIGGER change_event_project_access ON api.project_access;
CREATE TRIGGER change_event_project_access AFTER INSERT OR UPDATE OR DELETE ON api.project_access FOR EACH ROW EXECUTE FUNCTION internal.emit_access_change('project_access');
CREATE TRIGGER change_event_workspace_group AFTER INSERT OR UPDATE OR DELETE ON api.workspace_groups FOR EACH ROW EXECUTE FUNCTION internal.emit_access_change('workspace_group');
CREATE TRIGGER change_event_workspace_group_membership AFTER INSERT OR UPDATE OR DELETE ON api.workspace_group_memberships FOR EACH ROW EXECUTE FUNCTION internal.emit_access_change('workspace_group_membership');
CREATE TRIGGER change_event_project_access_request AFTER INSERT OR UPDATE OR DELETE ON api.project_access_requests FOR EACH ROW EXECUTE FUNCTION internal.emit_access_change('project_access_request');
--> statement-breakpoint

ALTER TABLE api.workspace_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.workspace_group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.project_access_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_groups_read ON api.workspace_groups FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY workspace_group_memberships_read ON api.workspace_group_memberships FOR SELECT TO authenticated USING(workspace_id=api.current_workspace_id() AND api.is_workspace_member(workspace_id));
CREATE POLICY project_access_requests_read ON api.project_access_requests FOR SELECT TO authenticated USING(internal.can_manage_project(project_id) OR (user_id=api.current_user_id() AND internal.can_view_project(project_id)));
GRANT SELECT ON api.workspace_groups,api.workspace_group_memberships,api.project_access_requests TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON api.project_access FROM authenticated,api_client;
CREATE POLICY project_access_live_read ON api.project_access AS RESTRICTIVE FOR SELECT TO authenticated,api_client USING(internal.can_view_project(project_id));
CREATE POLICY projects_live_read ON api.projects AS RESTRICTIVE FOR SELECT TO authenticated,api_client USING(internal.can_view_project(id));
CREATE POLICY projects_live_update ON api.projects AS RESTRICTIVE FOR UPDATE TO authenticated,api_client USING(internal.can_manage_project(id)) WITH CHECK(internal.can_manage_project(id));
CREATE POLICY projects_live_delete ON api.projects AS RESTRICTIVE FOR DELETE TO authenticated,api_client USING(internal.can_manage_project(id));
CREATE POLICY records_live_read ON api.records AS RESTRICTIVE FOR SELECT TO authenticated,api_client USING(project_id IS NULL OR internal.can_view_project(project_id));
CREATE POLICY records_live_insert ON api.records AS RESTRICTIVE FOR INSERT TO authenticated,api_client WITH CHECK(project_id IS NULL OR internal.can_edit_project(project_id));
CREATE POLICY records_live_update ON api.records AS RESTRICTIVE FOR UPDATE TO authenticated,api_client USING(project_id IS NULL OR internal.can_edit_project(project_id)) WITH CHECK(project_id IS NULL OR internal.can_edit_project(project_id));
CREATE POLICY records_live_delete ON api.records AS RESTRICTIVE FOR DELETE TO authenticated,api_client USING(project_id IS NULL OR internal.can_edit_project(project_id));
--> statement-breakpoint

-- Explicit grant list avoids accidentally exposing future helpers.
REVOKE ALL ON FUNCTION api.project_permissions(uuid),api.my_project_permissions(),api.set_project_access_rule(uuid,text,uuid,boolean,boolean,boolean,boolean,boolean),api.remove_project_access_rule(uuid),api.project_access_rules(uuid),api.workspace_project_access_rules(),api.workspace_groups_list(),api.create_workspace_group(text),api.delete_workspace_group(uuid),api.set_workspace_group_member(uuid,text,boolean),api.request_project_edit_access(uuid,text),api.decide_project_access_request(uuid,boolean),api.project_access_requests_list(),api.workspace_member_status() FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.project_permissions(uuid),api.my_project_permissions(),api.set_project_access_rule(uuid,text,uuid,boolean,boolean,boolean,boolean,boolean),api.remove_project_access_rule(uuid),api.project_access_rules(uuid),api.workspace_project_access_rules(),api.workspace_groups_list(),api.create_workspace_group(text),api.delete_workspace_group(uuid),api.set_workspace_group_member(uuid,text,boolean),api.request_project_edit_access(uuid,text),api.decide_project_access_request(uuid,boolean),api.project_access_requests_list(),api.workspace_member_status() TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.my_onboarding_state()
RETURNS TABLE(user_id text,workspace_role text,joined_at timestamptz,invitation_accepted_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id,m.role,m.created_at,
    (SELECT max(i.accepted_at) FROM api.workspace_invitations i
      WHERE i.workspace_id=m.workspace_id AND i.accepted_by_user_id=m.user_id AND i.status='accepted')
  FROM api.workspace_memberships m WHERE m.workspace_id=api.current_workspace_id()
    AND m.user_id=api.current_user_id() AND m.suspended_at IS NULL
    AND api.claim_probe()->>'role'='authenticated'
$$;
REVOKE ALL ON FUNCTION api.my_onboarding_state() FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.my_onboarding_state() TO authenticated;
--> statement-breakpoint
CREATE FUNCTION api.project_access_defaults()
RETURNS TABLE(private_to_lead boolean,qa_view_group_id uuid,client_portal_off boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT true,(SELECT g.id FROM api.workspace_groups g JOIN api.workspace_settings s ON s.workspace_id=g.workspace_id
    WHERE g.workspace_id=api.current_workspace_id() AND g.id::text=s.integration_settings->'projectAccessDefaults'->>'qaViewGroupId'),true
  WHERE api.is_workspace_member(api.current_workspace_id())
$$;
CREATE FUNCTION api.set_project_access_defaults(p_qa_view_group_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT api.has_capability(api.current_workspace_id(),'workspace.admin') THEN RAISE EXCEPTION 'Workspace administrator required' USING ERRCODE='42501'; END IF;
  IF p_qa_view_group_id IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM api.workspace_groups g WHERE g.workspace_id=api.current_workspace_id() AND g.id=p_qa_view_group_id)
    OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g JOIN api.workspace_memberships m ON m.workspace_id=g.workspace_id AND m.user_id=g.user_id WHERE g.group_id=p_qa_view_group_id AND m.role='client_viewer')) THEN RAISE EXCEPTION 'Explicit internal workspace group required' USING ERRCODE='42501'; END IF;
  INSERT INTO api.workspace_settings(workspace_id,created_by_user_id,integration_settings)
    VALUES(api.current_workspace_id(),api.current_user_id(),jsonb_build_object('projectAccessDefaults',jsonb_build_object('qaViewGroupId',p_qa_view_group_id)))
  ON CONFLICT(workspace_id) DO UPDATE SET integration_settings=workspace_settings.integration_settings||excluded.integration_settings,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION api.project_access_defaults(),api.set_project_access_defaults(uuid) FROM PUBLIC,api_client;
GRANT EXECUTE ON FUNCTION api.project_access_defaults(),api.set_project_access_defaults(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
--> statement-breakpoint

-- Object ownership gates. These run as the caller's claims, including inside
-- SECURITY DEFINER readers; trusted integrity internals remain unchanged.
CREATE FUNCTION internal.can_access_object(p_kind text,p_id uuid,p_permission text DEFAULT 'view')
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE project uuid; workspace uuid; parent uuid; payload jsonb; item record;
BEGIN
  IF p_id IS NULL OR p_permission NOT IN ('view','edit','review','manage') THEN RETURN false; END IF;
  CASE p_kind
    WHEN 'project' THEN SELECT workspace_id,id INTO workspace,project FROM api.projects WHERE id=p_id;
    WHEN 'record' THEN SELECT workspace_id,project_id INTO workspace,project FROM api.records WHERE id=p_id;
    WHEN 'dataset' THEN SELECT workspace_id,primary_project_id INTO workspace,project FROM api.datasets WHERE id=p_id;
    WHEN 'instance' THEN
      SELECT workspace_id,project_id,notebook_record_id,state INTO workspace,project,parent,payload FROM api.sheet_instances WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
      IF NOT internal.sources_readable(payload) THEN RETURN false; END IF;
    WHEN 'revision' THEN
      SELECT record_id,canonical_snapshot INTO parent,payload FROM api.revisions WHERE id=p_id;
      IF NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
      IF NOT internal.sources_readable(payload) THEN RETURN false; END IF;
      FOR item IN SELECT instance_state,dataset_versions FROM api.revision_sheet_evidence WHERE revision_id=p_id LOOP
        IF NOT internal.sources_readable(item.instance_state) OR NOT internal.sources_readable(item.dataset_versions) THEN RETURN false; END IF;
      END LOOP;
      RETURN true;
    WHEN 'submission' THEN SELECT record_id INTO parent FROM api.review_submissions WHERE id=p_id; RETURN internal.can_access_object('record',parent,p_permission);
    WHEN 'block' THEN SELECT record_id INTO parent FROM api.blocks WHERE id=p_id; RETURN internal.can_access_object('record',parent,p_permission);
    WHEN 'table' THEN SELECT record_id INTO parent FROM api.scientific_tables WHERE id=p_id; RETURN internal.can_access_object('record',parent,p_permission);
    WHEN 'dataset_row' THEN SELECT dataset_id INTO parent FROM api.dataset_rows WHERE id=p_id; RETURN internal.can_access_object('dataset',parent,p_permission);
    WHEN 'dataset_flag' THEN SELECT dataset_id INTO parent FROM api.dataset_value_flags WHERE id=p_id; RETURN internal.can_access_object('dataset',parent,p_permission);
    WHEN 'dataset_version' THEN SELECT dataset_id INTO parent FROM api.dataset_versions WHERE id=p_id; RETURN internal.can_access_object('dataset',parent,p_permission);
    WHEN 'comment' THEN
      SELECT workspace_id,record_id,sheet_instance_id INTO workspace,parent,project FROM api.comments WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
      IF project IS NOT NULL AND NOT internal.can_access_object('instance',project,p_permission) THEN RETURN false; END IF;
      RETURN workspace=api.current_workspace_id() AND api.is_workspace_member(workspace) AND (parent IS NOT NULL OR project IS NOT NULL);
    WHEN 'file' THEN SELECT workspace_id,record_id INTO workspace,parent FROM api.file_objects WHERE id=p_id; IF parent IS NOT NULL THEN RETURN internal.can_access_object('record',parent,p_permission); END IF;
    WHEN 'import_file' THEN SELECT workspace_id,dataset_id INTO workspace,parent FROM api.dataset_import_files WHERE id=p_id; IF parent IS NOT NULL THEN RETURN internal.can_access_object('dataset',parent,p_permission); END IF;
    WHEN 'folder' THEN SELECT workspace_id,project_id INTO workspace,project FROM api.folders WHERE id=p_id;
    WHEN 'run' THEN
      SELECT workspace_id,project_id INTO workspace,project FROM api.instrument_runs WHERE id=p_id;
      IF EXISTS(SELECT 1 FROM api.instrument_run_links l WHERE l.run_id=p_id AND NOT internal.can_access_object('record',l.linked_record_id,'view')) THEN RETURN false; END IF;
    WHEN 'report' THEN
      SELECT workspace_id,project_id,record_id INTO workspace,project,parent FROM api.report_definitions WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
      IF EXISTS(SELECT 1 FROM api.report_sections s WHERE s.report_id=p_id AND
        ((s.source_revision_id IS NOT NULL AND NOT internal.can_access_object('revision',s.source_revision_id,'view')) OR NOT internal.sources_readable(s.source_ref))) THEN RETURN false; END IF;
    WHEN 'section' THEN SELECT report_id INTO parent FROM api.report_sections WHERE id=p_id; RETURN internal.can_access_object('report',parent,p_permission);
    WHEN 'booking' THEN
      SELECT workspace_id,project_id,linked_experiment_record_id INTO workspace,project,parent FROM api.calendar_bookings WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,'view') THEN RETURN false; END IF;
    WHEN 'task' THEN
      SELECT workspace_id,project_id,study_record_id INTO workspace,project,parent FROM api.study_tasks WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
    WHEN 'workstream' THEN
      SELECT workspace_id,project_id,study_record_id INTO workspace,project,parent FROM api.study_workstreams WHERE id=p_id;
      IF parent IS NOT NULL AND NOT internal.can_access_object('record',parent,p_permission) THEN RETURN false; END IF;
    WHEN 'resource' THEN SELECT workspace_id,project_id INTO workspace,project FROM api.calendar_resources WHERE id=p_id;
    WHEN 'dependency' THEN
      SELECT predecessor_id,successor_id INTO parent,project FROM api.study_task_dependencies WHERE id=p_id;
      RETURN internal.can_access_object('task',parent,p_permission) AND internal.can_access_object('task',project,p_permission);
    WHEN 'design' THEN SELECT workspace_id,project_id INTO workspace,project FROM api.plate_designs WHERE id=p_id;
    ELSE RETURN false;
  END CASE;
  IF workspace IS NULL OR workspace IS DISTINCT FROM api.current_workspace_id() THEN RETURN false; END IF;
  IF project IS NULL THEN
    RETURN api.claim_probe()->>'role'='authenticated' AND
      CASE WHEN p_permission='view' THEN api.is_workspace_member(workspace) ELSE api.is_workspace_writer(workspace) END;
  END IF;
  RETURN CASE p_permission WHEN 'view' THEN internal.can_view_project(project)
    WHEN 'edit' THEN internal.can_edit_project(project) WHEN 'review' THEN internal.can_review_project(project)
    WHEN 'manage' THEN internal.can_manage_project(project) END;
END $$;
--> statement-breakpoint
CREATE FUNCTION internal.sources_readable(p_payload jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE reference jsonb; kind text; id uuid;
BEGIN
  IF p_payload IS NULL THEN RETURN true; END IF;
  FOR reference IN SELECT value FROM jsonb_path_query(p_payload,'strict $.** ? (@.type() == "object").keyvalue() ? (@.key == "datasetId" || @.key == "dataset_id" || @.key == "recordId" || @.key == "record_id" || @.key == "datasetVersionId" || @.key == "dataset_version_id")') value LOOP
    IF reference->'value'='null'::jsonb THEN CONTINUE; END IF;
    IF reference->>'value' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    id:=(reference->>'value')::uuid;
    kind:=CASE WHEN reference->>'key' IN ('datasetId','dataset_id') THEN 'dataset' WHEN reference->>'key' IN ('recordId','record_id') THEN 'record' ELSE 'dataset_version' END;
    IF NOT internal.can_access_object(kind,id,'view') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;
CREATE FUNCTION internal.assert_object_access(p_kind text,p_id uuid,p_permission text DEFAULT 'view') RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT internal.can_access_object(p_kind,p_id,p_permission) THEN RAISE EXCEPTION 'Object access denied' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION internal.can_access_object(text,uuid,text),internal.sources_readable(jsonb),internal.assert_object_access(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.can_access_object(text,uuid,text) TO authenticated,api_client;
--> statement-breakpoint

-- Shared event guard applies even for owner/admin readers. Record-derived
-- ownership is checked independently of the denormalised project hint.
CREATE FUNCTION internal.can_read_change_event(p_event api.change_events) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE kind text;
BEGIN
  IF p_event.workspace_id IS DISTINCT FROM api.current_workspace_id() OR NOT api.is_workspace_member(p_event.workspace_id) THEN RETURN false; END IF;
  IF p_event.project_id IS NOT NULL AND NOT internal.can_view_project(p_event.project_id) THEN RETURN false; END IF;
  IF p_event.record_id IS NOT NULL AND NOT internal.can_access_object('record',p_event.record_id,'view') THEN RETURN false; END IF;
  kind:=CASE p_event.entity_type WHEN 'project' THEN 'project' WHEN 'record' THEN 'record' WHEN 'dataset' THEN 'dataset' WHEN 'dataset_version' THEN 'dataset_version' WHEN 'sheet_instance' THEN 'instance' WHEN 'file' THEN 'file' WHEN 'report_definition' THEN 'report' WHEN 'report_section' THEN 'section' WHEN 'instrument_run' THEN 'run' WHEN 'calendar_booking' THEN 'booking' WHEN 'study_task' THEN 'task' WHEN 'comment' THEN 'comment' WHEN 'block' THEN 'block' WHEN 'scientific_table' THEN 'table' WHEN 'dataset_import_file' THEN 'import_file' END;
  -- Deleted objects retain their immutable project/record ownership hints.
  IF kind IS NOT NULL AND p_event.operation<>'delete' AND NOT internal.can_access_object(kind,p_event.entity_uuid,'view') THEN RETURN false; END IF;
  RETURN internal.sources_readable(p_event.payload);
END $$;
REVOKE ALL ON FUNCTION internal.can_read_change_event(api.change_events) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.can_read_change_event(api.change_events) TO authenticated,api_client;
CREATE POLICY change_events_live_read ON api.change_events AS RESTRICTIVE FOR SELECT TO authenticated,api_client USING(internal.can_read_change_event(change_events));
--> statement-breakpoint

DO $$ DECLARE signature text; definition text; anchor text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['api.audit_events(text,text,text,timestamptz,timestamptz,text,uuid,bigint,integer)','api.export_audit_log(uuid,timestamptz,timestamptz,integer)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:=CASE WHEN signature LIKE 'api.audit_events%' THEN 'WHERE e.workspace_id = v_workspace' ELSE 'WHERE workspace_id=p_workspace_id' END;
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Audit projection guard anchor missing: %',signature; END IF;
    definition:=replace(definition,anchor,anchor||CASE WHEN signature LIKE 'api.audit_events%' THEN ' AND internal.can_read_change_event(e)' ELSE ' AND internal.can_read_change_event(change_events)' END);
    EXECUTE definition;
  END LOOP;
  definition:=pg_get_functiondef('api.search_did_you_mean(text,integer,boolean)'::regprocedure);
  IF strpos(definition,'AND r.deleted_at IS NULL')=0 THEN RAISE EXCEPTION 'Search suggestion guard anchor missing'; END IF;
  EXECUTE replace(definition,'AND r.deleted_at IS NULL','AND internal.can_access_object(''record'',r.id,''view'') AND r.deleted_at IS NULL');
END $$;
--> statement-breakpoint

-- Stable ownership projections for direct table reads/writes. Restrictive
-- policies intersect, rather than replace, all existing capability/lock rules.
DO $$ DECLARE rule record; expression text;
BEGIN
  FOR rule IN SELECT * FROM (VALUES
    ('blocks','record','record_id'),('revisions','revision','id'),('review_submissions','record','record_id'),('signatures','record','record_id'),
    ('record_aliases','record','record_id'),('protocol_training','record','protocol_record_id'),('scientific_tables','record','record_id'),
    ('record_links','record','source_record_id'),('storage_movements','record','record_id'),('formula_dependencies','record','record_id'),
    ('notebook_template_instantiations','record','record_id'),('notebook_template_upgrades','record','record_id'),
    ('scientific_columns','table','table_id'),('scientific_transfers','record','record_id'),('formula_definitions','record','record_id'),
    ('sample_events','record','record_id'),('sample_measurements','record','sample_record_id'),('folders','project','project_id'),
    ('datasets','dataset','id'),('dataset_rows','dataset','dataset_id'),('dataset_row_values','dataset_row','row_id'),('dataset_cell_search','dataset','dataset_id'),
    ('dataset_value_flags','dataset','dataset_id'),('dataset_versions','dataset','dataset_id'),('dataset_import_files','import_file','id'),('dataset_imports','dataset','dataset_id'),('dataset_bulk_commits','dataset','dataset_id'),
    ('dataset_version_rows','dataset_version','dataset_version_id'),('dataset_version_values','dataset_version','dataset_version_id'),('dataset_version_flags','dataset_version','dataset_version_id'),
    ('dataset_version_keeps','dataset_version','dataset_version_id'),('dataset_version_prunes','dataset_version','dataset_version_id'),
    ('sheet_instances','instance','id'),('sheet_instance_local_mutations','instance','instance_id'),('sheet_instance_calculation_mutations','instance','instance_id'),
    ('sheet_instance_definition_upgrades','instance','instance_id'),('sheet_instance_composition_adoptions','instance','instance_id'),('sheet_materializations','instance','instance_id'),('sheet_record_bulk_commits','project','project_id'),
    ('revision_sheet_evidence','revision','revision_id'),('review_check_results','revision','revision_id'),('review_decisions','submission','submission_id'),
    ('comments','comment','id'),('file_objects','file','id'),('instrument_runs','run','id'),('instrument_observations','run','run_id'),('instrument_run_links','run','run_id'),
    ('instrument_run_stages','run','run_id'),('instrument_raw_files','run','run_id'),('instrument_plate_snapshots','run','run_id'),('instrument_qc_checks','run','run_id'),
    ('report_definitions','report','id'),('report_sections','report','report_id'),('report_generations','report','report_id'),
    ('calendar_bookings','booking','id'),('calendar_booking_samples','booking','booking_id'),('calendar_booking_participants','booking','booking_id'),
    ('studies','record','record_id'),('study_tasks','task','id'),('study_workstreams','workstream','id'),('study_task_dependencies','dependency','id'),('calendar_resources','resource','id'),('study_deliverables','task','task_id'),('study_task_assignments','task','task_id'),('study_task_resources','task','task_id'),('study_plan_snapshots','record','study_record_id'),('study_projects','record','study_record_id'),('study_experiments','record','study_record_id'),
    ('plate_designs','design','id'),('plate_wells','design','design_id')
  ) AS ownership(table_name,kind,column_name) LOOP
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='api' AND table_name=rule.table_name AND column_name=rule.column_name) THEN RAISE EXCEPTION 'Ownership column missing: %.%',rule.table_name,rule.column_name; END IF;
    expression:=format('internal.can_access_object(%L,%I,%L)',rule.kind,rule.column_name,'view');
    EXECUTE format('CREATE POLICY set02_live_read ON api.%I AS RESTRICTIVE FOR SELECT TO authenticated,api_client USING(%s)',rule.table_name,expression);
    -- Leaf INSERTs authorize their existing parent, not their new row id.
    expression:=format('internal.can_access_object(%L,%I,%L)',rule.kind,rule.column_name,'edit');
    IF rule.column_name<>'id' THEN
      EXECUTE format('CREATE POLICY set02_live_insert ON api.%I AS RESTRICTIVE FOR INSERT TO authenticated,api_client WITH CHECK(%s)',rule.table_name,expression);
    END IF;
    EXECUTE format('CREATE POLICY set02_live_update ON api.%I AS RESTRICTIVE FOR UPDATE TO authenticated,api_client USING(%s) WITH CHECK(%s)',rule.table_name,expression,expression);
    EXECUTE format('CREATE POLICY set02_live_delete ON api.%I AS RESTRICTIVE FOR DELETE TO authenticated,api_client USING(%s)',rule.table_name,expression);
  END LOOP;
END $$;
--> statement-breakpoint

-- New identity rows cannot authorize themselves by looking up their id. Check
-- their actual parent columns, including on reassignment to another project.
CREATE POLICY datasets_parent_write ON api.datasets AS RESTRICTIVE FOR ALL TO authenticated,api_client
  USING(primary_project_id IS NULL OR internal.can_view_project(primary_project_id))
  WITH CHECK(primary_project_id IS NULL OR internal.can_edit_project(primary_project_id));
CREATE POLICY files_parent_write ON api.file_objects AS RESTRICTIVE FOR ALL TO authenticated,api_client
  USING(record_id IS NULL OR internal.can_access_object('record',record_id,'view'))
  WITH CHECK(record_id IS NULL OR internal.can_access_object('record',record_id,'edit'));
CREATE POLICY revisions_parent_insert ON api.revisions AS RESTRICTIVE FOR INSERT TO authenticated,api_client
  WITH CHECK(internal.can_access_object('record',record_id,'edit'));
CREATE POLICY record_links_target_write ON api.record_links AS RESTRICTIVE FOR ALL TO authenticated,api_client
  USING(internal.can_access_object('record',target_record_id,'view'))
  WITH CHECK(internal.can_access_object('record',target_record_id,'view'));
CREATE OR REPLACE VIEW api.my_notifications AS
  SELECT id,workspace_id,user_id,event_type,title,body,record_id,project_id,created_at,read_at
  FROM internal.notifications WHERE user_id=api.current_user_id() AND workspace_id=api.current_workspace_id()
    AND (project_id IS NULL OR internal.can_view_project(project_id))
    AND (record_id IS NULL OR internal.can_access_object('record',record_id,'view'));
--> statement-breakpoint

-- Public PL/pgSQL object entry points must re-authorize before idempotent
-- replay, source freezing or delegation to a trusted integrity helper.
DO $$ DECLARE f record; parameter text; kind text; permission text; guard text; definition text; body text;
BEGIN
  FOR f IN SELECT p.oid,p.proname,p.proargnames,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='api' AND p.prosecdef AND l.lanname='plpgsql' AND (has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('api_client',p.oid,'EXECUTE'))
  LOOP
    -- Permission classification is explicit. Read-only previews never grant
    -- mutation capability, and comments require View plus their writer gate.
    permission:=CASE WHEN f.proname ~ '^(query_|preview_|read_|validate_|discover_|model_record_validation$|compare_dataset_versions$|run_revision_checks$|record_timeline$|revision_evidence_package$|sample_.*provenance$|sample_quantity_balances$|dataset_version_|sheet_instance_notebook_embeddings$|follow_record$|record_recent_view$|set_record_favourite$|create_comment$|create_sheet_comment$|reply_to_comment$|resolve_comment_thread$|reopen_comment_thread$)' THEN 'view'
      WHEN f.proname IN ('archive_project','unarchive_project','update_project_details','update_project_settings','share_record_with_client','unshare_record_with_client') THEN 'manage'
      ELSE 'edit' END;
    guard:='';
    FOREACH parameter IN ARRAY coalesce(f.proargnames,'{}'::text[]) LOOP
      kind:=CASE parameter
        WHEN 'p_project_id' THEN 'project' WHEN 'p_target_project_id' THEN 'project' WHEN 'p_home_project_id' THEN 'project' WHEN 'p_primary_project_id' THEN 'project'
        WHEN 'p_record_id' THEN 'record' WHEN 'p_study_record_id' THEN 'record' WHEN 'p_sample_record_id' THEN 'record' WHEN 'p_reagent_record_id' THEN 'record'
        WHEN 'p_experiment_record_id' THEN 'record' WHEN 'p_source_record_id' THEN 'record' WHEN 'p_linked_record_id' THEN 'record'
        WHEN 'p_protocol_record_id' THEN 'record' WHEN 'p_template_record_id' THEN 'record' WHEN 'p_linked_experiment_record_id' THEN 'record' WHEN 'p_linked_protocol_record_id' THEN 'record'
        WHEN 'p_notebook_record_id' THEN 'record' WHEN 'p_instance_id' THEN 'instance' WHEN 'p_block_id' THEN 'block'
        WHEN 'p_table_id' THEN 'table' WHEN 'p_dataset_id' THEN 'dataset' WHEN 'p_dataset_version_id' THEN 'dataset_version'
        WHEN 'p_version_a' THEN 'dataset_version' WHEN 'p_version_b' THEN 'dataset_version'
        WHEN 'p_version_id' THEN CASE WHEN f.proname IN ('dataset_version_retention','keep_dataset_version') THEN 'dataset_version' END
        WHEN 'p_flag_id' THEN 'dataset_flag' WHEN 'p_workstream_id' THEN 'workstream'
        WHEN 'p_predecessor_id' THEN 'task' WHEN 'p_successor_id' THEN 'task' WHEN 'p_dependency_id' THEN 'dependency'
        WHEN 'p_report_id' THEN 'report' WHEN 'p_section_id' THEN 'section' WHEN 'p_comment_id' THEN 'comment'
        WHEN 'p_revision_id' THEN 'revision' WHEN 'p_source_revision_id' THEN 'revision' WHEN 'p_parent_id' THEN CASE WHEN f.proname='reply_to_comment' THEN 'comment' END
        WHEN 'p_file_id' THEN CASE WHEN f.proname IN ('record_dataset_import_file_parse','request_parser_update','commit_dataset_import') THEN 'import_file' ELSE 'file' END
        WHEN 'p_run_id' THEN CASE WHEN f.prosrc ~ 'api\.instrument_runs' THEN 'run' END
        WHEN 'p_task_id' THEN 'task' WHEN 'p_booking_id' THEN 'booking' WHEN 'p_design_id' THEN 'design'
      END;
      IF kind IS NOT NULL THEN
        guard:=guard||format(E'\n IF %I IS NOT NULL THEN PERFORM internal.assert_object_access(%L,%I,%L); END IF;',parameter,kind,parameter,
          CASE WHEN parameter IN ('p_protocol_record_id','p_template_record_id','p_linked_record_id','p_linked_experiment_record_id','p_linked_protocol_record_id','p_source_revision_id') AND f.proname<>'record_protocol_training' THEN 'view' ELSE permission END);
      END IF;
    END LOOP;
    IF f.proname IN ('discover_object_dependencies','preview_hard_delete','execute_hard_delete') THEN
      guard:=guard||format(E'\n IF p_kind IN (''record'',''notebook_record'',''dataset'',''sheet_instance'') THEN PERFORM internal.assert_object_access(CASE p_kind WHEN ''sheet_instance'' THEN ''instance'' WHEN ''notebook_record'' THEN ''record'' ELSE p_kind END,p_object_id,%L); END IF;',permission);
    END IF;
    FOREACH parameter IN ARRAY ARRAY['p_state','p_input_versions','p_source_ref'] LOOP
      IF parameter=ANY(coalesce(f.proargnames,'{}'::text[])) THEN
        guard:=guard||format(E'\n IF NOT internal.sources_readable(%I) THEN RAISE EXCEPTION ''Source access denied'' USING ERRCODE=''42501''; END IF;',parameter);
      END IF;
    END LOOP;
    -- Group/rule administration and portal readers own distinct canonical
    -- gates above; never infer their authority from the parameter's spelling.
    IF guard='' OR f.proname IN ('set_project_member','grant_project_access','revoke_project_access','remove_project_member','set_project_access_rule','remove_project_access_rule','request_project_edit_access','decide_project_access_request','post_client_portal_message','client_portal_record_document') THEN CONTINUE; END IF;
    IF f.prosrc !~ '\mBEGIN\M' THEN RAISE EXCEPTION 'Missing entry guard anchor: %',f.oid::regprocedure; END IF;
    body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN'||guard);
    definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint
-- SQL readers and cross-object projections must filter the source relation,
-- before counts/windows. An accessible Sheet is not permission for notebooks
-- embedding it, and a workspace schema is not permission for its datasets.
DO $$ DECLARE definition text;
BEGIN
  definition:=pg_get_functiondef('api.dataset_import_list(uuid)'::regprocedure);
  EXECUTE replace(definition,'WHERE i.dataset_id = p_dataset_id','WHERE i.dataset_id = p_dataset_id AND internal.can_access_object(''dataset'',i.dataset_id,''view'')');
  definition:=pg_get_functiondef('api.sheet_instance_notebook_embeddings(uuid)'::regprocedure);
  EXECUTE replace(definition,'WHERE r.workspace_id = workspace','WHERE r.workspace_id = workspace AND internal.can_access_object(''record'',r.id,''view'')');
  definition:=pg_get_functiondef('internal.assert_scientific_record_writable(uuid)'::regprocedure);
  EXECUTE replace(definition,'BEGIN',E'BEGIN\n IF session_user<>''migrator'' THEN PERFORM internal.assert_object_access(''table'',p_table_id,''edit''); END IF;');
  definition:=pg_get_functiondef('internal.guard_sheet_instance()'::regprocedure);
  EXECUTE replace(definition,'PERFORM internal.validate_sheet_instance_state(NEW.state);',E'PERFORM internal.validate_sheet_instance_state(NEW.state);\n IF session_user<>''migrator'' AND NOT internal.sources_readable(NEW.state) THEN RAISE EXCEPTION ''Sheet source access denied'' USING ERRCODE=''42501''; END IF;');
  definition:=pg_get_functiondef('api.record_recent_view(text,uuid)'::regprocedure);
  EXECUTE replace(definition,'v_workspace_id := CASE',E'IF p_object_kind<>''notebook_template'' AND NOT internal.can_access_object(CASE p_object_kind WHEN ''sheet'' THEN ''instance'' ELSE p_object_kind END,p_object_id,''view'') THEN RETURN NULL; END IF;\n v_workspace_id := CASE');
  definition:=pg_get_functiondef('api.set_record_favourite(text,uuid,boolean)'::regprocedure);
  EXECUTE replace(definition,'v_workspace_id := CASE',E'IF p_object_kind<>''notebook_template'' AND NOT internal.can_access_object(CASE p_object_kind WHEN ''sheet'' THEN ''instance'' ELSE p_object_kind END,p_object_id,''view'') THEN RETURN NULL; END IF;\n v_workspace_id := CASE');
END $$;
--> statement-breakpoint
-- Workspace-level impact readers may inspect a shared definition, but cannot
-- reveal titles or usage counts from projects absent from the caller's rules.
DO $$ DECLARE definition text; rule record; signature text; needle text;
BEGIN
  definition:=pg_get_functiondef('api.model_field_usage(uuid)'::regprocedure);
  FOR rule IN SELECT * FROM (VALUES ('projects','project'),('plate_designs','design'),('instrument_runs','run'),('scientific_tables','table'),('records','record')) AS host(table_name,kind) LOOP
    needle:=format('FROM api.%I WHERE workspace_id=definition.workspace_id',rule.table_name);
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Model usage ownership anchor missing: %',rule.table_name; END IF;
    definition:=replace(definition,needle,needle||format(' AND internal.can_access_object(%L,id,''view'')',rule.kind));
  END LOOP;
  EXECUTE definition;
  definition:=pg_get_functiondef('api.discover_object_dependencies(text,uuid)'::regprocedure);
  FOR rule IN SELECT * FROM (VALUES ('projects','project'),('plate_designs','design'),('instrument_runs','run'),('scientific_tables','table'),('records','record')) AS host(table_name,kind) LOOP
    needle:=format(E'FROM api.%I\n           WHERE workspace_id = workspace',rule.table_name);
    IF strpos(definition,needle)=0 THEN RAISE EXCEPTION 'Model impact ownership anchor missing: %',rule.table_name; END IF;
    definition:=replace(definition,needle,needle||format(' AND internal.can_access_object(%L,id,''view'')',rule.kind));
  END LOOP;
  EXECUTE definition;
  FOREACH signature IN ARRAY ARRAY['api.discover_object_dependencies_core054(text,uuid)','api.discover_object_dependencies_core062(text,uuid)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    definition:=replace(definition,'AND d.workspace_id = workspace','AND d.workspace_id = workspace AND internal.can_access_object(''dataset'',d.id,''view'')');
    definition:=replace(definition,'AND v.workspace_id = workspace','AND v.workspace_id = workspace AND internal.can_access_object(''dataset_version'',v.id,''view'')');
    definition:=replace(definition,'i.workspace_id = workspace','i.workspace_id = workspace AND internal.can_access_object(''instance'',i.id,''view'')');
    definition:=replace(definition,'WHERE u.workspace_id = workspace','WHERE u.workspace_id = workspace AND internal.can_access_object(''instance'',u.instance_id,''view'')');
    definition:=replace(definition,'WHERE r.workspace_id = workspace','WHERE r.workspace_id = workspace AND internal.can_access_object(''record'',r.id,''view'')');
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint
-- Trusted scientific writers have no PostgREST JWT context. Recheck the
-- authenticated human actor's same canonical rule union at the final write,
-- so a service connection cannot bypass suspension or live rule revocation.
DO $$ DECLARE definition text; signature text; membership text; permission text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['internal.apply_trusted_formula_write(text,jsonb)','internal.apply_trusted_calculation(text,uuid,bigint,text,jsonb,jsonb,text,text,text)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    permission:=CASE WHEN signature LIKE 'internal.apply_trusted_formula_write%' THEN 'can_edit' ELSE 'can_view' END;
    membership:=CASE WHEN permission='can_edit' THEN 'm.workspace_id=t.workspace_id AND m.user_id=p_actor_user_id' ELSE 'm.workspace_id=r.workspace_id AND m.user_id=p_actor_user_id' END;
    IF strpos(definition,membership)=0 THEN RAISE EXCEPTION 'Trusted scientific actor anchor missing: %',signature; END IF;
    definition:=replace(definition,membership,membership||' AND m.suspended_at IS NULL AND '||CASE WHEN permission='can_edit' THEN 'm.role IN (''owner'',''admin'',''member'',''steward'',''scientist'',''analyst'',''reviewer'')' ELSE 'm.role<>''client_viewer''' END||format(' AND (r.project_id IS NULL OR (SELECT %I FROM internal.project_permissions_for(r.project_id,p_actor_user_id)))',permission));
    EXECUTE definition;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.assert_signature_target(uuid,text,text)'::regprocedure);
  anchor:='IF p_meaning IN(''reviewed'',''reviewed-and-approved'') THEN';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Signing meaning guard anchor missing'; END IF;
  EXECUTE replace(definition,anchor,anchor||E'\n IF NOT internal.can_access_object(''submission'',p_submission,''review'') THEN RAISE EXCEPTION ''Explicit Review rule required'' USING ERRCODE=''42501''; END IF;');
  definition:=pg_get_functiondef('internal.lock_review_for_decision(uuid,text,text,text)'::regprocedure);
  anchor:='WHERE id = v_submission.record_id;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Review decision ownership anchor missing'; END IF;
  EXECUTE replace(definition,anchor,anchor||E'\n PERFORM internal.assert_object_access(''record'',v_submission.record_id,CASE WHEN p_required_decision=''withdraw'' THEN ''edit'' ELSE ''review'' END);');
END $$;
--> statement-breakpoint
-- Portal rules are a distinct grant. They never make client viewers internal
-- readers, and all approved/share/client checks in the existing RPCs remain.
DO $$ DECLARE signature text; definition text; anchor text;
BEGIN
  FOREACH signature IN ARRAY ARRAY['api.client_portal_projects()','api.client_portal_milestones(uuid)','api.client_portal_records()','api.client_portal_reports()','api.client_portal_record_document(uuid)'] LOOP
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:=CASE WHEN signature IN ('api.client_portal_projects()','api.client_portal_milestones(uuid)') THEN 'AND p.auto_share_to_client' ELSE 'AND p.workspace_id = api.current_workspace_id()' END;
    IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Portal project guard anchor missing: %',signature; END IF;
    EXECUTE replace(definition,anchor,anchor||' AND internal.can_portal_project(p.id)');
  END LOOP;
  definition:=pg_get_functiondef('api.client_portal_messages(uuid)'::regprocedure);
  anchor:='AND m.workspace_id = api.current_workspace_id()';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Portal message guard anchor missing'; END IF;
  EXECUTE replace(definition,anchor,anchor||' AND (m.project_id IS NULL OR internal.can_view_project(m.project_id) OR internal.can_portal_project(m.project_id))');
  definition:=pg_get_functiondef('api.post_client_portal_message(uuid,uuid,text)'::regprocedure);
  anchor:='INSERT INTO api.client_portal_messages(';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Portal message mutation anchor missing'; END IF;
  EXECUTE replace(definition,anchor,E'IF p_project_id IS NOT NULL AND NOT (CASE WHEN v_kind=''client'' THEN internal.can_portal_project(p_project_id) ELSE internal.can_edit_project(p_project_id) END) THEN RAISE EXCEPTION ''Explicit project rule required'' USING ERRCODE=''42501''; END IF;\n'||anchor);
END $$;
CREATE POLICY portal_messages_live_read ON api.client_portal_messages AS RESTRICTIVE FOR SELECT TO authenticated USING(project_id IS NULL OR internal.can_view_project(project_id) OR internal.can_portal_project(project_id));
NOTIFY pgrst,'reload schema';
