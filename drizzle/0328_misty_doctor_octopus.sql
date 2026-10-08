CREATE TABLE "api"."project_protocols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"protocol_record_id" uuid NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_project_protocols_project_protocol" UNIQUE("project_id","protocol_record_id")
);
--> statement-breakpoint
CREATE TABLE "api"."protocol_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"protocol_version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_protocol_acknowledgements_version_user" UNIQUE("protocol_version_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "api"."protocol_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"protocol_record_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"change_summary" text,
	"reason" text,
	"effective_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	CONSTRAINT "uq_protocol_versions_protocol_version" UNIQUE("protocol_record_id","version"),
	CONSTRAINT "chk_protocol_versions_status" CHECK ("api"."protocol_versions"."status" IN ('draft','in_review','effective','superseded','retired')),
	CONSTRAINT "chk_protocol_versions_version" CHECK ("api"."protocol_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "api"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_protocol_record_id_records_id_fk" FOREIGN KEY ("protocol_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "api"."protocol_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."project_protocols" ADD CONSTRAINT "project_protocols_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_acknowledgements" ADD CONSTRAINT "protocol_acknowledgements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_acknowledgements" ADD CONSTRAINT "protocol_acknowledgements_protocol_version_id_protocol_versions_id_fk" FOREIGN KEY ("protocol_version_id") REFERENCES "api"."protocol_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_acknowledgements" ADD CONSTRAINT "protocol_acknowledgements_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_versions" ADD CONSTRAINT "protocol_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_versions" ADD CONSTRAINT "protocol_versions_protocol_record_id_records_id_fk" FOREIGN KEY ("protocol_record_id") REFERENCES "api"."records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_versions" ADD CONSTRAINT "protocol_versions_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."protocol_versions" ADD CONSTRAINT "protocol_versions_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_protocols_workspace" ON "api"."project_protocols" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_protocol_acknowledgements_workspace" ON "api"."protocol_acknowledgements" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_protocol_versions_workspace" ON "api"."protocol_versions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_protocol_versions_protocol" ON "api"."protocol_versions" USING btree ("protocol_record_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- LAB-07 — controlled protocol lifecycle, training and start enforcement.
-- ---------------------------------------------------------------------------
DO $$ DECLARE expression text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO expression FROM pg_constraint
    WHERE conrelid='api.change_events'::regclass AND conname='chk_change_events_entity_type';
  IF strpos(expression,'''record_model_version''::text')=0 THEN RAISE EXCEPTION 'Unexpected event vocabulary'; END IF;
  expression:=replace(expression,'''record_model_version''::text','''record_model_version''::text, ''protocol_version''::text');
  ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
  EXECUTE 'ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type '||expression;
END $$;--> statement-breakpoint

ALTER TABLE "api"."protocol_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "api"."protocol_versions" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "api"."protocol_versions" TO authenticated;--> statement-breakpoint
CREATE POLICY "protocol_versions_select" ON "api"."protocol_versions"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

ALTER TABLE "api"."protocol_acknowledgements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "api"."protocol_acknowledgements" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "api"."protocol_acknowledgements" TO authenticated;--> statement-breakpoint
CREATE POLICY "protocol_acknowledgements_select" ON "api"."protocol_acknowledgements"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

ALTER TABLE "api"."project_protocols" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "api"."project_protocols" FROM PUBLIC, anon;--> statement-breakpoint
GRANT SELECT ON "api"."project_protocols" TO authenticated;--> statement-breakpoint
CREATE POLICY "project_protocols_select" ON "api"."project_protocols"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));--> statement-breakpoint

-- Create a frozen protocol version: the version id IS the revision id, so the
-- scientific text can never be rewritten.
CREATE OR REPLACE FUNCTION "api"."create_protocol_version"(
  p_protocol_record_id uuid, p_change_summary text, p_reason text DEFAULT NULL
) RETURNS "api"."protocol_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_protocol api.records;
  v_revision api.revisions;
  v_version api.protocol_versions;
  v_next integer;
BEGIN
  SELECT * INTO v_protocol FROM api.records WHERE id = p_protocol_record_id FOR UPDATE;
  IF v_protocol.id IS NULL OR v_protocol.workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR v_protocol.kind <> 'protocol_template' OR v_protocol.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'protocol not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_protocol.workspace_id, 'record.create');
  SELECT coalesce(max(version), 0) + 1 INTO v_next FROM api.protocol_versions WHERE protocol_record_id = v_protocol.id;
  INSERT INTO api.revisions(
    record_id, structure_version, metadata_version, metadata_snapshot, block_snapshot, reason, created_by_user_id
  )
  SELECT v_protocol.id, v_protocol.structure_version, v_protocol.metadata_version,
    jsonb_build_object('id', v_protocol.id, 'identifier', v_protocol.identifier, 'title', v_protocol.title,
      'status', v_protocol.status, 'properties', v_protocol.properties, 'tags', v_protocol.tags,
      'metadataVersion', v_protocol.metadata_version),
    coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."order") FILTER (WHERE x.id IS NOT NULL), '[]'),
    'manual', api.current_user_id()
  FROM api.blocks x WHERE x.record_id = v_protocol.id
  RETURNING * INTO v_revision;
  INSERT INTO api.protocol_versions(
    id, workspace_id, protocol_record_id, version, status, change_summary, reason, created_by_user_id, updated_by_user_id
  ) VALUES (
    v_revision.id, v_protocol.workspace_id, v_protocol.id, v_next, 'draft',
    nullif(btrim(coalesce(p_change_summary, '')), ''), nullif(btrim(coalesce(p_reason, '')), ''),
    api.current_user_id(), api.current_user_id()
  ) RETURNING * INTO v_version;
  PERFORM internal.emit_change_event(v_protocol.workspace_id, 'protocol_version', v_version.id, 'create', v_protocol.id, v_protocol.project_id,
    jsonb_build_object('protocolRecordId', v_protocol.id, 'version', v_next));
  RETURN v_version;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."create_protocol_version"(uuid, text, text) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."create_protocol_version"(uuid, text, text) TO authenticated;--> statement-breakpoint

