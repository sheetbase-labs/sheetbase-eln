-- Publishing a pipeline version needs an admin's approval (Pipelines board:
-- "Publish v5… asks an admin to approve"). A person with `pipelines.manage`
-- asks with `request_pipeline_publish`; an admin or owner approves with the
-- generic `approve_approval_request`, and the approval itself publishes the
-- version the request was made for. There is no direct publish any more.
-- Deciding stays with a person in the app (attestation): it is not offered to
-- tokens, MCP or pipelines.


CREATE FUNCTION internal.publish_pipeline_definition_version(p_version_id uuid, p_expected_revision bigint, p_published_by text) RETURNS api.pipeline_definition_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.pipeline_definition_versions;
  v_definition api.pipeline_definitions;
  v_errors jsonb;
BEGIN
  SELECT * INTO v_version FROM api.pipeline_definition_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  SELECT * INTO v_definition FROM api.pipeline_definitions WHERE id = v_version.definition_id FOR UPDATE;
  IF v_definition.lifecycle <> 'active' OR v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only active Definition drafts may be published' USING ERRCODE = 'SB072';
  END IF;
  IF p_expected_revision IS DISTINCT FROM v_version.revision THEN
    RAISE EXCEPTION 'stale Pipeline version revision' USING ERRCODE = 'SB001';
  END IF;
  v_errors := api.pipeline_config_errors(v_version.configuration);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}') USING ERRCODE = 'SB070';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    lifecycle = 'published',
    revision = revision + 1,
    published_at = now(),
    published_by_user_id = p_published_by,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint
ALTER FUNCTION internal.publish_pipeline_definition_version(uuid, bigint, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION internal.publish_pipeline_definition_version(uuid, bigint, text) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.submit_approval_request(p_workspace_id uuid, p_object_kind text, p_object_id uuid, p_required_approver_roles text[], p_reason text, p_require_independence boolean DEFAULT true, p_required_approvals integer DEFAULT 1, p_object_revision bigint DEFAULT NULL::bigint) RETURNS api.approval_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
DECLARE
  v_actor text := api.current_user_id();
  v_roles text[];
  v_row api.approval_requests;
  v_version api.dataset_schema_versions;
  v_model_version api.record_model_versions;
  v_protocol_version api.protocol_versions;
  v_workspace uuid;
  v_pipeline_version api.pipeline_definition_versions;
  v_pipeline_definition api.pipeline_definitions;
  v_errors jsonb;
  v_other_approver boolean;
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
    IF NOT coalesce(p_require_independence, true) OR p_required_approvals < cardinality(v_roles) THEN
      RAISE EXCEPTION 'Record Model approval requires independence and coverage of every named role' USING ERRCODE = '22023';
    END IF;
    p_object_revision := v_model_version.revision;
  ELSIF p_object_kind = 'protocol_revision' THEN
    SELECT * INTO v_protocol_version FROM api.protocol_versions WHERE id = p_object_id FOR UPDATE;
    IF v_protocol_version.id IS NULL OR v_protocol_version.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'approval object not found' USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(v_protocol_version.workspace_id, 'record.create');
    IF v_protocol_version.status <> 'in_review' THEN
      RAISE EXCEPTION 'only in-review protocol versions may be submitted' USING ERRCODE = 'SB072';
    END IF;
    -- The approval chain is fixed: author, technical review, QA. Callers cannot
    -- weaken the roles, the independence rule or the required count.
    IF v_roles IS DISTINCT FROM ARRAY['admin','owner','reviewer','scientist','steward']::text[]
      OR NOT coalesce(p_require_independence, true) OR p_required_approvals < 2 THEN
      RAISE EXCEPTION 'protocol approval requires the canonical chain' USING ERRCODE = '22023';
    END IF;
    p_object_revision := NULL;
  ELSIF p_object_kind = 'pipeline_definition_version' THEN
    SELECT * INTO v_pipeline_version FROM api.pipeline_definition_versions WHERE id = p_object_id FOR UPDATE;
    IF v_pipeline_version.id IS NULL OR v_pipeline_version.workspace_id IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'approval object not found' USING ERRCODE = '42501';
    END IF;
    PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
    SELECT * INTO v_pipeline_definition FROM api.pipeline_definitions WHERE id = v_pipeline_version.definition_id;
    IF v_pipeline_definition.lifecycle <> 'active' OR v_pipeline_version.lifecycle <> 'draft' THEN
      RAISE EXCEPTION 'only active Definition drafts may be published' USING ERRCODE = 'SB072';
    END IF;
    v_errors := api.pipeline_config_errors(v_pipeline_version.configuration);
    IF jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}') USING ERRCODE = 'SB070';
    END IF;
    -- An admin approves a publish; callers cannot name other roles or counts.
    IF v_roles IS DISTINCT FROM ARRAY['admin','owner']::text[] OR p_required_approvals <> 1 THEN
      RAISE EXCEPTION 'publishing a pipeline needs one admin or owner to approve' USING ERRCODE = '22023';
    END IF;
    -- A second person approves. A lab with a single admin or owner (the person
    -- asking) would be stuck, so that person may approve their own request.
    SELECT EXISTS (SELECT 1 FROM api.workspace_memberships m
      WHERE m.workspace_id = p_workspace_id AND m.role IN ('admin','owner')
        AND m.suspended_at IS NULL AND m.user_id <> v_actor) INTO v_other_approver;
    p_require_independence := v_other_approver;
    p_object_revision := v_pipeline_version.revision;
  END IF;
  INSERT INTO api.approval_requests(workspace_id, object_kind, object_id, object_revision,
    required_approver_roles, required_approvals, require_independence, state, reason, submitted_by_user_id, submitted_at)
  VALUES (p_workspace_id, p_object_kind, p_object_id, p_object_revision, v_roles, p_required_approvals,
    coalesce(p_require_independence, true), 'pending', btrim(p_reason), v_actor, clock_timestamp()) RETURNING * INTO v_row;
  RETURN v_row;
