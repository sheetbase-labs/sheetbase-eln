-- MDL-03: policy gates the existing canonical Dataset Schema publication path.
CREATE OR REPLACE FUNCTION api.update_workspace_publication_policy(
  p_workspace_id uuid, p_required boolean
) RETURNS api.workspace_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v api.workspace_settings;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'not a member of target workspace' USING ERRCODE = 'SB033';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.workspace_memberships m
    WHERE m.workspace_id=p_workspace_id AND m.user_id=api.current_user_id()
      AND m.suspended_at IS NULL AND m.role IN ('owner','admin')) THEN
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
REVOKE ALL ON FUNCTION api.update_workspace_publication_policy(uuid,boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION api.update_workspace_publication_policy(uuid,boolean) TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.approval_publish_blocker(p_object_kind text,p_object_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH target AS (
    SELECT d.workspace_id,v.revision FROM api.dataset_schema_versions v
      JOIN api.dataset_schema_definitions d ON d.id=v.schema_id
      WHERE p_object_kind='dataset_schema_version' AND v.id=p_object_id
  ), latest AS (
    SELECT r.* FROM api.approval_requests r JOIN target t ON t.workspace_id=r.workspace_id
      WHERE r.object_kind=p_object_kind AND r.object_id=p_object_id
      ORDER BY r.submitted_at DESC,r.id DESC LIMIT 1
  )
  SELECT CASE
    WHEN r.state='pending' THEN 'approval pending'
    WHEN r.id IS NOT NULL AND (r.state<>'approved' OR r.object_revision IS DISTINCT FROM t.revision)
      THEN 'approval required for current revision'
    WHEN r.id IS NULL AND coalesce(s.publication_approval_required,false) THEN 'approval required'
    ELSE NULL END
  FROM target t LEFT JOIN latest r ON true
    LEFT JOIN api.workspace_settings s ON s.workspace_id=t.workspace_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.submit_approval_request(
  p_workspace_id uuid,p_object_kind text,p_object_id uuid,p_required_approver_roles text[],
  p_reason text,p_require_independence boolean DEFAULT true,p_required_approvals integer DEFAULT 1,
  p_object_revision bigint DEFAULT NULL
) RETURNS api.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_roles text[];
  v_row api.approval_requests;
  v_version api.dataset_schema_versions;
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
    SELECT DISTINCT unnest(coalesce(p_required_approver_roles,'{}'::text[])) AS role
  ) roles WHERE role IS NOT NULL AND role<>'';
  IF coalesce(cardinality(v_roles),0)=0 OR NOT (v_roles <@ ARRAY['owner','admin','member','steward','scientist','analyst','reviewer','viewer']::text[]) THEN
    RAISE EXCEPTION 'invalid approver roles' USING ERRCODE = '22023';
  END IF;
  IF p_required_approvals IS NULL OR p_required_approvals<1 OR p_required_approvals>10 THEN
    RAISE EXCEPTION 'invalid required approval count' USING ERRCODE = '22023';
  END IF;
  IF p_object_kind='dataset_schema_version' THEN
    SELECT * INTO v_version FROM api.dataset_schema_versions WHERE id=p_object_id FOR UPDATE;
    SELECT workspace_id INTO v_workspace FROM api.dataset_schema_definitions WHERE id=v_version.schema_id;
    IF v_version.id IS NULL OR v_workspace IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'approval object not found' USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(v_workspace,'schema.edit');
    IF v_version.lifecycle<>'draft' THEN
      RAISE EXCEPTION 'only draft versions may be submitted' USING ERRCODE = 'SB072';
    END IF;
    IF p_object_revision IS NOT NULL AND p_object_revision IS DISTINCT FROM v_version.revision THEN
      RAISE EXCEPTION 'stale Dataset Schema Version revision' USING ERRCODE = 'SB001';
    END IF;
    p_object_revision := v_version.revision;
  END IF;
  INSERT INTO api.approval_requests(workspace_id,object_kind,object_id,object_revision,
    required_approver_roles,required_approvals,require_independence,state,reason,submitted_by_user_id,submitted_at)
  VALUES(p_workspace_id,p_object_kind,p_object_id,p_object_revision,v_roles,p_required_approvals,
    coalesce(p_require_independence,true),'pending',btrim(p_reason),v_actor,clock_timestamp()) RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.replace_dataset_schema_version_fields(p_schema_version_id uuid,p_fields jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE version api.dataset_schema_versions; workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id=p_schema_version_id FOR UPDATE;
  SELECT s.workspace_id INTO workspace FROM api.dataset_schema_definitions s WHERE s.id=version.schema_id;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace,'schema.edit');
  IF version.lifecycle<>'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS(SELECT 1 FROM api.approval_requests r WHERE r.workspace_id=workspace
    AND r.object_kind='dataset_schema_version' AND r.object_id=version.id AND r.state='pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  PERFORM internal.replace_dataset_schema_version_fields(version.id,p_fields);
  UPDATE api.dataset_schema_versions SET revision=revision+1,updated_at=now() WHERE id=version.id;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.delete_dataset_schema_version(p_schema_version_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE version api.dataset_schema_versions; workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id=p_schema_version_id FOR UPDATE;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  SELECT s.workspace_id INTO workspace FROM api.dataset_schema_definitions s WHERE s.id=version.schema_id;
  PERFORM api.require_capability(workspace,'schema.edit');
  IF version.lifecycle<>'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be discarded' USING ERRCODE = 'SB073';
  END IF;
  IF EXISTS(SELECT 1 FROM api.approval_requests r WHERE r.workspace_id=workspace
    AND r.object_kind='dataset_schema_version' AND r.object_id=version.id AND r.state='pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  DELETE FROM api.dataset_schema_versions WHERE id=version.id;
END $$;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';
