CREATE TABLE "api"."approval_request_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_approval_request_decisions_decision" CHECK ("api"."approval_request_decisions"."decision" IN ('approved','returned'))
);
--> statement-breakpoint
CREATE TABLE "api"."approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"object_kind" text NOT NULL,
	"object_id" uuid NOT NULL,
	"object_revision" bigint,
	"required_approver_roles" text[] DEFAULT '{}' NOT NULL,
	"required_approvals" integer DEFAULT 1 NOT NULL,
	"require_independence" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decision_reason" text,
	"approved_by_user_ids" text[] DEFAULT '{}' NOT NULL,
	"submitted_by_user_id" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_approval_requests_state" CHECK ("api"."approval_requests"."state" IN ('pending','approved','returned','withdrawn')),
	CONSTRAINT "chk_approval_requests_kind" CHECK ("api"."approval_requests"."object_kind" ~ '^[a-z][a-z0-9_]{0,63}$'),
	CONSTRAINT "chk_approval_requests_required_approvals" CHECK ("api"."approval_requests"."required_approvals" >= 1),
	CONSTRAINT "chk_approval_requests_roles" CHECK ("api"."approval_requests"."required_approver_roles" <@ ARRAY['owner','admin','member','steward','scientist','analyst','reviewer','viewer']::text[])
);
--> statement-breakpoint
ALTER TABLE "api"."approval_request_decisions" ADD CONSTRAINT "approval_request_decisions_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "api"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."approval_request_decisions" ADD CONSTRAINT "approval_request_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."approval_request_decisions" ADD CONSTRAINT "approval_request_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "internal"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."approval_requests" ADD CONSTRAINT "approval_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."approval_requests" ADD CONSTRAINT "approval_requests_submitted_by_user_id_user_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."approval_requests" ADD CONSTRAINT "approval_requests_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_approval_request_decisions_request" ON "api"."approval_request_decisions" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_workspace" ON "api"."approval_requests" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_approval_requests_object" ON "api"."approval_requests" USING btree ("object_kind","object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_approval_requests_pending_object" ON "api"."approval_requests" USING btree ("object_kind","object_id") WHERE "api"."approval_requests"."state" = 'pending';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- MDL-03.1/03.2 — reusable approval requests and approval-gated publication.
--
-- One generic request/decision store serves model versions, parsers, protocols
-- and promotions. RLS lets workspace members read; only the SECURITY DEFINER
-- RPCs mutate, and only a member whose role is in the required approver roles
-- may approve or return. When independence is required the submitter cannot
-- decide their own request.
-- ---------------------------------------------------------------------------
ALTER TABLE "api"."approval_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "api"."approval_request_decisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON "api"."approval_requests" FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
REVOKE ALL ON "api"."approval_request_decisions" FROM PUBLIC, anon, authenticated, api_client;
--> statement-breakpoint
GRANT SELECT ON "api"."approval_requests" TO authenticated;
--> statement-breakpoint
GRANT SELECT ON "api"."approval_request_decisions" TO authenticated;
--> statement-breakpoint
CREATE POLICY "approval_requests_select" ON "api"."approval_requests"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));
--> statement-breakpoint
CREATE POLICY "approval_request_decisions_select" ON "api"."approval_request_decisions"
  FOR SELECT TO authenticated
  USING ("workspace_id" = "api"."current_workspace_id"() AND "api"."is_workspace_member"("workspace_id"));
--> statement-breakpoint
CREATE TRIGGER "set_updated_at" BEFORE UPDATE ON "api"."approval_requests"
  FOR EACH ROW EXECUTE FUNCTION "internal"."set_updated_at"();
--> statement-breakpoint