END $_$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.approve_approval_request(p_request_id uuid, p_reason text DEFAULT NULL::text) RETURNS api.approval_requests
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
  v_approved_count integer;
  v_uncovered integer;
  v_technical_done boolean;
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
  -- Protocol chain: technical review (scientist/steward) must precede QA
  -- (reviewer/admin/owner).
  IF v_row.object_kind = 'protocol_revision'
    AND v_role IN ('reviewer', 'admin', 'owner')
    AND NOT EXISTS (SELECT 1 FROM api.approval_request_decisions d
      WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role IN ('scientist', 'steward')) THEN
    RAISE EXCEPTION 'technical review must precede QA approval' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.approval_request_decisions(request_id, workspace_id, user_id, role, decision, reason)
  VALUES (v_row.id, v_row.workspace_id, v_actor, v_role, 'approved', nullif(btrim(coalesce(p_reason, '')), ''));
  SELECT count(DISTINCT d.user_id) INTO v_approved_count
    FROM api.approval_request_decisions d WHERE d.request_id = v_row.id AND d.decision = 'approved';
  IF v_row.object_kind = 'record_model_version' THEN
    SELECT count(*) INTO v_uncovered FROM unnest(v_row.required_approver_roles) AS required_role
     WHERE NOT EXISTS (SELECT 1 FROM api.approval_request_decisions d
        WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role = required_role);
  ELSE
    v_uncovered := 0;
  END IF;
  IF v_row.object_kind = 'protocol_revision' THEN
    SELECT EXISTS (SELECT 1 FROM api.approval_request_decisions d
      WHERE d.request_id = v_row.id AND d.decision = 'approved' AND d.role IN ('scientist', 'steward')) INTO v_technical_done;
    IF NOT v_technical_done THEN v_uncovered := 1; END IF;
  END IF;
  IF v_approved_count >= v_row.required_approvals AND v_uncovered = 0 THEN
    UPDATE api.approval_requests
       SET state = 'approved', approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor],
           decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           decided_by_user_id = v_actor, decided_at = now(), updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
    IF v_row.object_kind = 'pipeline_definition_version' THEN
      PERFORM internal.publish_pipeline_definition_version(v_row.object_id, v_row.object_revision, v_row.submitted_by_user_id);
    END IF;
  ELSE
    UPDATE api.approval_requests
       SET approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor], updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION api.update_pipeline_definition_version_draft(p_workspace_id uuid, p_version_id uuid, p_expected_revision bigint, p_configuration jsonb) RETURNS api.pipeline_definition_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_version api.pipeline_definition_versions;
  v_errors jsonb;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id THEN
    RAISE EXCEPTION 'wrong workspace' USING ERRCODE = 'SB033';
  END IF;
  PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
  SELECT * INTO v_version FROM api.pipeline_definition_versions
   WHERE id = p_version_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'pipeline definition version not found' USING ERRCODE = 'SB036';
  END IF;
  IF v_version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Pipeline versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS (SELECT 1 FROM api.approval_requests r
    WHERE r.object_kind = 'pipeline_definition_version' AND r.object_id = v_version.id AND r.state = 'pending') THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  IF v_version.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale Pipeline version revision' USING ERRCODE = 'SB001';
  END IF;
  v_errors := api.pipeline_config_errors(p_configuration);
  IF jsonb_array_length(v_errors) > 0 THEN
    RAISE EXCEPTION 'invalid pipeline configuration: %', (v_errors #>> '{}')
      USING ERRCODE = 'SB070';
  END IF;
  UPDATE api.pipeline_definition_versions SET
    configuration = p_configuration,
    revision = revision + 1,
    updated_at = now(),
    updated_by_user_id = api.current_user_id()
  WHERE id = v_version.id
  RETURNING * INTO v_version;
  RETURN v_version;
END $$;
--> statement-breakpoint

DROP FUNCTION api.publish_pipeline_definition_version(uuid, uuid);
--> statement-breakpoint

CREATE FUNCTION api.request_pipeline_publish(p_workspace_id uuid, p_version_id uuid, p_reason text) RETURNS api.approval_requests
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT * FROM api.submit_approval_request(
    p_workspace_id, 'pipeline_definition_version', p_version_id,
    ARRAY['admin','owner']::text[], p_reason, true, 1, NULL);
$$;
--> statement-breakpoint
ALTER FUNCTION api.request_pipeline_publish(uuid, uuid, text) OWNER TO migrator;
--> statement-breakpoint
REVOKE ALL ON FUNCTION api.request_pipeline_publish(uuid, uuid, text) FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON FUNCTION api.request_pipeline_publish(uuid, uuid, text) TO authenticated;
--> statement-breakpoint
COMMENT ON FUNCTION api.request_pipeline_publish(uuid, uuid, text) IS 'Asks an admin or owner to approve publishing a checked draft pipeline version; the approval publishes it.';
