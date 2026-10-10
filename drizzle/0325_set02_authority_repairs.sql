-- Authorize identity rows from their parent columns, not a STABLE lookup of
-- the new id. INSERT RETURNING applies SELECT RLS before that id is visible
-- to the statement snapshot. Existing writer/workspace policies still apply.
DROP POLICY set02_live_read ON api.datasets;
CREATE POLICY set02_live_read ON api.datasets AS RESTRICTIVE FOR SELECT TO authenticated,api_client
  USING(workspace_id=api.current_workspace_id() AND CASE
    WHEN primary_project_id IS NULL THEN api.claim_probe()->>'role'='authenticated' AND api.is_workspace_member(workspace_id)
    ELSE internal.can_view_project(primary_project_id) END);
--> statement-breakpoint

-- A Dataset is a structured identity, not a records FK. Resolve its stable
-- display id only in the source workspace, and never let an unrelated record
-- FK stand in for a Dataset grant. Record-backed identities likewise match
-- kind + identifier + any supplied FK before checking their current View.
CREATE FUNCTION internal.can_read_record_link_target(p_source_record_id uuid,p_target_kind text,p_target_identifier text,p_target_record_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT CASE WHEN p_target_kind='dataset' THEN
    p_target_record_id IS NULL AND EXISTS(
      SELECT 1 FROM api.datasets d JOIN api.records s ON s.workspace_id=d.workspace_id
      WHERE s.id=p_source_record_id AND d.display_id=p_target_identifier
        AND internal.can_access_object('dataset',d.id,'view'))
  ELSE EXISTS(
    SELECT 1 FROM api.records t JOIN api.records s ON s.workspace_id=t.workspace_id
    WHERE s.id=p_source_record_id AND t.kind=p_target_kind AND t.identifier=p_target_identifier
      AND (p_target_record_id IS NULL OR t.id=p_target_record_id)
      AND internal.can_access_object('record',t.id,'view')) END
$$;
REVOKE ALL ON FUNCTION internal.can_read_record_link_target(uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION internal.can_read_record_link_target(uuid,text,text,uuid) TO authenticated,api_client;
DROP POLICY record_links_target_write ON api.record_links;
CREATE POLICY record_links_target_write ON api.record_links AS RESTRICTIVE FOR ALL TO authenticated,api_client
  USING(internal.can_read_record_link_target(source_record_id,target_kind,target_identifier,target_record_id))
  WITH CHECK(internal.can_read_record_link_target(source_record_id,target_kind,target_identifier,target_record_id));
--> statement-breakpoint

-- Lossless collaborator presentation uses the same effective flag union as
-- authorization. Preserve every existing column and keep legacy access_level
-- as display only. No role, lead or management label implies another flag.
DROP FUNCTION api.project_members(uuid);
CREATE FUNCTION api.project_members(p_project_id uuid)
RETURNS TABLE(user_id text,name text,access_level text,workspace_role text,is_lead boolean,added_at timestamptz,
  can_view boolean,can_edit boolean,can_review boolean,client_portal boolean,can_manage boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT m.user_id,u.name,CASE WHEN q.can_manage THEN 'owner' WHEN q.can_edit THEN 'editor' WHEN q.can_review THEN 'reviewer' ELSE 'viewer' END,m.role,p.lead_user_id=m.user_id,
    (SELECT min(a.created_at) FROM api.project_access a WHERE a.project_id=p.id AND (a.user_id=m.user_id OR EXISTS(SELECT 1 FROM api.workspace_group_memberships g WHERE g.group_id=a.group_id AND g.user_id=m.user_id))),
    q.can_view,q.can_edit,q.can_review,q.client_portal,q.can_manage
  FROM api.projects p JOIN api.workspace_memberships m ON m.workspace_id=p.workspace_id AND m.suspended_at IS NULL
  JOIN internal."user" u ON u.id=m.user_id CROSS JOIN LATERAL internal.project_permissions_for(p.id,m.user_id) q
  WHERE p.id=p_project_id AND internal.can_view_project(p.id) AND q.can_view
  ORDER BY (p.lead_user_id=m.user_id) DESC,u.name
$$;
REVOKE ALL ON FUNCTION api.project_members(uuid) FROM PUBLIC,anon,api_client;
GRANT EXECUTE ON FUNCTION api.project_members(uuid) TO authenticated;
--> statement-breakpoint

-- Request eligibility needs independent live View before creating or replaying
-- a witness request. The request never grants View, Edit or Review itself.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('api.request_signature_witness(uuid,text,text,timestamptz)'::regprocedure);
  anchor:='SELECT * INTO q FROM api.signature_witness_requests WHERE submission_id=s.id AND witness_user_id=p_witness_user_id;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Witness request eligibility anchor missing'; END IF;
  EXECUTE replace(definition,anchor,E'IF NOT internal.can_access_object(''record'',s.record_id,''view'') OR NOT (SELECT permissions.can_view FROM api.records record CROSS JOIN LATERAL internal.project_permissions_for(record.project_id,p_witness_user_id) permissions WHERE record.id=s.record_id) THEN RAISE EXCEPTION ''Witness requires current project View'' USING ERRCODE=''42501''; END IF;\n  '||anchor);
END $$;
--> statement-breakpoint

-- Formula runtime has no request JWT. Its canonical writer creates an
-- ungranted transaction-local capability only after validating the human
-- actor and live Edit union. Recheck that same actor in the shared writable
-- gate. All archive/deletion/lock checks below that gate remain unchanged.
DO $$ DECLARE definition text; anchor text;
BEGIN
  definition:=pg_get_functiondef('internal.assert_scientific_record_writable(uuid)'::regprocedure);
  anchor:='IF session_user<>''migrator'' THEN PERFORM internal.assert_object_access(''table'',p_table_id,''edit''); END IF;';
  IF strpos(definition,anchor)=0 THEN RAISE EXCEPTION 'Scientific writable authority anchor missing'; END IF;
  EXECUTE replace(definition,anchor,E'IF session_user<>''migrator'' AND NOT EXISTS(SELECT 1 FROM internal.formula_row_capability capability JOIN api.scientific_tables scientific ON scientific.id=capability.table_id JOIN api.records record ON record.id=scientific.record_id CROSS JOIN LATERAL internal.project_permissions_for(record.project_id,capability.actor_user_id) permissions WHERE capability.tx=txid_current() AND capability.table_id=p_table_id AND permissions.can_edit) THEN PERFORM internal.assert_object_access(''table'',p_table_id,''edit''); END IF;');
END $$;
NOTIFY pgrst,'reload schema';