-- Publish blocker: NULL when publication is allowed, otherwise a reason.
-- No request at all keeps the legacy publish path; once a request exists the
-- latest must be `approved` and no newer `pending` request may be open.
CREATE OR REPLACE FUNCTION "internal"."approval_publish_blocker"(
  p_object_kind text, p_object_id uuid
) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM api.approval_requests r
       WHERE r.object_kind = p_object_kind AND r.object_id = p_object_id
         AND r.state = 'pending'
    ) THEN 'approval pending'
    WHEN EXISTS (
      SELECT 1 FROM api.approval_requests r
       WHERE r.object_kind = p_object_kind AND r.object_id = p_object_id
    ) AND NOT EXISTS (
      SELECT 1 FROM api.approval_requests r
       WHERE r.object_kind = p_object_kind AND r.object_id = p_object_id
         AND r.state = 'approved'
    ) THEN 'approval required'
    ELSE NULL
  END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION "internal"."approval_publish_blocker"(text, uuid)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.submit_approval_request(
  p_workspace_id uuid,
  p_object_kind text,
  p_object_id uuid,
  p_required_approver_roles text[],
  p_reason text,
  p_require_independence boolean DEFAULT true,
  p_required_approvals integer DEFAULT 1,
  p_object_revision bigint DEFAULT NULL
) RETURNS api.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor text := api.current_user_id();
  v_roles text[];
  v_row api.approval_requests;
BEGIN
  IF v_actor IS NULL
     OR api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.is_workspace_writer(p_workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF p_object_kind IS NULL OR p_object_kind !~ '^[a-z][a-z0-9_]{0,63}$'
     OR p_object_id IS NULL THEN
    RAISE EXCEPTION 'invalid approval object' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'an approval reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(role ORDER BY role) INTO v_roles
    FROM (
      SELECT DISTINCT unnest(coalesce(p_required_approver_roles, '{}'::text[])) AS role
    ) roles
   WHERE role IS NOT NULL AND role <> '';
  IF coalesce(cardinality(v_roles), 0) = 0
     OR NOT (v_roles <@ ARRAY['owner','admin','member','steward','scientist','analyst','reviewer','viewer']::text[]) THEN
    RAISE EXCEPTION 'invalid approver roles' USING ERRCODE = '22023';
  END IF;
  IF p_required_approvals IS NULL
     OR p_required_approvals < 1
     OR p_required_approvals > 10 THEN
    RAISE EXCEPTION 'invalid required approval count' USING ERRCODE = '22023';
  END IF;
  INSERT INTO api.approval_requests(
    workspace_id, object_kind, object_id, object_revision,
    required_approver_roles, required_approvals, require_independence,
    state, reason, submitted_by_user_id, submitted_at
  ) VALUES (
    p_workspace_id, p_object_kind, p_object_id, p_object_revision,
    v_roles, p_required_approvals, coalesce(p_require_independence, true),
    'pending', btrim(p_reason), v_actor, now()
  ) RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.withdraw_approval_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
) RETURNS api.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
BEGIN
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL
     OR v_actor IS NULL
     OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.submitted_by_user_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'only the submitter may withdraw' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be withdrawn' USING ERRCODE = 'SB086';
  END IF;
  UPDATE api.approval_requests
     SET state = 'withdrawn',
         decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
         decided_by_user_id = v_actor,
         decided_at = now(),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.approve_approval_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
) RETURNS api.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
  v_approved_count integer;
BEGIN
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL
     OR v_actor IS NULL
     OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be approved' USING ERRCODE = 'SB086';
  END IF;
  SELECT m.role INTO v_role
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v_row.workspace_id
     AND m.user_id = v_actor
     AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY(v_row.required_approver_roles)) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.require_independence
     AND v_row.submitted_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'an approver cannot approve their own submission' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.approval_request_decisions d
     WHERE d.request_id = v_row.id
       AND d.user_id = v_actor
       AND d.decision = 'approved'
  ) THEN
    RAISE EXCEPTION 'already approved by this approver' USING ERRCODE = 'SB086';
  END IF;
  INSERT INTO api.approval_request_decisions(
    request_id, workspace_id, user_id, role, decision, reason
  ) VALUES (
    v_row.id, v_row.workspace_id, v_actor, v_role, 'approved',
    nullif(btrim(coalesce(p_reason, '')), '')
  );
  SELECT count(DISTINCT d.user_id) INTO v_approved_count
    FROM api.approval_request_decisions d
   WHERE d.request_id = v_row.id AND d.decision = 'approved';
  IF v_approved_count >= v_row.required_approvals THEN
    UPDATE api.approval_requests
       SET state = 'approved',
           approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor],
           decision_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           decided_by_user_id = v_actor,
           decided_at = now(),
           updated_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    UPDATE api.approval_requests
       SET approved_by_user_ids = v_row.approved_by_user_ids || ARRAY[v_actor],
           updated_at = now()
     WHERE id = v_row.id
    RETURNING * INTO v_row;
  END IF;
  RETURN v_row;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.return_approval_request(
  p_request_id uuid,
  p_reason text
) RETURNS api.approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_row api.approval_requests;
  v_actor text := api.current_user_id();
  v_role text;
