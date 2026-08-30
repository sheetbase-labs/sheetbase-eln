CREATE TABLE "api"."agent_workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"actor_credential_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_workflow_events_sequence" UNIQUE("workflow_id","sequence"),
	CONSTRAINT "chk_agent_workflow_events_type" CHECK ("api"."agent_workflow_events"."event_type" IN ('created','step_proposed','step_succeeded','paused','resumed','usage_reported','budget_exhausted','cancelled','succeeded')),
	CONSTRAINT "chk_agent_workflow_events_actor" CHECK (NOT ("api"."agent_workflow_events"."actor_user_id" IS NULL AND "api"."agent_workflow_events"."actor_credential_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "api"."agent_workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"step_key" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"tool_name" text NOT NULL,
	"operation" jsonb NOT NULL,
	"input_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"proposal_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_workflow_steps_position" UNIQUE("workflow_id","position"),
	CONSTRAINT "uq_agent_workflow_steps_key" UNIQUE("workflow_id","step_key"),
	CONSTRAINT "chk_agent_workflow_steps_position" CHECK ("api"."agent_workflow_steps"."position" >= 0),
	CONSTRAINT "chk_agent_workflow_steps_status" CHECK ("api"."agent_workflow_steps"."status" IN ('planned','waiting_approval','succeeded','rejected','failed','cancelled')),
	CONSTRAINT "chk_agent_workflow_steps_attempt" CHECK ("api"."agent_workflow_steps"."attempt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "api"."agent_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"status" text DEFAULT 'waiting_approval' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_digest" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"max_operations" integer NOT NULL,
	"max_tokens" bigint NOT NULL,
	"max_cost_microusd" bigint NOT NULL,
	"used_operations" integer DEFAULT 0 NOT NULL,
	"used_tokens" bigint DEFAULT 0 NOT NULL,
	"used_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_by_credential_id" uuid,
	"cancelled_by_user_id" text,
	"cancelled_by_credential_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_agent_workflows_workspace_id" UNIQUE("workspace_id","id"),
	CONSTRAINT "uq_agent_workflows_idempotency" UNIQUE("workspace_id","idempotency_key"),
	CONSTRAINT "chk_agent_workflows_status" CHECK ("api"."agent_workflows"."status" IN ('waiting_approval','paused','succeeded','cancelled','budget_exhausted')),
	CONSTRAINT "chk_agent_workflows_revision" CHECK ("api"."agent_workflows"."revision" > 0),
	CONSTRAINT "chk_agent_workflows_digest" CHECK ("api"."agent_workflows"."plan_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "chk_agent_workflows_budgets" CHECK ("api"."agent_workflows"."max_operations" BETWEEN 1 AND 50 AND "api"."agent_workflows"."max_tokens" >= 0 AND "api"."agent_workflows"."max_cost_microusd" >= 0),
	CONSTRAINT "chk_agent_workflows_usage" CHECK ("api"."agent_workflows"."used_operations" >= 0 AND "api"."agent_workflows"."used_tokens" >= 0 AND "api"."agent_workflows"."used_cost_microusd" >= 0),
	CONSTRAINT "chk_agent_workflows_author_xor" CHECK (("api"."agent_workflows"."created_by_user_id" IS NULL) <> ("api"."agent_workflows"."created_by_credential_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "internal"."api_credentials" DROP CONSTRAINT "chk_api_credentials_scopes";--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_events" ADD CONSTRAINT "agent_workflow_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_events" ADD CONSTRAINT "agent_workflow_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_events" ADD CONSTRAINT "agent_workflow_events_actor_credential_id_api_credentials_id_fk" FOREIGN KEY ("actor_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_events" ADD CONSTRAINT "fk_agent_workflow_events_workflow" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "api"."agent_workflows"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_steps" ADD CONSTRAINT "agent_workflow_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_steps" ADD CONSTRAINT "agent_workflow_steps_proposal_id_agent_operation_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "api"."agent_operation_proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflow_steps" ADD CONSTRAINT "fk_agent_workflow_steps_workflow" FOREIGN KEY ("workspace_id","workflow_id") REFERENCES "api"."agent_workflows"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflows" ADD CONSTRAINT "agent_workflows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "api"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflows" ADD CONSTRAINT "agent_workflows_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflows" ADD CONSTRAINT "agent_workflows_created_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("created_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflows" ADD CONSTRAINT "agent_workflows_cancelled_by_user_id_user_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "internal"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api"."agent_workflows" ADD CONSTRAINT "agent_workflows_cancelled_by_credential_id_api_credentials_id_fk" FOREIGN KEY ("cancelled_by_credential_id") REFERENCES "internal"."api_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_workflow_events_workflow" ON "api"."agent_workflow_events" USING btree ("workflow_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_agent_workflow_steps_workflow" ON "api"."agent_workflow_steps" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE INDEX "idx_agent_workflows_workspace_status" ON "api"."agent_workflows" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
ALTER TABLE "internal"."api_credentials" ADD CONSTRAINT "chk_api_credentials_scopes" CHECK (cardinality("internal"."api_credentials"."scopes") > 0 AND "internal"."api_credentials"."scopes" <@ ARRAY['projects:read','projects:write','datasets:read','datasets:write','schema:read','schema:write','schema:publish','sheets:read','sheets:write','models:read','models:write','templates:read','templates:write','reviews:read','reviews:write','files:read','files:write','webhooks:read','webhooks:write','agent_operations:read','agent_operations:write']::text[]);
--> statement-breakpoint

-- The remainder is the custom AUTO-05 contract. Drizzle does not model
-- PostgreSQL functions, grants, RLS policies, or orchestration through the
-- canonical AUTO-04 proposal RPCs.

ALTER TABLE api.agent_operation_proposals
  DROP CONSTRAINT chk_agent_operation_proposals_status;
ALTER TABLE api.agent_operation_proposals
  ADD CONSTRAINT chk_agent_operation_proposals_status
  CHECK (status IN ('pending','approved','rejected','executing','succeeded','failed','cancelled'));
ALTER TABLE api.agent_operation_events
  DROP CONSTRAINT chk_agent_operation_events_type;
ALTER TABLE api.agent_operation_events
  ADD CONSTRAINT chk_agent_operation_events_type
  CHECK (event_type IN (
    'proposed','approved','rejected','execution_started',
    'execution_succeeded','execution_failed','cancelled'
  ));
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_workflow_append_event(
  p_workflow api.agent_workflows,
  p_event_type text,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO api.agent_workflow_events(
    workspace_id, workflow_id, sequence, event_type,
    actor_user_id, actor_credential_id, detail
  ) VALUES (
    p_workflow.workspace_id,
    p_workflow.id,
    coalesce((
      SELECT max(sequence) + 1
      FROM api.agent_workflow_events
      WHERE workflow_id = p_workflow.id
    ), 1),
    p_event_type,
    api.current_user_id(),
    api.current_credential_id(),
    coalesce(p_detail, '{}'::jsonb)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.agent_workflow_append_event(api.agent_workflows,text,jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.validate_agent_workflow_reference(
  p_workspace_id uuid,
  p_reference jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF jsonb_typeof(p_reference) IS DISTINCT FROM 'object'
     OR p_reference - ARRAY['kind','id'] <> '{}'::jsonb
     OR p_reference->>'kind' NOT IN ('dataset_version','pipeline_definition_version') THEN
    RAISE EXCEPTION 'workflow input reference must be a bounded immutable version reference'
      USING ERRCODE = '22023';
  END IF;

  IF p_reference->>'kind' = 'dataset_version' THEN
    IF NOT EXISTS (
      SELECT 1 FROM api.dataset_versions
      WHERE id = (p_reference->>'id')::uuid
        AND workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'Dataset Version input is unavailable' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM api.pipeline_definition_versions
    WHERE id = (p_reference->>'id')::uuid
      AND workspace_id = p_workspace_id
      AND lifecycle = 'published'
  ) THEN
    RAISE EXCEPTION 'published Pipeline Version input is unavailable'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.validate_agent_workflow_reference(uuid,jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.require_agent_workflow_control(
  p_workflow api.agent_workflows
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF api.current_credential_id() IS NOT NULL THEN
    IF p_workflow.created_by_credential_id IS DISTINCT FROM api.current_credential_id()
       OR NOT (coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'agent_operations:write') THEN
      RAISE EXCEPTION 'creating agent credential required' USING ERRCODE = '42501';
    END IF;
  ELSIF api.current_user_id() IS NULL
     OR NOT api.is_workspace_writer(p_workflow.workspace_id) THEN
    RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.require_agent_workflow_control(api.agent_workflows)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_workflow_propose_step(
  p_workflow_id uuid,
  p_position integer
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workflow api.agent_workflows;
  v_step api.agent_workflow_steps;
  v_proposal api.agent_operation_proposals;
  v_code text;
  v_message text;
BEGIN
  SELECT * INTO v_workflow
    FROM api.agent_workflows
   WHERE id = p_workflow_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  SELECT * INTO v_step
    FROM api.agent_workflow_steps
   WHERE workflow_id = p_workflow_id
     AND position = p_position
   FOR UPDATE;

  IF v_workflow.id IS NULL OR v_step.id IS NULL THEN
    RAISE EXCEPTION 'workflow step not found' USING ERRCODE = '42501';
  END IF;
  IF v_workflow.status IN ('succeeded','cancelled','budget_exhausted') THEN
    RAISE EXCEPTION 'workflow is terminal' USING ERRCODE = 'SB001';
  END IF;
  IF v_workflow.used_operations >= v_workflow.max_operations THEN
    UPDATE api.agent_workflow_steps
       SET status = 'cancelled', updated_at = now()
     WHERE id = v_step.id;
    UPDATE api.agent_workflows
       SET status = 'budget_exhausted', revision = revision + 1,
           updated_at = now()
     WHERE id = v_workflow.id
     RETURNING * INTO v_workflow;
    PERFORM internal.agent_workflow_append_event(
      v_workflow, 'budget_exhausted',
      jsonb_build_object('budget','operations','limit',v_workflow.max_operations)
    );
    RETURN v_workflow;
  END IF;

  BEGIN
    v_proposal := api.propose_agent_operation(
      v_workflow.workspace_id,
      v_step.title,
      v_step.summary,
      v_step.operation,
      v_workflow.provenance,
      'workflow:' || v_workflow.id::text || ':' || v_step.step_key || ':' || (v_step.attempt + 1)::text
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    UPDATE api.agent_workflow_steps
       SET status = 'failed', updated_at = now()
     WHERE id = v_step.id;
    UPDATE api.agent_workflows
       SET status = 'paused', current_step = p_position,
           revision = revision + 1, updated_at = now()
     WHERE id = v_workflow.id
     RETURNING * INTO v_workflow;
    PERFORM internal.agent_workflow_append_event(
      v_workflow, 'paused',
      jsonb_build_object(
        'stepKey',v_step.step_key,'position',p_position,
        'errorCode',v_code,'message',left(v_message,2000)
      )
    );
    RETURN v_workflow;
  END;

  UPDATE api.agent_workflow_steps
     SET proposal_id = v_proposal.id, status = 'waiting_approval',
         attempt = attempt + 1, updated_at = now()
   WHERE id = v_step.id;
  UPDATE api.agent_workflows
     SET status = 'waiting_approval', current_step = p_position,
         used_operations = used_operations + 1,
         revision = revision + 1, updated_at = now()
   WHERE id = v_workflow.id
   RETURNING * INTO v_workflow;
  PERFORM internal.agent_workflow_append_event(
    v_workflow, 'step_proposed',
    jsonb_build_object(
      'stepKey',v_step.step_key,'position',p_position,
      'attempt',v_step.attempt + 1,'proposalId',v_proposal.id,
      'tool',v_step.tool_name
    )
  );
  RETURN v_workflow;
END;
$$;
REVOKE EXECUTE ON FUNCTION internal.agent_workflow_propose_step(uuid,integer)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.create_agent_workflow(
  p_workspace_id uuid,
  p_goal text,
  p_plan jsonb,
  p_budget jsonb,
  p_initial_usage jsonb,
  p_provenance jsonb,
  p_idempotency_key text
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user text := api.current_user_id();
  v_credential uuid := api.current_credential_id();
  v_step jsonb;
  v_reference jsonb;
  v_position integer;
  v_tool text;
  v_kind text;
  v_digest text;
  v_existing api.agent_workflows;
  v_workflow api.agent_workflows;
  v_step_count integer;
  v_max_operations integer;
  v_max_tokens bigint;
  v_max_cost bigint;
  v_used_tokens bigint;
  v_used_cost bigint;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace write actor required' USING ERRCODE = '42501';
  END IF;
  IF v_credential IS NOT NULL
     AND NOT (coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'agent_operations:write') THEN
    RAISE EXCEPTION 'agent_operations:write scope required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_goal,''))) NOT BETWEEN 1 AND 2000
     OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 1 AND 128
     OR jsonb_typeof(p_plan) IS DISTINCT FROM 'object'
     OR p_plan - ARRAY['formatVersion','steps'] <> '{}'::jsonb
     OR p_plan->>'formatVersion' <> '1'
     OR jsonb_typeof(p_plan->'steps') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid workflow goal or plan' USING ERRCODE = '22023';
  END IF;

  v_step_count := jsonb_array_length(p_plan->'steps');
  IF v_step_count NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'workflow plans require 2 to 20 sequential steps'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_budget) IS DISTINCT FROM 'object'
     OR p_budget - ARRAY['maxOperations','maxTokens','maxCostMicrousd'] <> '{}'::jsonb
     OR jsonb_typeof(p_initial_usage) IS DISTINCT FROM 'object'
     OR p_initial_usage - ARRAY['tokens','costMicrousd'] <> '{}'::jsonb THEN
    RAISE EXCEPTION 'invalid workflow budget or usage' USING ERRCODE = '22023';
  END IF;
  v_max_operations := (p_budget->>'maxOperations')::integer;
  v_max_tokens := (p_budget->>'maxTokens')::bigint;
  v_max_cost := (p_budget->>'maxCostMicrousd')::bigint;
  v_used_tokens := (p_initial_usage->>'tokens')::bigint;
  v_used_cost := (p_initial_usage->>'costMicrousd')::bigint;
  IF v_max_operations NOT BETWEEN v_step_count AND 50
     OR v_max_tokens < 0 OR v_max_cost < 0
     OR v_used_tokens < 0 OR v_used_cost < 0
     OR v_used_tokens > v_max_tokens OR v_used_cost > v_max_cost THEN
    RAISE EXCEPTION 'workflow budget is invalid or already exhausted'
      USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_provenance) IS DISTINCT FROM 'object'
     OR p_provenance - ARRAY['agentId','agentName','tool','model','invocationId'] <> '{}'::jsonb
     OR length(btrim(p_provenance->>'agentId')) NOT BETWEEN 1 AND 200
     OR length(btrim(p_provenance->>'invocationId')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_provenance->'tool') IS DISTINCT FROM 'object'
     OR length(btrim(p_provenance->'tool'->>'name')) NOT BETWEEN 1 AND 200
     OR jsonb_typeof(p_provenance->'model') IS DISTINCT FROM 'object'
     OR length(btrim(p_provenance->'model'->>'provider')) NOT BETWEEN 1 AND 100
     OR length(btrim(p_provenance->'model'->>'name')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'agent, tool, model, and invocation provenance are required'
      USING ERRCODE = '22023';
  END IF;

  v_digest := encode(sha256(convert_to(jsonb_build_object(
    'workspaceId',p_workspace_id,'goal',btrim(p_goal),'plan',p_plan,
    'budget',p_budget,'initialUsage',p_initial_usage,'provenance',p_provenance
  )::text,'UTF8')),'hex');
  SELECT * INTO v_existing
    FROM api.agent_workflows
   WHERE workspace_id = p_workspace_id
     AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.plan_digest <> v_digest
       OR v_existing.created_by_user_id IS DISTINCT FROM v_user
       OR v_existing.created_by_credential_id IS DISTINCT FROM v_credential THEN
      RAISE EXCEPTION 'idempotency key was used for a different workflow'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  FOR v_step, v_position IN
    SELECT item, (ordinality - 1)::integer
      FROM jsonb_array_elements(p_plan->'steps') WITH ORDINALITY AS steps(item,ordinality)
  LOOP
    IF jsonb_typeof(v_step) IS DISTINCT FROM 'object'
       OR v_step - ARRAY['key','title','summary','tool','operation','inputReferences'] <> '{}'::jsonb
       OR v_step->>'key' !~ '^[a-z][a-z0-9_-]{0,63}$'
       OR length(btrim(v_step->>'title')) NOT BETWEEN 1 AND 200
       OR length(btrim(v_step->>'summary')) NOT BETWEEN 1 AND 2000
       OR jsonb_typeof(v_step->'inputReferences') IS DISTINCT FROM 'array'
       OR jsonb_array_length(v_step->'inputReferences') > 50 THEN
      RAISE EXCEPTION 'invalid workflow step at position %', v_position
        USING ERRCODE = '22023';
    END IF;
    v_tool := v_step->>'tool';
    v_kind := v_step->'operation'->>'kind';
    IF (v_tool, v_kind) NOT IN (
      ('sheetbase.dataset_schema.draft','dataset_schema.create'),
      ('sheetbase.sheet_definition.draft','sheet_definition.create'),
      ('sheetbase.sheet_definition.update_draft','sheet_definition.update_draft'),
      ('sheetbase.pipeline_definition.draft','pipeline_definition.create'),
      ('sheetbase.pipeline_definition.version_draft','pipeline_definition.create_version'),
      ('sheetbase.pipeline_definition.update_draft','pipeline_definition.update_draft'),
      ('sheetbase.dataset_rows.commit','dataset_rows.commit')
    ) THEN
      RAISE EXCEPTION 'workflow step uses an unbounded or mismatched tool'
        USING ERRCODE = '22023';
    END IF;
    -- The first operation must be valid against current state. Later
    -- operations may deliberately name revisions produced by prior steps;
    -- validate them immediately before proposal creation instead.
    IF v_position = 0 THEN
      PERFORM internal.agent_operation_contract(
        p_workspace_id, v_step->'operation'
      );
    END IF;
    FOR v_reference IN
      SELECT value FROM jsonb_array_elements(v_step->'inputReferences')
    LOOP
      PERFORM internal.validate_agent_workflow_reference(p_workspace_id, v_reference);
    END LOOP;
  END LOOP;

  INSERT INTO api.agent_workflows(
    workspace_id,goal,status,plan,plan_digest,provenance,idempotency_key,
    max_operations,max_tokens,max_cost_microusd,used_tokens,used_cost_microusd,
    created_by_user_id,created_by_credential_id
  ) VALUES (
    p_workspace_id,btrim(p_goal),'paused',p_plan,v_digest,p_provenance,p_idempotency_key,
    v_max_operations,v_max_tokens,v_max_cost,v_used_tokens,v_used_cost,v_user,v_credential
  ) RETURNING * INTO v_workflow;

  INSERT INTO api.agent_workflow_steps(
    workspace_id,workflow_id,position,step_key,title,summary,tool_name,
    operation,input_references
  )
  SELECT
    p_workspace_id,v_workflow.id,(ordinality - 1)::integer,
    item->>'key',btrim(item->>'title'),btrim(item->>'summary'),item->>'tool',
    item->'operation',item->'inputReferences'
  FROM jsonb_array_elements(p_plan->'steps') WITH ORDINALITY AS steps(item,ordinality);

  PERFORM internal.agent_workflow_append_event(
    v_workflow,'created',
    jsonb_build_object(
      'goal',v_workflow.goal,'planDigest',v_digest,'steps',v_step_count,
      'budget',p_budget,'initialUsage',p_initial_usage
    )
  );
  RETURN internal.agent_workflow_propose_step(v_workflow.id, 0);
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.advance_agent_workflow(
  p_workflow_id uuid,
  p_expected_revision bigint
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workflow api.agent_workflows;
  v_step api.agent_workflow_steps;
  v_proposal api.agent_operation_proposals;
  v_step_count integer;
BEGIN
  SELECT * INTO v_workflow
    FROM api.agent_workflows
   WHERE id = p_workflow_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_workflow.id IS NULL THEN
    RAISE EXCEPTION 'workflow not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_workflow_control(v_workflow);
  IF v_workflow.revision <> p_expected_revision
     OR v_workflow.status <> 'waiting_approval' THEN
    RAISE EXCEPTION 'workflow is not waiting at the expected revision'
      USING ERRCODE = 'SB001';
  END IF;
  SELECT * INTO v_step
    FROM api.agent_workflow_steps
   WHERE workflow_id = v_workflow.id
     AND position = v_workflow.current_step
   FOR UPDATE;
  SELECT * INTO v_proposal
    FROM api.agent_operation_proposals
   WHERE id = v_step.proposal_id;

  IF v_proposal.status IN ('pending','approved','executing') THEN
    RETURN v_workflow;
  ELSIF v_proposal.status IN ('rejected','failed','cancelled') THEN
    UPDATE api.agent_workflow_steps
       SET status = CASE v_proposal.status
         WHEN 'rejected' THEN 'rejected'
         WHEN 'failed' THEN 'failed'
         ELSE 'cancelled'
       END,
       updated_at = now()
     WHERE id = v_step.id;
    UPDATE api.agent_workflows
       SET status = 'paused', revision = revision + 1, updated_at = now()
     WHERE id = v_workflow.id
     RETURNING * INTO v_workflow;
    PERFORM internal.agent_workflow_append_event(
      v_workflow,'paused',
      jsonb_build_object(
        'stepKey',v_step.step_key,'proposalId',v_proposal.id,
        'proposalStatus',v_proposal.status,'errorCode',v_proposal.error_code
      )
    );
    RETURN v_workflow;
  ELSIF v_proposal.status <> 'succeeded' THEN
    RAISE EXCEPTION 'workflow proposal has an unknown state' USING ERRCODE = 'SB001';
  END IF;

  UPDATE api.agent_workflow_steps
     SET status = 'succeeded', completed_at = now(), updated_at = now()
   WHERE id = v_step.id;
  UPDATE api.agent_workflows
     SET revision = revision + 1, updated_at = now()
   WHERE id = v_workflow.id
   RETURNING * INTO v_workflow;
  PERFORM internal.agent_workflow_append_event(
    v_workflow,'step_succeeded',
    jsonb_build_object(
      'stepKey',v_step.step_key,'proposalId',v_proposal.id,
      'canonicalResult',v_proposal.result
    )
  );
  SELECT count(*)::integer INTO v_step_count
    FROM api.agent_workflow_steps
   WHERE workflow_id = v_workflow.id;
  IF v_workflow.current_step + 1 >= v_step_count THEN
    UPDATE api.agent_workflows
       SET status = 'succeeded', completed_at = now(),
           revision = revision + 1, updated_at = now()
     WHERE id = v_workflow.id
     RETURNING * INTO v_workflow;
    PERFORM internal.agent_workflow_append_event(
      v_workflow,'succeeded',
      jsonb_build_object('planDigest',v_workflow.plan_digest)
    );
    RETURN v_workflow;
  END IF;
  RETURN internal.agent_workflow_propose_step(
    v_workflow.id, v_workflow.current_step + 1
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.resume_agent_workflow(
  p_workflow_id uuid,
  p_expected_revision bigint
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workflow api.agent_workflows;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required to resume a workflow'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_workflow
    FROM api.agent_workflows
   WHERE id = p_workflow_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_workflow.id IS NULL THEN
    RAISE EXCEPTION 'workflow not found' USING ERRCODE = '42501';
  END IF;
  IF v_workflow.status <> 'paused'
     OR v_workflow.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'workflow is not paused at the expected revision'
      USING ERRCODE = 'SB001';
  END IF;
  PERFORM internal.agent_workflow_append_event(
    v_workflow,'resumed',
    jsonb_build_object('position',v_workflow.current_step)
  );
  RETURN internal.agent_workflow_propose_step(
    v_workflow.id, v_workflow.current_step
  );
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.report_agent_workflow_usage(
  p_workflow_id uuid,
  p_expected_revision bigint,
  p_tokens bigint,
  p_cost_microusd bigint
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workflow api.agent_workflows;
  v_step api.agent_workflow_steps;
  v_proposal api.agent_operation_proposals;
BEGIN
  IF p_tokens < 0 OR p_cost_microusd < 0
     OR (p_tokens = 0 AND p_cost_microusd = 0) THEN
    RAISE EXCEPTION 'usage increments must be positive' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_workflow
    FROM api.agent_workflows
   WHERE id = p_workflow_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_workflow.id IS NULL THEN
    RAISE EXCEPTION 'workflow not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_workflow_control(v_workflow);
  IF v_workflow.revision <> p_expected_revision
     OR v_workflow.status IN ('succeeded','cancelled','budget_exhausted') THEN
    RAISE EXCEPTION 'workflow cannot accept usage at this revision'
      USING ERRCODE = 'SB001';
  END IF;

  UPDATE api.agent_workflows
     SET used_tokens = used_tokens + p_tokens,
         used_cost_microusd = used_cost_microusd + p_cost_microusd,
         revision = revision + 1, updated_at = now()
   WHERE id = v_workflow.id
   RETURNING * INTO v_workflow;
  PERFORM internal.agent_workflow_append_event(
    v_workflow,'usage_reported',
    jsonb_build_object(
      'tokens',p_tokens,'costMicrousd',p_cost_microusd,
      'usedTokens',v_workflow.used_tokens,
      'usedCostMicrousd',v_workflow.used_cost_microusd
    )
  );

  IF v_workflow.used_tokens > v_workflow.max_tokens
     OR v_workflow.used_cost_microusd > v_workflow.max_cost_microusd THEN
    SELECT * INTO v_step
      FROM api.agent_workflow_steps
     WHERE workflow_id = v_workflow.id
       AND position = v_workflow.current_step
     FOR UPDATE;
    SELECT * INTO v_proposal
      FROM api.agent_operation_proposals
     WHERE id = v_step.proposal_id
     FOR UPDATE;
    IF v_proposal.status IN ('pending','approved') THEN
      UPDATE api.agent_operation_proposals
         SET status = 'cancelled', revision = revision + 1, updated_at = now(),
             error_code = 'budget_exhausted',
             error_message = 'Parent workflow exceeded its token or cost budget.'
       WHERE id = v_proposal.id
       RETURNING * INTO v_proposal;
      PERFORM internal.agent_operation_append_event(
        v_proposal,'cancelled',
        jsonb_build_object('reason','parent workflow budget exhausted')
      );
      UPDATE api.agent_workflow_steps
         SET status = 'cancelled', updated_at = now()
       WHERE id = v_step.id;
    END IF;
    UPDATE api.agent_workflows
       SET status = 'budget_exhausted', revision = revision + 1,
           updated_at = now()
     WHERE id = v_workflow.id
     RETURNING * INTO v_workflow;
    PERFORM internal.agent_workflow_append_event(
      v_workflow,'budget_exhausted',
      jsonb_build_object(
        'usedTokens',v_workflow.used_tokens,'maxTokens',v_workflow.max_tokens,
        'usedCostMicrousd',v_workflow.used_cost_microusd,
        'maxCostMicrousd',v_workflow.max_cost_microusd
      )
    );
  END IF;
  RETURN v_workflow;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.cancel_agent_workflow(
  p_workflow_id uuid,
  p_expected_revision bigint,
  p_reason text
) RETURNS api.agent_workflows
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workflow api.agent_workflows;
  v_step api.agent_workflow_steps;
  v_proposal api.agent_operation_proposals;
BEGIN
  IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'cancellation reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_workflow
    FROM api.agent_workflows
   WHERE id = p_workflow_id
     AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_workflow.id IS NULL THEN
    RAISE EXCEPTION 'workflow not found' USING ERRCODE = '42501';
  END IF;
  PERFORM internal.require_agent_workflow_control(v_workflow);
  IF v_workflow.revision <> p_expected_revision
     OR v_workflow.status IN ('succeeded','cancelled','budget_exhausted') THEN
    RAISE EXCEPTION 'workflow cannot be cancelled at this revision'
      USING ERRCODE = 'SB001';
  END IF;
  SELECT * INTO v_step
    FROM api.agent_workflow_steps
   WHERE workflow_id = v_workflow.id
     AND position = v_workflow.current_step
   FOR UPDATE;
  SELECT * INTO v_proposal
    FROM api.agent_operation_proposals
   WHERE id = v_step.proposal_id
   FOR UPDATE;
  IF v_proposal.status IN ('pending','approved') THEN
    UPDATE api.agent_operation_proposals
       SET status = 'cancelled', revision = revision + 1, updated_at = now(),
           error_code = 'workflow_cancelled',
           error_message = btrim(p_reason)
     WHERE id = v_proposal.id
     RETURNING * INTO v_proposal;
    PERFORM internal.agent_operation_append_event(
      v_proposal,'cancelled',jsonb_build_object('reason',btrim(p_reason))
    );
  END IF;
  UPDATE api.agent_workflow_steps
     SET status = CASE WHEN status = 'succeeded' THEN status ELSE 'cancelled' END,
         updated_at = now()
   WHERE workflow_id = v_workflow.id
     AND position >= v_workflow.current_step;
  UPDATE api.agent_workflows
     SET status = 'cancelled', revision = revision + 1,
         cancelled_by_user_id = api.current_user_id(),
         cancelled_by_credential_id = api.current_credential_id(),
         cancelled_at = now(), cancellation_reason = btrim(p_reason),
         updated_at = now()
   WHERE id = v_workflow.id
   RETURNING * INTO v_workflow;
  PERFORM internal.agent_workflow_append_event(
    v_workflow,'cancelled',jsonb_build_object('reason',btrim(p_reason))
  );
  RETURN v_workflow;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON api.agent_workflows, api.agent_workflow_steps, api.agent_workflow_events
  FROM PUBLIC, anon, api_client;
GRANT SELECT ON api.agent_workflows, api.agent_workflow_steps, api.agent_workflow_events
  TO authenticated, api_client;
ALTER TABLE api.agent_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.agent_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.agent_workflow_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_workflows_select ON api.agent_workflows
  FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
CREATE POLICY agent_workflow_steps_select ON api.agent_workflow_steps
  FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
CREATE POLICY agent_workflow_events_select ON api.agent_workflow_events
  FOR SELECT TO authenticated USING (api.is_workspace_member(workspace_id));
CREATE POLICY agent_workflows_api_select ON api.agent_workflows
  FOR SELECT TO api_client USING (
    workspace_id = api.current_workspace_id()
    AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'agent_operations:read'
  );
CREATE POLICY agent_workflow_steps_api_select ON api.agent_workflow_steps
  FOR SELECT TO api_client USING (
    workspace_id = api.current_workspace_id()
    AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'agent_operations:read'
  );
CREATE POLICY agent_workflow_events_api_select ON api.agent_workflow_events
  FOR SELECT TO api_client USING (
    workspace_id = api.current_workspace_id()
    AND coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? 'agent_operations:read'
  );
--> statement-breakpoint

REVOKE EXECUTE ON FUNCTION
  api.create_agent_workflow(uuid,text,jsonb,jsonb,jsonb,jsonb,text),
  api.advance_agent_workflow(uuid,bigint),
  api.resume_agent_workflow(uuid,bigint),
  api.report_agent_workflow_usage(uuid,bigint,bigint,bigint),
  api.cancel_agent_workflow(uuid,bigint,text)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION
  api.create_agent_workflow(uuid,text,jsonb,jsonb,jsonb,jsonb,text),
  api.advance_agent_workflow(uuid,bigint),
  api.resume_agent_workflow(uuid,bigint),
  api.report_agent_workflow_usage(uuid,bigint,bigint,bigint),
  api.cancel_agent_workflow(uuid,bigint,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION
  api.create_agent_workflow(uuid,text,jsonb,jsonb,jsonb,jsonb,text),
  api.advance_agent_workflow(uuid,bigint),
  api.report_agent_workflow_usage(uuid,bigint,bigint,bigint),
  api.cancel_agent_workflow(uuid,bigint,text)
  TO api_client;