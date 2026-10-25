-- Extend the agent proposal vocabulary to four existing canonical writes:
-- record creation, record custom-field updates, Sheet Instance creation from a
-- published Definition Version, and protocol-template instantiation.
--
-- Every branch validates its own target and delegates execution to the
-- existing api.* RPC. None of these kinds is added to the delegation-policy
-- allowlist: they remain human_required until a policy target and UI exist.

ALTER TABLE api.agent_operation_proposals
  DROP CONSTRAINT chk_agent_operation_proposals_kind;
--> statement-breakpoint

ALTER TABLE api.agent_operation_proposals
  ADD CONSTRAINT chk_agent_operation_proposals_kind CHECK (
    operation_kind = ANY (ARRAY[
      'dataset_schema.create','sheet_definition.create',
      'sheet_definition.update_draft','pipeline_definition.create',
      'pipeline_definition.create_version','pipeline_definition.update_draft',
      'dataset_rows.commit','notebook_block.insert',
      'workspace_ai_settings.update','record.create',
      'record.custom_fields.update','sheet_instance.create',
      'template.instantiate'
    ]::text[])
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION internal.agent_operation_contract_core(p_workspace_id uuid, p_operation jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
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
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description','configuration'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Sheet Definition create operation' USING ERRCODE = '22023';
    END IF;
    PERFORM internal.validate_sheet_definition_configuration(p_operation->'configuration');
    v_target := jsonb_build_object('type','sheet_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'sheet_definition.update_draft' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
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
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
    IF p_operation - ARRAY['kind','workspaceId','key','name','description'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid Pipeline Definition create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','pipeline_definition','id',NULL,'label',p_operation->>'name');

  ELSIF v_kind = 'pipeline_definition.create_version' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
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
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'pipelines.manage');
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
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
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
  ELSIF v_kind = 'notebook_block.insert' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, structure_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','afterBlockId','block','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedRevision' IS NULL
       OR jsonb_typeof(p_operation->'block') IS DISTINCT FROM 'object'
       OR length(btrim(coalesce(p_operation->'block'->>'type',''))) NOT BETWEEN 1 AND 48
       OR jsonb_typeof(p_operation->'block'->'payload') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid notebook block operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes', jsonb_build_array(jsonb_build_object(
          'path','blocks','before',NULL,
          'after', jsonb_build_object(
            'afterBlockId',p_operation->'afterBlockId',
            'type',p_operation->'block'->>'type',
            'payload',p_operation->'block'->'payload'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );
  ELSIF v_kind = 'record.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','workspaceId','projectId','recordKind','title','status','tags','properties'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'recordKind',''))) NOT BETWEEN 1 AND 48
       OR length(btrim(coalesce(p_operation->>'title',''))) NOT BETWEEN 1 AND 200
       OR (p_operation->>'projectId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'projectId')::uuid
               AND p.workspace_id = p_workspace_id))
       OR (p_operation->'tags' IS NOT NULL AND jsonb_typeof(p_operation->'tags') IS DISTINCT FROM 'array')
       OR (p_operation->'properties' IS NOT NULL AND jsonb_typeof(p_operation->'properties') IS DISTINCT FROM 'object')
       OR (p_operation->>'projectId' IS NULL AND p_operation->>'recordKind' <> 'protocol_template') THEN
      RAISE EXCEPTION 'invalid record create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','project','id',p_operation->>'projectId','label','New ' || coalesce(p_operation->>'recordKind','record'));
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','record','before',NULL,'after',p_operation - 'kind'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'record.custom_fields.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, metadata_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','expectedMetadataVersion','values'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedMetadataVersion' IS NULL
       OR jsonb_typeof(p_operation->'values') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid record custom-field operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Record fields');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedMetadataVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','customFields','before',NULL,'after',p_operation->'values'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','workspaceId','name','description','sourceDefinitionVersionId','projectId','notebookRecordId','state','parameterInputs'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'name',''))) NOT BETWEEN 1 AND 200
       OR p_operation->>'sourceDefinitionVersionId' IS NULL
       OR NOT EXISTS (
            SELECT 1
              FROM api.sheet_definition_versions version
              JOIN api.sheet_definitions definition ON definition.id = version.definition_id
             WHERE version.id = (p_operation->>'sourceDefinitionVersionId')::uuid
               AND version.lifecycle = 'published'
               AND definition.workspace_id = p_workspace_id
               AND definition.lifecycle = 'active')
       OR (p_operation->>'projectId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'projectId')::uuid
               AND p.workspace_id = p_workspace_id))
       OR (p_operation->>'notebookRecordId' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM api.records r
             WHERE r.id = (p_operation->>'notebookRecordId')::uuid
               AND r.workspace_id = p_workspace_id))
       OR jsonb_typeof(p_operation->'state') IS DISTINCT FROM 'object'
       OR (p_operation->'parameterInputs' IS NOT NULL AND jsonb_typeof(p_operation->'parameterInputs') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'invalid Sheet Instance create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_definition_version','id',p_operation->>'sourceDefinitionVersionId','label','New Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','instance','before',NULL,
          'after',jsonb_build_object(
            'name',p_operation->>'name',
            'projectId',p_operation->>'projectId',
            'notebookRecordId',p_operation->>'notebookRecordId',
            'state',p_operation->'state'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'template.instantiate' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    IF p_operation - ARRAY['kind','templateRecordId','targetProjectId','targetKind','title'] <> '{}'::jsonb
       OR p_operation->>'templateRecordId' IS NULL
       OR p_operation->>'targetProjectId' IS NULL
       OR p_operation->>'targetKind' NOT IN ('experiment','protocol_template')
       OR length(coalesce(p_operation->>'title','')) > 200
       OR NOT EXISTS (
            SELECT 1 FROM api.records r
             WHERE r.id = (p_operation->>'templateRecordId')::uuid
               AND r.workspace_id = p_workspace_id
               AND r.kind = 'protocol_template'
               AND r.archived_at IS NULL
               AND r.status = 'active')
       OR NOT EXISTS (
            SELECT 1 FROM api.projects p
             WHERE p.id = (p_operation->>'targetProjectId')::uuid
               AND p.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid template instantiate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','project','id',p_operation->>'targetProjectId','label','Instantiate template');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','template','before',NULL,
          'after',jsonb_build_object(
            'templateRecordId',p_operation->>'templateRecordId',
            'targetKind',p_operation->>'targetKind',
            'title',p_operation->>'title'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
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
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.agent_operation_execute_core(p_proposal_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_result api.agent_operation_proposals;
  v_operation jsonb;
  v_execution jsonb;
  v_pipeline_revision bigint;
  v_code text;
  v_message text;
BEGIN
  SELECT * INTO v_result
    FROM api.agent_operation_proposals
   WHERE id = p_proposal_id AND workspace_id = api.current_workspace_id()
   FOR UPDATE;
  IF v_result.id IS NULL
     OR v_result.status NOT IN ('pending', 'approved')
     OR (v_result.status = 'pending' AND v_result.approval_policy = 'human_required') THEN
    RAISE EXCEPTION 'proposal is not executable' USING ERRCODE = 'SB001';
  END IF;
  UPDATE api.agent_operation_proposals
     SET status = 'executing',
         revision = revision + 1,
         executed_by_user_id = api.current_user_id(),
         executed_by_credential_id = api.current_credential_id(),
         executed_at = now(),
         updated_at = now()
   WHERE id = v_result.id
  RETURNING * INTO v_result;
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
      SELECT revision INTO v_pipeline_revision
        FROM api.pipeline_definitions
       WHERE id = (v_operation->>'definitionId')::uuid
         AND workspace_id = v_result.workspace_id
       FOR UPDATE;
      IF v_pipeline_revision IS DISTINCT FROM
         (v_operation->>'expectedDefinitionRevision')::bigint THEN
        RAISE EXCEPTION 'stale Pipeline Definition revision' USING ERRCODE = 'SB001';
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
        RAISE EXCEPTION 'canonical Dataset commit rejected: %', v_execution USING ERRCODE = 'SB073';
      END IF;
    ELSIF v_result.operation_kind = 'notebook_block.insert' THEN
      v_execution := api.insert_block(
        (v_operation->>'recordId')::uuid,
        v_operation->'block'->>'type',
        v_operation->'block'->'payload',
        coalesce((v_operation->'block'->>'payloadSchemaVersion')::integer, 1),
        nullif(v_operation->>'afterBlockId','')::uuid,
        (v_operation->>'expectedRevision')::integer,
        NULL
      );
    ELSIF v_result.operation_kind = 'record.create' THEN
      v_execution := to_jsonb(api.create_record(
        nullif(v_operation->>'projectId','')::uuid,
        v_operation->>'recordKind',
        v_operation->>'title',
        coalesce(v_operation->>'status','draft'),
        ARRAY(SELECT jsonb_array_elements_text(coalesce(v_operation->'tags','[]'::jsonb))),
        coalesce(v_operation->'properties','{}'::jsonb)
      ));
    ELSIF v_result.operation_kind = 'record.custom_fields.update' THEN
      v_execution := to_jsonb(api.update_record_custom_fields(
        (v_operation->>'recordId')::uuid,
        (v_operation->>'expectedMetadataVersion')::integer,
        v_operation->'values'
      ));
    ELSIF v_result.operation_kind = 'sheet_instance.create' THEN
      v_execution := to_jsonb(api.create_sheet_instance_from_definition(
        v_result.workspace_id,
        v_operation->>'name',
        v_operation->>'description',
        (v_operation->>'sourceDefinitionVersionId')::uuid,
        nullif(v_operation->>'projectId','')::uuid,
        nullif(v_operation->>'notebookRecordId','')::uuid,
        v_operation->'state',
        coalesce(v_operation->'parameterInputs','{}'::jsonb)
      ));
    ELSIF v_result.operation_kind = 'template.instantiate' THEN
      v_execution := api.instantiate_template(
        (v_operation->>'templateRecordId')::uuid,
        (v_operation->>'targetProjectId')::uuid,
        v_operation->>'targetKind',
        v_operation->>'title'
      );
    ELSE
      RAISE EXCEPTION 'unsupported or human-only operation kind' USING ERRCODE = '22023';
    END IF;

    UPDATE api.agent_operation_proposals
       SET status = 'succeeded',
           revision = revision + 1,
           result = v_execution,
           error_code = NULL,
           error_message = NULL,
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_succeeded',
      jsonb_build_object('result',v_execution));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    UPDATE api.agent_operation_proposals
       SET status = 'failed',
           revision = revision + 1,
           error_code = v_code,
           error_message = left(v_message,2000),
           updated_at = now()
     WHERE id = v_result.id
    RETURNING * INTO v_result;
    PERFORM internal.agent_operation_append_event(v_result,'execution_failed',
      jsonb_build_object('errorCode',v_code,'message',left(v_message,2000)));
  END;
  PERFORM internal.emit_change_event(
    v_result.workspace_id,'agent_operation_proposal',v_result.id,'update',
    NULL,NULL,jsonb_build_object(
      'status',v_result.status,
      'operationKind',v_result.operation_kind,
      'canonicalResult',v_result.result,
      'policyId',v_result.policy_id,
      'approvalPolicy',v_result.approval_policy
    )
  );
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.agent_operation_policy_evaluate_core(p_workspace_id uuid, p_operation jsonb, p_contract jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_kind text := p_operation->>'kind';
  v_target jsonb := p_contract->'preview'->'target';
  v_risk text;
  v_required_scope text;
  v_actor_kind text;
  v_scope_ok boolean := true;
  v_policy api.agent_operation_policies;
  v_affected_rows integer := coalesce((p_contract->'impact'->>'affectedRows')::integer, 0);
  v_max_rows integer;
  v_approval_policy text;
  v_reason text;
  v_policy_limits jsonb := '{}'::jsonb;
  v_policy_id uuid;
  v_target_matched boolean := false;
  v_limit_satisfied boolean := true;
  v_create_only boolean := true;
BEGIN
  v_risk := CASE
    WHEN v_kind IN (
      'dataset_schema.create', 'sheet_definition.create',
      'sheet_definition.update_draft', 'pipeline_definition.create',
      'pipeline_definition.create_version', 'pipeline_definition.update_draft'
    ) THEN 'safe_draft'
    ELSE 'consequential_write'
  END;
  v_required_scope := CASE
    WHEN v_kind = 'dataset_rows.commit' THEN 'datasets:write'
    WHEN v_kind = 'notebook_block.insert' THEN 'projects:write'
    WHEN v_kind = 'record.create' THEN 'projects:write'
    WHEN v_kind = 'record.custom_fields.update' THEN 'models:write'
    WHEN v_kind = 'sheet_instance.create' THEN 'sheets:write'
    WHEN v_kind = 'template.instantiate' THEN 'projects:write'
    ELSE 'schema:write'
  END;
  v_actor_kind := CASE
    WHEN api.current_credential_id() IS NOT NULL THEN 'credential'
    WHEN api.current_user_id() IS NOT NULL THEN 'user'
    ELSE 'unknown'
  END;
  IF v_actor_kind = 'credential' THEN
    v_scope_ok := coalesce(api.claim_probe()->'scopes','[]'::jsonb) ? v_required_scope;
  END IF;
  IF v_kind = 'dataset_rows.commit' THEN
    v_create_only := NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(coalesce(p_operation->'rows', '[]'::jsonb)) row_item
      WHERE coalesce(row_item->>'operation', '') IS DISTINCT FROM 'create'
    );
  END IF;

  IF v_risk = 'consequential_write' THEN
    SELECT policy.*
      INTO v_policy
      FROM api.agent_operation_policies policy
     WHERE policy.workspace_id = p_workspace_id
       AND policy.operation_kind = v_kind
       AND internal.agent_operation_policy_matches(
         policy, p_workspace_id, p_operation, v_target
       )
     ORDER BY CASE policy.target_type
       WHEN 'dataset' THEN 0
       WHEN 'project' THEN 1
       WHEN 'workspace' THEN 2
       ELSE 3
     END, policy.created_at DESC
     LIMIT 1;
    v_target_matched := v_policy.id IS NOT NULL;
    IF v_target_matched THEN
      v_policy_id := v_policy.id;
      v_policy_limits := v_policy.limits;
      IF v_policy.limits ? 'maxAffectedRows' THEN
        v_max_rows := (v_policy.limits->>'maxAffectedRows')::integer;
        v_limit_satisfied := v_affected_rows <= v_max_rows;
      END IF;
    END IF;
  END IF;

  IF NOT v_scope_ok THEN
    v_approval_policy := 'human_required';
    v_reason := format('External credential lacks required scope %s.', v_required_scope);
  ELSIF v_risk = 'safe_draft' THEN
    v_approval_policy := 'automatic';
    v_reason := 'Safe draft creation or update is reversible and executes automatically by default.';
  ELSIF NOT v_target_matched THEN
    v_approval_policy := 'human_required';
    v_reason := 'Consequential writes require human approval unless a matching credential-bound delegation policy applies.';
  ELSIF NOT v_create_only THEN
    v_approval_policy := 'human_required';
    v_reason := 'Automatic writes are limited to create and append operations. Updates and overwrites remain human-required.';
  ELSIF NOT v_limit_satisfied THEN
    v_approval_policy := 'human_required';
    v_reason := 'The matching delegation policy limit would be exceeded.';
  ELSE
    v_approval_policy := 'delegated';
    v_reason := 'The matching owner or steward delegation policy permits this bounded create or append write.';
  END IF;

  RETURN jsonb_build_object(
    'riskClass', v_risk,
    'approvalPolicy', v_approval_policy,
    'policyId', v_policy_id,
    'policyReason', v_reason,
    'policyLimits', v_policy_limits,
    'policyTarget', coalesce(v_target, '{}'::jsonb),
    'policyEvidence', jsonb_build_object(
      'actorKind', v_actor_kind,
      'credentialId', api.current_credential_id(),
      'requiredScope', v_required_scope,
      'scopeSatisfied', v_scope_ok,
      'targetMatched', v_target_matched,
      'createOnly', v_create_only,
      'affectedRows', v_affected_rows,
      'maxAffectedRows', v_max_rows,
      'limitSatisfied', v_limit_satisfied,
      'riskClass', v_risk,
      'evaluatedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.require_agent_operation_capability(p_proposal api.agent_operation_proposals)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_proposal.operation_kind LIKE 'pipeline_definition.%' THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'pipelines.manage');
  ELSIF p_proposal.operation_kind = 'dataset_rows.commit' THEN
    IF NOT api.is_workspace_writer(p_proposal.workspace_id) THEN
      RAISE EXCEPTION 'workspace writer required' USING ERRCODE='42501';
    END IF;
  ELSIF p_proposal.operation_kind IN (
    'notebook_block.insert','record.create','record.custom_fields.update',
    'sheet_instance.create','template.instantiate'
  ) THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'record.create');
  ELSE
    PERFORM api.require_capability(p_proposal.workspace_id,'schema.edit');
  END IF;
END;
$function$;--> statement-breakpoint
ALTER FUNCTION internal.agent_operation_contract_core(uuid, jsonb) OWNER TO migrator;
ALTER FUNCTION internal.agent_operation_execute_core(uuid) OWNER TO migrator;
ALTER FUNCTION internal.agent_operation_policy_evaluate_core(uuid, jsonb, jsonb) OWNER TO migrator;
ALTER FUNCTION internal.require_agent_operation_capability(api.agent_operation_proposals) OWNER TO migrator;