BEGIN
  SELECT * INTO v_row FROM api.approval_requests WHERE id = p_request_id FOR UPDATE;
  IF v_row.id IS NULL
     OR v_actor IS NULL
     OR NOT api.is_workspace_writer(v_row.workspace_id) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.state <> 'pending' THEN
    RAISE EXCEPTION 'only pending approvals may be returned' USING ERRCODE = 'SB086';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'a return reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT m.role INTO v_role
    FROM api.workspace_memberships m
   WHERE m.workspace_id = v_row.workspace_id
     AND m.user_id = v_actor
     AND m.suspended_at IS NULL;
  IF v_role IS NULL OR NOT (v_role = ANY(v_row.required_approver_roles)) THEN
    RAISE EXCEPTION 'approval denied' USING ERRCODE = '42501';
  END IF;
  IF v_row.require_independence
     AND v_row.submitted_by_user_id IS NOT DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'an approver cannot return their own submission' USING ERRCODE = '42501';
  END IF;
  INSERT INTO api.approval_request_decisions(
    request_id, workspace_id, user_id, role, decision, reason
  ) VALUES (
    v_row.id, v_row.workspace_id, v_actor, v_role, 'returned', btrim(p_reason)
  );
  UPDATE api.approval_requests
     SET state = 'returned',
         decision_reason = btrim(p_reason),
         decided_by_user_id = v_actor,
         decided_at = now(),
         updated_at = now()
   WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION
  api.submit_approval_request(uuid, text, uuid, text[], text, boolean, integer, bigint),
  api.withdraw_approval_request(uuid, text),
  api.approve_approval_request(uuid, text),
  api.return_approval_request(uuid, text)
  FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  api.submit_approval_request(uuid, text, uuid, text[], text, boolean, integer, bigint),
  api.withdraw_approval_request(uuid, text),
  api.approve_approval_request(uuid, text),
  api.return_approval_request(uuid, text)
  TO authenticated;
--> statement-breakpoint

-- Approval-gated publication. The publish path keeps every existing rule and
-- gains the completed-approval gate; a pending request also locks the draft.
CREATE OR REPLACE FUNCTION api.replace_dataset_schema_version_fields(
  p_schema_version_id uuid,
  p_fields jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  SELECT s.workspace_id INTO workspace
    FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace, 'schema.edit');
  IF version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be updated' USING ERRCODE = 'SB072';
  END IF;
  IF EXISTS (
    SELECT 1 FROM api.approval_requests r
     WHERE r.object_kind = 'dataset_schema_version'
       AND r.object_id = version.id
       AND r.state = 'pending'
  ) THEN
    RAISE EXCEPTION 'draft is locked while approval is pending' USING ERRCODE = 'SB085';
  END IF;
  PERFORM internal.replace_dataset_schema_version_fields(version.id, p_fields);
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.publish_dataset_schema_version(p_schema_version_id uuid)
RETURNS api.dataset_schema_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  version api.dataset_schema_versions;
  workspace uuid;
  v_block text;
BEGIN
  SELECT * INTO version FROM api.dataset_schema_versions WHERE id = p_schema_version_id FOR UPDATE;
  SELECT s.workspace_id INTO workspace
    FROM api.dataset_schema_definitions s WHERE s.id = version.schema_id;
  IF version.id IS NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version not found' USING ERRCODE = '42501';
  END IF;
  PERFORM api.require_capability(workspace, 'schema.publish');
  IF version.lifecycle <> 'draft' THEN
    RAISE EXCEPTION 'only draft Dataset Schema Versions may be published' USING ERRCODE = 'SB072';
  END IF;
  v_block := internal.approval_publish_blocker('dataset_schema_version', version.id);
  IF v_block IS NOT NULL THEN
    RAISE EXCEPTION 'Dataset Schema Version cannot be published: %', v_block
      USING ERRCODE = 'SB084';
  END IF;
  UPDATE api.dataset_schema_versions
     SET lifecycle = 'active', published_at = now(), updated_at = now()
   WHERE id = version.id
  RETURNING * INTO version;
  UPDATE api.dataset_schema_definitions
     SET lifecycle = 'active', updated_at = now()
   WHERE id = version.schema_id AND lifecycle = 'draft';
  RETURN version;