-- Move a version through its lifecycle. Becoming effective requires a completed
-- approval and supersedes the previously effective version of the protocol.
CREATE OR REPLACE FUNCTION "api"."set_protocol_version_status"(
  p_version_id uuid, p_status text, p_reason text DEFAULT NULL, p_effective_at timestamptz DEFAULT NULL
) RETURNS "api"."protocol_versions"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version api.protocol_versions;
  v_block text;
  v_effective timestamptz;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id FOR UPDATE;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id() THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(v_version.workspace_id, 'record.create');
  IF p_status IS NULL OR p_status NOT IN ('draft','in_review','effective','superseded','retired') THEN
    RAISE EXCEPTION 'invalid protocol version status' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'effective' THEN
    v_block := internal.approval_publish_blocker('protocol_revision', v_version.id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'protocol version cannot become effective: %', v_block USING ERRCODE = 'SB084';
    END IF;
    v_effective := coalesce(p_effective_at, now());
    UPDATE api.protocol_versions
       SET status = 'superseded', updated_at = now(), updated_by_user_id = api.current_user_id()
     WHERE protocol_record_id = v_version.protocol_record_id AND status = 'effective' AND id <> v_version.id;
  ELSE
    v_effective := v_version.effective_at;
  END IF;
  UPDATE api.protocol_versions
     SET status = p_status, effective_at = v_effective,
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason),
         updated_at = now(), updated_by_user_id = api.current_user_id()
   WHERE id = v_version.id
  RETURNING * INTO v_version;
  PERFORM internal.emit_change_event(v_version.workspace_id, 'protocol_version', v_version.id, 'update', v_version.protocol_record_id, NULL,
    jsonb_build_object('protocolRecordId', v_version.protocol_record_id, 'status', p_status));
  RETURN v_version;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."set_protocol_version_status"(uuid, text, text, timestamptz) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."set_protocol_version_status"(uuid, text, text, timestamptz) TO authenticated;--> statement-breakpoint

