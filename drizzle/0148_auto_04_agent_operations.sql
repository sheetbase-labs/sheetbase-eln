-- AUTO-04 Agent-authored Operations.
--
-- Drizzle generated the two durable proposal/evidence tables from
-- src/db/schema.ts. The RPC portion is custom because Drizzle does not model
-- PostgreSQL functions, RLS policies, grants, or calls into canonical RPCs.

CREATE TABLE "api"."agent_operation_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE restrict,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "operation_kind" text NOT NULL,
  "operation" jsonb NOT NULL,
  "preview" jsonb NOT NULL,
  "impact" jsonb NOT NULL,
  "approval_policy" text DEFAULT 'human_required' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_digest" text NOT NULL,
  "provenance" jsonb NOT NULL,
  "proposed_by_user_id" text REFERENCES "internal"."user"("id") ON DELETE set null,
  "proposed_by_credential_id" uuid REFERENCES "internal"."api_credentials"("id") ON DELETE set null,
  "approved_by_user_id" text REFERENCES "internal"."user"("id") ON DELETE set null,
  "approved_at" timestamptz,
  "rejected_by_user_id" text REFERENCES "internal"."user"("id") ON DELETE set null,
  "rejected_at" timestamptz,
  "rejection_reason" text,
  "executed_by_user_id" text REFERENCES "internal"."user"("id") ON DELETE set null,
  "executed_at" timestamptz,
  "result" jsonb,
  "error_code" text,
  "error_message" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "uq_agent_operation_proposals_workspace_id" UNIQUE("workspace_id", "id"),
  CONSTRAINT "uq_agent_operation_proposals_idempotency" UNIQUE("workspace_id", "idempotency_key"),
  CONSTRAINT "chk_agent_operation_proposals_kind" CHECK ("operation_kind" IN (
    'dataset_schema.create',
    'sheet_definition.create',
    'sheet_definition.update_draft',
    'pipeline_definition.create',
    'pipeline_definition.create_version',
    'pipeline_definition.update_draft',
    'dataset_rows.commit'
  )),
  CONSTRAINT "chk_agent_operation_proposals_policy" CHECK ("approval_policy" = 'human_required'),
  CONSTRAINT "chk_agent_operation_proposals_status" CHECK ("status" IN ('pending','approved','rejected','executing','succeeded','failed')),
  CONSTRAINT "chk_agent_operation_proposals_revision" CHECK ("revision" > 0),
  CONSTRAINT "chk_agent_operation_proposals_digest" CHECK ("request_digest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "chk_agent_operation_proposals_author_xor" CHECK (
    ("proposed_by_user_id" IS NULL) <> ("proposed_by_credential_id" IS NULL)
  ),
  CONSTRAINT "chk_agent_operation_proposals_approval_actor" CHECK (
    "status" NOT IN ('approved','executing','succeeded','failed')
    OR ("approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE INDEX "idx_agent_operation_proposals_workspace_status"
  ON "api"."agent_operation_proposals" ("workspace_id", "status", "created_at");
--> statement-breakpoint

CREATE TABLE "api"."agent_operation_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "api"."workspaces"("id") ON DELETE restrict,
  "proposal_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text REFERENCES "internal"."user"("id") ON DELETE set null,
  "actor_credential_id" uuid REFERENCES "internal"."api_credentials"("id") ON DELETE set null,
  "detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "fk_agent_operation_events_proposal"
    FOREIGN KEY ("workspace_id", "proposal_id")
    REFERENCES "api"."agent_operation_proposals"("workspace_id", "id")
    ON DELETE cascade,
  CONSTRAINT "uq_agent_operation_events_sequence" UNIQUE("proposal_id", "sequence"),
  CONSTRAINT "chk_agent_operation_events_type" CHECK ("event_type" IN (
    'proposed','approved','rejected','execution_started','execution_succeeded','execution_failed'
  )),
  CONSTRAINT "chk_agent_operation_events_actor" CHECK (
    NOT ("actor_user_id" IS NULL AND "actor_credential_id" IS NULL)
  )
);
--> statement-breakpoint

CREATE INDEX "idx_agent_operation_events_proposal"
  ON "api"."agent_operation_events" ("proposal_id", "sequence");
--> statement-breakpoint

-- Proposal lifecycle joins the canonical audit/change stream. The detailed
-- immutable timeline remains in agent_operation_events.
ALTER TABLE api.change_events DROP CONSTRAINT chk_change_events_entity_type;
--> statement-breakpoint
ALTER TABLE api.change_events ADD CONSTRAINT chk_change_events_entity_type CHECK (
  entity_type IN (
    'project', 'folder', 'record', 'block', 'record_link', 'scientific_table',
    'scientific_row', 'formula', 'calculation', 'record_field_definition',
    'model_field_option', 'file', 'dataset_schema', 'dataset_schema_field',
    'dataset_schema_relationship', 'dataset', 'dataset_version', 'sample_event',
    'comment', 'review_submission', 'signature', 'review_decision', 'storage_site',
    'storage_room', 'storage_unit', 'storage_shelf', 'storage_rack', 'storage_box',
    'storage_position', 'storage_movement', 'plate_design', 'plate_well',
    'plate_layout_template', 'calendar_resource', 'calendar_booking',
    'calendar_booking_participant', 'calendar_booking_sample', 'study_workstream',
    'study_task', 'study_task_dependency', 'study_task_assignment',
    'study_task_resource', 'study_deliverable', 'study_project', 'study_experiment',
    'study_plan_snapshot', 'instrument', 'instrument_run', 'instrument_run_stage',
    'instrument_observation', 'instrument_plate_snapshot', 'instrument_qc_check',
    'instrument_raw_file', 'instrument_run_link', 'report_definition',
    'report_section', 'report_generation', 'sheet_instance', 'sheet_definition',
    'sheet_definition_version', 'notebook_template', 'notebook_template_version',
    'workspace_invitation', 'workspace_settings', 'project_access',
    'api_credential', 'connector', 'connector_run', 'pipeline_definition',
    'pipeline_definition_version', 'pipeline_run', 'pipeline_schedule',
    'webhook_subscription', 'webhook_delivery', 'agent_operation_proposal'
  )
);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_append_event(
  p_proposal api.agent_operation_proposals,
  p_event_type text,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO api.agent_operation_events(
    workspace_id, proposal_id, sequence, event_type,
    actor_user_id, actor_credential_id, detail
  ) VALUES (
    p_proposal.workspace_id,
    p_proposal.id,
    coalesce((
      SELECT max(sequence) + 1
      FROM api.agent_operation_events
      WHERE proposal_id = p_proposal.id
    ), 1),
    p_event_type,
    api.current_user_id(),
    api.current_credential_id(),
    coalesce(p_detail, '{}'::jsonb)
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.agent_operation_append_event(api.agent_operation_proposals, text, jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_contract(
  p_workspace_id uuid,
  p_operation jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_target jsonb;
  v_validation jsonb;
  v_workspace uuid;
  v_revision bigint;
  v_lifecycle text;
  v_errors jsonb;
BEGIN
  IF jsonb_typeof(p_operation) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'operation must be an object' USING ERRCODE = '22023';
  END IF;
  v_kind := p_operation->>'kind';

  IF v_kind = 'dataset_schema.create' THEN
    PERFORM api.require_capability(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description','fields'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR p_operation->>'key' !~ '^[a-z][a-z0-9_]{0,59}$'
       OR length(btrim(p_operation->>'name')) NOT BETWEEN 1 AND 200
       OR jsonb_typeof(p_operation->'fields') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_operation->'fields') > 200 THEN
      RAISE EXCEPTION 'invalid Dataset Schema create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','dataset_schema','id',NULL,'label',p_operation->>'name');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,
        'kind',v_kind,
        'target',v_target,
        'changes',jsonb_build_array(
          jsonb_build_object('path','definition','before',NULL,'after',
            jsonb_build_object('key',p_operation->>'key','name',p_operation->>'name')),
          jsonb_build_object('path','fields','before',0,'after',jsonb_array_length(p_operation->'fields'))
        )
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_definition.create' THEN
    PERFORM api.require_capability(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Sheet Definition create operation' USING ERRCODE = '22023';
    END IF;
    PERFORM internal.validate_sheet_definition_configuration(p_operation->'configuration');
    v_target := jsonb_build_object('type','sheet_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'sheet_definition.update_draft' THEN
    PERFORM api.require_capability(p_workspace_id, 'schema.edit');
    SELECT d.workspace_id, v.revision, v.lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_definition_versions v
      JOIN api.sheet_definitions d ON d.id = v.definition_id
     WHERE v.id = (p_operation->>'versionId')::uuid;
    IF p_operation - ARRAY['kind','versionId','expectedRevision','configuration'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Sheet Definition draft unavailable' USING ERRCODE = '42501';
    END IF;
    PERFORM internal.validate_sheet_definition_configuration(p_operation->'configuration');
    v_target := jsonb_build_object('type','sheet_definition_version','id',p_operation->>'versionId','label','Draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','configuration',
          'before',(SELECT configuration FROM api.sheet_definition_versions WHERE id=(p_operation->>'versionId')::uuid),
          'after',p_operation->'configuration'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'pipeline_definition.create' THEN
    PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Pipeline Definition create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'pipeline_definition.create_version' THEN
    PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.pipeline_definitions
     WHERE id = (p_operation->>'definitionId')::uuid;
    v_errors := api.pipeline_config_errors(p_operation->'configuration');
    IF p_operation - ARRAY['kind','workspaceId','definitionId','expectedDefinitionRevision','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION 'invalid Pipeline Definition version operation: %', v_errors USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition','id',p_operation->>'definitionId','label','New draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedDefinitionRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','configuration','before',NULL,'after',p_operation->'configuration'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'pipeline_definition.update_draft' THEN
    PERFORM api.require_capability(p_workspace_id, 'pipelines.manage');
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.pipeline_definition_versions
     WHERE id = (p_operation->>'versionId')::uuid;
    v_errors := api.pipeline_config_errors(p_operation->'configuration');
    IF p_operation - ARRAY['kind','workspaceId','versionId','expectedRevision','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'draft'
       OR jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION 'invalid Pipeline draft operation: %', v_errors USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition_version','id',p_operation->>'versionId','label','Draft version');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','configuration',
          'before',(SELECT configuration FROM api.pipeline_definition_versions WHERE id=(p_operation->>'versionId')::uuid),
          'after',p_operation->'configuration'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'dataset_rows.commit' THEN
    IF NOT api.is_workspace_writer(p_workspace_id) THEN
      RAISE EXCEPTION 'workspace writer required' USING ERRCODE = '42501';
    END IF;
    SELECT workspace_id, revision, lifecycle
      INTO v_workspace, v_revision, v_lifecycle
      FROM api.datasets
     WHERE id = (p_operation->>'datasetId')::uuid;
    IF p_operation - ARRAY['kind','datasetId','expectedRevision','rows'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR jsonb_typeof(p_operation->'rows') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_operation->'rows') NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'invalid Dataset row operation' USING ERRCODE = '22023';
    END IF;
    v_validation := api.validate_dataset_row_batch(
      (p_operation->>'datasetId')::uuid,
      (p_operation->>'expectedRevision')::bigint,
      p_operation->'rows'
    );
    IF (v_validation->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'Dataset row operation failed validation: %', v_validation USING ERRCODE = 'SB073';
    END IF;
    v_target := jsonb_build_object('type','dataset','id',p_operation->>'datasetId','label','Dataset rows');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',(SELECT coalesce(jsonb_agg(jsonb_build_object(
          'path','rows.' || (item->>'rowId'),
          'before',NULL,
          'after',item
        ) ORDER BY ordinality),'[]'::jsonb) FROM jsonb_array_elements(p_operation->'rows') WITH ORDINALITY AS rows(item,ordinality))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','data','target',v_target,
        'createsDraft',false,'affectedRows',jsonb_array_length(p_operation->'rows'),
        'destructive',false,'validation',v_validation
      )
    );
  ELSE
    RAISE EXCEPTION 'unsupported or human-only operation kind' USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'preview', jsonb_build_object(
      'formatVersion',1,'kind',v_kind,'target',v_target,
      'changes',jsonb_build_array(jsonb_build_object('path','definition','before',NULL,'after',p_operation - 'kind'))
    ),
    'impact', jsonb_build_object(
      'formatVersion',1,'mutationClass','configuration','target',v_target,
      'createsDraft',v_kind = 'sheet_definition.create',
      'affectedRows',0,'destructive',false
    )
  );
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.agent_operation_contract(uuid, jsonb)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.propose_agent_operation(
  p_workspace_id uuid,
  p_title text,
  p_summary text,
  p_operation jsonb,
  p_provenance jsonb,
  p_idempotency_key text
) RETURNS api.agent_operation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user text := api.current_user_id();
  v_actor_credential uuid := api.current_credential_id();
  v_contract jsonb;
  v_digest text;
  v_existing api.agent_operation_proposals;
  v_result api.agent_operation_proposals;
BEGIN
  IF api.current_workspace_id() IS DISTINCT FROM p_workspace_id
     OR NOT api.has_write_actor() THEN
    RAISE EXCEPTION 'workspace write actor required' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 200
     OR length(btrim(coalesce(p_summary,''))) NOT BETWEEN 1 AND 2000
     OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'invalid proposal metadata' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'agent, tool, model, and invocation provenance are required' USING ERRCODE = '22023';
  END IF;

  v_contract := internal.agent_operation_contract(p_workspace_id, p_operation);
  v_digest := encode(sha256(convert_to(jsonb_build_object(
    'workspaceId',p_workspace_id,'title',btrim(p_title),'summary',btrim(p_summary),
    'operation',p_operation,'provenance',p_provenance
  )::text,'UTF8')),'hex');

  SELECT * INTO v_existing
    FROM api.agent_operation_proposals
   WHERE workspace_id = p_workspace_id AND idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.request_digest <> v_digest
       OR v_existing.proposed_by_user_id IS DISTINCT FROM v_actor_user
       OR v_existing.proposed_by_credential_id IS DISTINCT FROM v_actor_credential THEN
      RAISE EXCEPTION 'idempotency key was used for a different proposal' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing;
  END IF;

  INSERT INTO api.agent_operation_proposals(
    workspace_id,title,summary,operation_kind,operation,preview,impact,
    idempotency_key,request_digest,provenance,
    proposed_by_user_id,proposed_by_credential_id
  ) VALUES (
    p_workspace_id,btrim(p_title),btrim(p_summary),p_operation->>'kind',
    p_operation,v_contract->'preview',v_contract->'impact',
    p_idempotency_key,v_digest,p_provenance,v_actor_user,v_actor_credential
  ) RETURNING * INTO v_result;
  PERFORM internal.agent_operation_append_event(v_result,'proposed',
    jsonb_build_object('operationKind',v_result.operation_kind,'requestDigest',v_digest));
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'create',
    NULL,NULL,jsonb_build_object('status',v_result.status,'operationKind',v_result.operation_kind)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.require_agent_operation_capability(
  p_proposal api.agent_operation_proposals
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_proposal.operation_kind LIKE 'pipeline_definition.%' THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'pipelines.manage');
  ELSIF p_proposal.operation_kind = 'dataset_rows.commit' THEN
    IF NOT api.is_workspace_writer(p_proposal.workspace_id) THEN
      RAISE EXCEPTION 'workspace writer required' USING ERRCODE='42501';
    END IF;
  ELSE
    PERFORM api.require_capability(p_proposal.workspace_id,'schema.edit');
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION internal.require_agent_operation_capability(api.agent_operation_proposals)
  FROM PUBLIC, authenticated, api_client;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.decide_agent_operation(
  p_proposal_id uuid,
  p_expected_revision bigint,
  p_decision text,
  p_reason text DEFAULT NULL
) RETURNS api.agent_operation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_proposals;
  v_user text := api.current_user_id();
BEGIN
  IF v_user IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required for approval' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_result FROM api.agent_operation_proposals
   WHERE id=p_proposal_id AND workspace_id=api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE='42501';
  END IF;
  PERFORM internal.require_agent_operation_capability(v_result);
  IF v_result.status <> 'pending' OR v_result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'stale or decided proposal' USING ERRCODE='SB001';
  END IF;
  IF p_decision = 'approve' THEN
    UPDATE api.agent_operation_proposals
       SET status='approved',revision=revision+1,approved_by_user_id=v_user,
           approved_at=now(),updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'approved','{}'::jsonb);
  ELSIF p_decision = 'reject' AND length(btrim(coalesce(p_reason,''))) BETWEEN 1 AND 1000 THEN
    UPDATE api.agent_operation_proposals
       SET status='rejected',revision=revision+1,rejected_by_user_id=v_user,
           rejected_at=now(),rejection_reason=btrim(p_reason),updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'rejected',jsonb_build_object('reason',v_result.rejection_reason));
  ELSE
    RAISE EXCEPTION 'decision must be approve or reject with a reason' USING ERRCODE='22023';
  END IF;
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'update',
    NULL,NULL,jsonb_build_object('status',v_result.status,'operationKind',v_result.operation_kind)
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION api.execute_agent_operation(
  p_proposal_id uuid,
  p_expected_revision bigint
) RETURNS api.agent_operation_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result api.agent_operation_proposals;
  v_operation jsonb;
  v_execution jsonb;
  v_code text;
  v_message text;
  v_current_revision bigint;
BEGIN
  IF api.current_user_id() IS NULL OR api.current_credential_id() IS NOT NULL THEN
    RAISE EXCEPTION 'human session required for execution' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_result FROM api.agent_operation_proposals
   WHERE id=p_proposal_id AND workspace_id=api.current_workspace_id() FOR UPDATE;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'proposal not found' USING ERRCODE='42501';
  END IF;
  PERFORM internal.require_agent_operation_capability(v_result);
  IF v_result.status <> 'approved' OR v_result.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'proposal is not approved at the expected revision' USING ERRCODE='SB001';
  END IF;

  UPDATE api.agent_operation_proposals
     SET status='executing',revision=revision+1,executed_by_user_id=api.current_user_id(),
         executed_at=now(),updated_at=now()
   WHERE id=v_result.id RETURNING * INTO v_result;
  PERFORM internal.agent_operation_append_event(v_result,'execution_started','{}'::jsonb);
  v_operation := v_result.operation;

  BEGIN
    IF v_result.operation_kind = 'dataset_schema.create' THEN
      v_execution := api.create_dataset_schema_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description',v_operation->'fields'
      );
    ELSIF v_result.operation_kind = 'sheet_definition.create' THEN
      v_execution := api.create_sheet_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description',v_operation->'configuration'
      );
    ELSIF v_result.operation_kind = 'sheet_definition.update_draft' THEN
      v_execution := to_jsonb(api.update_sheet_definition_draft(
        (v_operation->>'versionId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.create' THEN
      v_execution := to_jsonb(api.create_pipeline_definition(
        v_result.workspace_id,v_operation->>'key',v_operation->>'name',
        v_operation->>'description'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.create_version' THEN
      SELECT revision INTO v_current_revision FROM api.pipeline_definitions
       WHERE id=(v_operation->>'definitionId')::uuid
         AND workspace_id=v_result.workspace_id FOR UPDATE;
      IF v_current_revision IS DISTINCT FROM (v_operation->>'expectedDefinitionRevision')::bigint THEN
        RAISE EXCEPTION 'stale Pipeline Definition revision' USING ERRCODE='SB001';
      END IF;
      v_execution := to_jsonb(api.create_pipeline_definition_version(
        v_result.workspace_id,(v_operation->>'definitionId')::uuid,
        v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'pipeline_definition.update_draft' THEN
      v_execution := to_jsonb(api.update_pipeline_definition_version_draft(
        v_result.workspace_id,(v_operation->>'versionId')::uuid,
        (v_operation->>'expectedRevision')::bigint,v_operation->'configuration'
      ));
    ELSIF v_result.operation_kind = 'dataset_rows.commit' THEN
      v_execution := api.commit_dataset_row_batch(
        (v_operation->>'datasetId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->'rows','agent-proposal:' || v_result.id::text
      );
      IF (v_execution->>'ok')::boolean IS NOT TRUE THEN
        RAISE EXCEPTION 'canonical Dataset commit rejected: %', v_execution USING ERRCODE='SB073';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported or human-only operation kind' USING ERRCODE='22023';
    END IF;

    UPDATE api.agent_operation_proposals
       SET status='succeeded',revision=revision+1,result=v_execution,
           error_code=NULL,error_message=NULL,updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_succeeded',
      jsonb_build_object('result',v_execution));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    UPDATE api.agent_operation_proposals
       SET status='failed',revision=revision+1,error_code=v_code,
           error_message=left(v_message,2000),updated_at=now()
     WHERE id=v_result.id RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_failed',
      jsonb_build_object('errorCode',v_code,'message',left(v_message,2000)));
  END;

  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'update',
    NULL,NULL,jsonb_build_object(
      'status',v_result.status,'operationKind',v_result.operation_kind,
      'canonicalResult',v_result.result
    )
  );
  RETURN v_result;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON api.agent_operation_proposals, api.agent_operation_events FROM PUBLIC, anon, api_client;
GRANT SELECT ON api.agent_operation_proposals, api.agent_operation_events TO authenticated;
--> statement-breakpoint
ALTER TABLE api.agent_operation_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE api.agent_operation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY agent_operation_proposals_select
  ON api.agent_operation_proposals FOR SELECT TO authenticated
  USING (api.is_workspace_member(workspace_id));
CREATE POLICY agent_operation_events_select
  ON api.agent_operation_events FOR SELECT TO authenticated
  USING (api.is_workspace_member(workspace_id));
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION api.propose_agent_operation(uuid,text,text,jsonb,jsonb,text),
  api.decide_agent_operation(uuid,bigint,text,text),
  api.execute_agent_operation(uuid,bigint)
  FROM PUBLIC, anon, api_client;
GRANT EXECUTE ON FUNCTION api.propose_agent_operation(uuid,text,text,jsonb,jsonb,text),
  api.decide_agent_operation(uuid,bigint,text,text),
  api.execute_agent_operation(uuid,bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION api.propose_agent_operation(uuid,text,text,jsonb,jsonb,text)
  TO api_client;