END;
$$;
--> statement-breakpoint

-- WORK-01.4: surface a pending approval to each required approver role. The
-- view stays security-invoker, so the caller's approval_requests RLS applies.
CREATE OR REPLACE VIEW api.my_work_items
WITH (security_invoker = true)
AS
SELECT
  'review_requested'::text AS kind,
  r.id AS record_id,
  r.identifier AS identifier,
  r.title AS title,
  r.project_id AS project_id,
  'Review requested'::text AS reason,
  NULL::timestamptz AS due_at,
  'needs_action'::text AS state,
  rs.submitted_at AS created_at
FROM api.review_submissions rs
JOIN api.records r ON r.id = rs.record_id
WHERE rs.state = 'submitted'
  AND api.current_user_id() = ANY (rs.assigned_reviewer_user_ids)

UNION ALL

SELECT
  'run_failed'::text,
  NULL::uuid,
  pd.key,
  pd.name,
  NULL::uuid,
  coalesce(pr.error_message, 'Pipeline run failed'),
  NULL::timestamptz,
  'needs_action'::text,
  pr.finished_at
FROM api.pipeline_runs pr
JOIN api.pipeline_definition_versions pdv ON pdv.id = pr.definition_version_id
JOIN api.pipeline_definitions pd ON pd.id = pdv.definition_id
WHERE pr.status = 'failed'
  AND pd.created_by_user_id = api.current_user_id()

UNION ALL

SELECT
  'data_issue'::text,
  NULL::uuid,
  d.display_id,
  d.name,
  d.primary_project_id,
  'Flagged: ' || f.reason,
  NULL::timestamptz,
  'needs_action'::text,
  f.set_at
FROM api.dataset_value_flags f
JOIN api.datasets d ON d.id = f.dataset_id
WHERE f.cleared_at IS NULL
  AND d.created_by_user_id = api.current_user_id()

UNION ALL

SELECT
  'material_expiring'::text,
  r.id,
  r.identifier,
  r.title,
  r.project_id,
  'Expires ' || (r.properties ->> 'expiry'),
  (r.properties ->> 'expiry')::timestamptz,
  'needs_action'::text,
  r.created_at
FROM api.records r
WHERE r.kind = 'reagent'
  AND r.deleted_at IS NULL
  AND r.archived_at IS NULL
  AND r.created_by_user_id = api.current_user_id()
  AND r.properties ? 'expiry'
  AND (r.properties ->> 'expiry')::date <= (now() + interval '30 days')::date
  AND coalesce(r.properties ->> 'status', '') <> 'quarantined'

UNION ALL

SELECT
  'following'::text,
  r.id,
  r.identifier,
  r.title,
  r.project_id,
  'Following'::text,
  NULL::timestamptz,
  'following'::text,
  wf.created_at
FROM api.work_item_follows wf
JOIN api.records r ON r.id = wf.record_id
WHERE wf.user_id = api.current_user_id()
  AND NOT EXISTS (
    SELECT 1 FROM api.review_submissions rs
    WHERE rs.record_id = wf.record_id
      AND rs.state = 'submitted'
      AND api.current_user_id() = ANY (rs.assigned_reviewer_user_ids)
  )

UNION ALL

SELECT
  'approval_requested'::text,
  NULL::uuid,
  ar.object_kind,
  initcap(replace(ar.object_kind, '_', ' ')),
  NULL::uuid,
  coalesce(nullif(btrim(ar.reason), ''), 'Awaiting approval'),
  NULL::timestamptz,
  'needs_action'::text,
  ar.submitted_at
FROM api.approval_requests ar
JOIN api.workspace_memberships wm
  ON wm.workspace_id = ar.workspace_id
 AND wm.user_id = api.current_user_id()
 AND wm.suspended_at IS NULL
WHERE ar.state = 'pending'
  AND wm.role = ANY (ar.required_approver_roles)
  AND (NOT ar.require_independence
       OR ar.submitted_by_user_id IS DISTINCT FROM api.current_user_id());
--> statement-breakpoint
REVOKE ALL ON api.my_work_items FROM PUBLIC, anon, api_client;
--> statement-breakpoint
GRANT SELECT ON api.my_work_items TO authenticated;
--> statement-breakpoint
NOTIFY pgrst, 'reload schema';