-- Read-and-acknowledge training. Only the acting user is ever stamped.
CREATE OR REPLACE FUNCTION "api"."acknowledge_protocol_version"(p_version_id uuid)
RETURNS "api"."protocol_acknowledgements"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version api.protocol_versions;
  v_row api.protocol_acknowledgements;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id;
  IF v_version.id IS NULL OR v_version.workspace_id IS DISTINCT FROM api.current_workspace_id()
    OR NOT api.is_workspace_member(v_version.workspace_id) THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.protocol_acknowledgements(workspace_id, protocol_version_id, user_id)
  VALUES (v_version.workspace_id, v_version.id, api.current_user_id())
  ON CONFLICT (protocol_version_id, user_id) DO NOTHING;
  SELECT * INTO v_row FROM api.protocol_acknowledgements
    WHERE protocol_version_id = v_version.id AND user_id = api.current_user_id();
  RETURN v_row;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "api"."acknowledge_protocol_version"(uuid) FROM PUBLIC, anon, api_client;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "api"."acknowledge_protocol_version"(uuid) TO authenticated;--> statement-breakpoint

-- Eligibility is a lifecycle predicate. `p_required` additionally requires the
-- version to be the current effective version with a reached effective date;
-- acknowledgement is enforced only at start.
CREATE OR REPLACE FUNCTION "internal"."protocol_version_is_eligible"(p_version_id uuid, p_required boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN v.id IS NULL THEN false
    WHEN p_required THEN
      v.status = 'effective' AND v.effective_at IS NOT NULL AND v.effective_at <= now()
      AND NOT EXISTS (
        SELECT 1 FROM api.protocol_versions w
         WHERE w.protocol_record_id = v.protocol_record_id AND w.status = 'effective' AND w.version > v.version
      )
    ELSE
      v.status IN ('effective', 'superseded')
      OR EXISTS (
        SELECT 1 FROM api.approval_requests r
         WHERE r.object_kind = 'protocol_revision' AND r.object_id = v.id AND r.state = 'approved'
      )
  END
  FROM api.protocol_versions v WHERE v.id = p_version_id
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."protocol_version_is_eligible"(uuid, boolean) FROM PUBLIC, authenticated, api_client;--> statement-breakpoint

-- Start enforcement: lifecycle, exact-version acknowledgement, membership ACL
-- and the project's required exact pin.
CREATE OR REPLACE FUNCTION "internal"."assert_protocol_start_eligible"(
  p_version_id uuid, p_user_id text, p_project_id uuid
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_version api.protocol_versions;
  v_project api.projects;
  v_role text;
BEGIN
  SELECT * INTO v_version FROM api.protocol_versions WHERE id = p_version_id;
  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'protocol version not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_project FROM api.projects WHERE id = p_project_id AND workspace_id = v_version.workspace_id;
  IF v_project.id IS NULL THEN
    RAISE EXCEPTION 'project not found for protocol version' USING ERRCODE = '42501';
  END IF;
  SELECT m.role INTO v_role FROM api.workspace_memberships m
   WHERE m.workspace_id = v_version.workspace_id AND m.user_id = p_user_id AND m.suspended_at IS NULL;
  IF v_role IS NULL OR v_role = 'client_viewer' THEN
    RAISE EXCEPTION 'protocol start requires an active workspace member' USING ERRCODE = '42501';
  END IF;
  IF NOT internal.protocol_version_is_eligible(v_version.id, true) THEN
    RAISE EXCEPTION 'protocol version is not effective' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM api.protocol_acknowledgements a
    WHERE a.protocol_version_id = v_version.id AND a.user_id = p_user_id) THEN
    RAISE EXCEPTION 'protocol version not acknowledged' USING ERRCODE = '42501';
  END IF;
  IF v_project.require_effective_protocol THEN
    IF NOT EXISTS (SELECT 1 FROM api.project_protocols pp
      WHERE pp.project_id = v_project.id AND pp.protocol_record_id = v_version.protocol_record_id
        AND pp.protocol_version_id = v_version.id) THEN
      RAISE EXCEPTION 'project is not pinned to this protocol version' USING ERRCODE = '42501';
    END IF;
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "internal"."assert_protocol_start_eligible"(uuid, text, uuid) FROM PUBLIC, authenticated, api_client;--> statement-breakpoint

-- Extend the shared approval engine for protocol revisions.
CREATE OR REPLACE FUNCTION "internal"."approval_publish_blocker"(p_object_kind text, p_object_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH target AS (
    SELECT d.workspace_id, v.revision FROM api.dataset_schema_versions v
      JOIN api.dataset_schema_definitions d ON d.id = v.schema_id
      WHERE p_object_kind = 'dataset_schema_version' AND v.id = p_object_id
    UNION ALL
    SELECT m.workspace_id, v.revision FROM api.record_model_versions v
      JOIN api.record_models m ON m.id = v.model_id
      WHERE p_object_kind = 'record_model_version' AND v.id = p_object_id
    UNION ALL
    SELECT v.workspace_id, NULL::bigint FROM api.protocol_versions v
      WHERE p_object_kind = 'protocol_revision' AND v.id = p_object_id
  ), latest AS (
    SELECT r.* FROM api.approval_requests r JOIN target t ON t.workspace_id = r.workspace_id
      WHERE r.object_kind = p_object_kind AND r.object_id = p_object_id
      ORDER BY r.submitted_at DESC, r.id DESC LIMIT 1
  )
  SELECT CASE
    WHEN r.state = 'pending' THEN 'approval pending'
    WHEN r.id IS NOT NULL AND (r.state <> 'approved' OR r.object_revision IS DISTINCT FROM t.revision)
      THEN 'approval required for current revision'
    WHEN r.id IS NULL AND (p_object_kind IN ('record_model_version', 'protocol_revision') OR coalesce(s.publication_approval_required, false))
      THEN 'approval required'
    ELSE NULL END
  FROM target t LEFT JOIN latest r ON true
    LEFT JOIN api.workspace_settings s ON s.workspace_id = t.workspace_id
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."submit_approval_request"(
  p_workspace_id uuid, p_object_kind text, p_object_id uuid, p_required_approver_roles text[],
  p_reason text, p_require_independence boolean DEFAULT true, p_required_approvals integer DEFAULT 1,
  p_object_revision bigint DEFAULT NULL
) RETURNS "api"."approval_requests"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_roles text[];
  v_row api.approval_requests;
  v_version api.dataset_schema_versions;
  v_model_version api.record_model_versions;
  v_protocol_version api.protocol_versions;
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
  END IF;
  INSERT INTO api.approval_requests(workspace_id, object_kind, object_id, object_revision,
    required_approver_roles, required_approvals, require_independence, state, reason, submitted_by_user_id, submitted_at)
  VALUES (p_workspace_id, p_object_kind, p_object_id, p_object_revision, v_roles, p_required_approvals,
    coalesce(p_require_independence, true), 'pending', btrim(p_reason), v_actor, clock_timestamp()) RETURNING * INTO v_row;
  RETURN v_row;
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "api"."approve_approval_request"(p_request_id uuid, p_reason text DEFAULT NULL)
RETURNS "api"."approval_requests"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  ELSE
    UPDATE api.approval_requests
       SET approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor], updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;--> statement-breakpoint

NOTIFY pgrst, 'reload schema';