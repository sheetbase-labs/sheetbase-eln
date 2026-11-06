-- Agents can propose the money actions: mark an order placed, set or clear an
-- order's price, and set or clear an instrument's recharge rate.
--
-- Each is the same canonical RPC a person uses (api.mark_reagent_ordered,
-- api.set_reagent_order_price, api.set_instrument_rate), reached through a
-- proposal that a person approves (always human_required). The price on file is
-- shown in the preview only to someone who may see prices.
--
-- Pipelines can bulk import: an action may run once for each row of the step
-- before it. The database copy of the action catalogue (used to check a
-- pipeline when it is saved) is replaced here with the current catalogue, which
-- was missing the three money actions, and it now checks the row loop.

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
      'notebook_block.update','notebook_block.move','notebook_block.delete',
      'workspace_ai_settings.update','record.create',
      'record.custom_fields.update','sheet_instance.create',
      'sheet_instance.update','sheet_instance.archive','sheet_instance.restore',
      'sheet_instance.materialize',
      'template.instantiate','template.upgrade','record.comment.create',
      'model_field.create','model_field.update','model_field.activate',
      'reagent_order.mark_ordered','reagent_order.set_price','instrument_rate.set'
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
  v_preview jsonb;
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

  ELSIF v_kind = 'notebook_block.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, b.version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedVersion','payload','payloadSchemaVersion'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedVersion' IS NULL
       OR jsonb_typeof(p_operation->'payload') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid notebook block update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','block','id',p_operation->>'blockId','label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','payload',
          'before',(SELECT payload FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),
          'after',p_operation->'payload'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'notebook_block.move' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, r.structure_version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedStructureVersion','afterBlockId','beforeBlockId'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL THEN
      RAISE EXCEPTION 'invalid notebook block move operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',(SELECT record_id FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'label','Notebook order');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','order','before',NULL,
          'after',jsonb_build_object(
            'blockId',p_operation->>'blockId',
            'afterBlockId',p_operation->>'afterBlockId',
            'beforeBlockId',p_operation->>'beforeBlockId'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'notebook_block.delete' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT r.workspace_id, r.structure_version INTO v_workspace, v_revision
      FROM api.blocks b JOIN api.records r ON r.id = b.record_id
     WHERE b.id = (p_operation->>'blockId')::uuid;
    IF p_operation - ARRAY['kind','blockId','expectedStructureVersion'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL THEN
      RAISE EXCEPTION 'invalid notebook block delete operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',(SELECT record_id FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'label','Notebook block');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','block','before',(SELECT payload FROM api.blocks WHERE id=(p_operation->>'blockId')::uuid),'after',NULL
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',true
      )
    );

  ELSIF v_kind = 'sheet_instance.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision','state'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL
       OR jsonb_typeof(p_operation->'state') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid Sheet Instance update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','state','before',(SELECT state FROM api.sheet_instances WHERE id=(p_operation->>'instanceId')::uuid),
          'after',p_operation->'state'
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.archive' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL THEN
      RAISE EXCEPTION 'invalid Sheet Instance archive operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','active','after','archived'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.restore' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'archived'
       OR p_operation->>'expectedRevision' IS NULL THEN
      RAISE EXCEPTION 'invalid Sheet Instance restore operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','archived','after','active'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'template.upgrade' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, structure_version INTO v_workspace, v_revision
      FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','expectedStructureVersion','targetVersionId','decisions','parameterInputs'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'expectedStructureVersion' IS NULL
       OR p_operation->>'targetVersionId' IS NULL
       OR NOT EXISTS (
            SELECT 1 FROM api.notebook_template_versions v
             JOIN api.notebook_templates t ON t.id = v.template_id
            WHERE v.id = (p_operation->>'targetVersionId')::uuid
              AND v.lifecycle = 'published'
              AND t.workspace_id = p_workspace_id)
       OR jsonb_typeof(p_operation->'decisions') IS DISTINCT FROM 'array'
       OR jsonb_typeof(p_operation->'parameterInputs') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid template upgrade operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook template upgrade');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedStructureVersion')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','templateVersion','before',NULL,
          'after',jsonb_build_object(
            'targetVersionId',p_operation->>'targetVersionId',
            'decisions',p_operation->'decisions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'record.comment.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id INTO v_workspace FROM api.records WHERE id = (p_operation->>'recordId')::uuid;
    IF p_operation - ARRAY['kind','recordId','targetKind','target','body','mentions'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR p_operation->>'targetKind' NOT IN ('record','block')
       OR length(btrim(coalesce(p_operation->>'body',''))) NOT BETWEEN 1 AND 8000
       OR (p_operation->'target' IS NOT NULL AND jsonb_typeof(p_operation->'target') IS DISTINCT FROM 'object')
       OR (p_operation->'mentions' IS NOT NULL AND jsonb_typeof(p_operation->'mentions') IS DISTINCT FROM 'array')
       OR (p_operation->>'targetKind' = 'block' AND (
            p_operation->'target'->>'blockId' IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM api.blocks b
               WHERE b.id = (p_operation->'target'->>'blockId')::uuid
                 AND b.record_id = (p_operation->>'recordId')::uuid))) THEN
      RAISE EXCEPTION 'invalid record comment operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','record','id',p_operation->>'recordId','label','Notebook comment');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','comment','before',NULL,
          'after',jsonb_build_object(
            'targetKind',p_operation->>'targetKind',
            'target',p_operation->'target',
            'body',p_operation->>'body',
            'mentions',p_operation->'mentions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'reagent_order.mark_ordered' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','orderId','orderReference','expectedOn','supplier','supplierRecordId','totalPrice','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'orderId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR (p_operation->>'supplierRecordId' IS NOT NULL AND p_operation->>'supplierRecordId' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
       OR (p_operation->>'expectedOn' IS NOT NULL AND p_operation->>'expectedOn' !~ '^\d{4}-\d{2}-\d{2}$')
       OR length(coalesce(p_operation->>'orderReference','')) > 200
       OR length(coalesce(p_operation->>'supplier','')) > 200
       OR (p_operation ? 'totalPrice' AND (jsonb_typeof(p_operation->'totalPrice') <> 'number' OR (p_operation->>'totalPrice')::numeric < 0))
       OR (p_operation ? 'totalPrice' AND coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$')
       OR NOT EXISTS (
            SELECT 1 FROM api.reagent_orders o
             WHERE o.id = (p_operation->>'orderId')::uuid
               AND o.workspace_id = p_workspace_id
               AND o.status = 'requested') THEN
      RAISE EXCEPTION 'invalid reagent order operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','reagent_order','id',p_operation->>'orderId','label','Reagent order');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(
          jsonb_build_object('path','status','before','requested','after','ordered')
        ) || CASE WHEN p_operation ? 'totalPrice' THEN jsonb_build_array(
          jsonb_build_object('path','price','before',NULL,
            'after',jsonb_build_object('totalPrice',p_operation->'totalPrice','currency',p_operation->>'currency'))
        ) ELSE '[]'::jsonb END
          || CASE WHEN p_operation ? 'supplier' OR p_operation ? 'supplierRecordId' THEN jsonb_build_array(
          jsonb_build_object('path','supplier','before',NULL,
            'after',jsonb_build_object('supplier',p_operation->>'supplier','supplierRecordId',p_operation->>'supplierRecordId'))
        ) ELSE '[]'::jsonb END
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',false
      )
    );

  ELSIF v_kind = 'reagent_order.set_price' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','orderId','totalPrice','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'orderId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR NOT (p_operation ? 'totalPrice')
       OR jsonb_typeof(p_operation->'totalPrice') NOT IN ('number','null')
       OR (jsonb_typeof(p_operation->'totalPrice') = 'number' AND (
             (p_operation->>'totalPrice')::numeric < 0
             OR coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$'))
       OR NOT EXISTS (
            SELECT 1 FROM api.reagent_orders o
             WHERE o.id = (p_operation->>'orderId')::uuid
               AND o.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid reagent order price operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','reagent_order','id',p_operation->>'orderId','label','Reagent order price');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','price',
          -- The price now on file is shown only to someone who may see prices.
          'before',(SELECT CASE WHEN coalesce(api.has_capability(p_workspace_id,'schema.edit'),false)
                                THEN jsonb_build_object('totalPrice',p.total_price,'currency',p.currency) END
                      FROM api.reagent_order_prices p WHERE p.order_id = (p_operation->>'orderId')::uuid),
          'after',CASE WHEN jsonb_typeof(p_operation->'totalPrice') = 'number'
                       THEN jsonb_build_object('totalPrice',p_operation->'totalPrice','currency',p_operation->>'currency') END
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','content','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',jsonb_typeof(p_operation->'totalPrice') = 'null'
      )
    );

  ELSIF v_kind = 'instrument_rate.set' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'instrument.manage');
    IF p_operation - ARRAY['kind','instrumentId','ratePerHour','currency'] <> '{}'::jsonb
       OR coalesce(p_operation->>'instrumentId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR NOT (p_operation ? 'ratePerHour')
       OR jsonb_typeof(p_operation->'ratePerHour') NOT IN ('number','null')
       OR (jsonb_typeof(p_operation->'ratePerHour') = 'number' AND (
             (p_operation->>'ratePerHour')::numeric < 0
             OR coalesce(p_operation->>'currency','') !~ '^[A-Z]{3}$'))
       OR NOT EXISTS (
            SELECT 1 FROM api.instruments i
             WHERE i.id = (p_operation->>'instrumentId')::uuid
               AND i.workspace_id = p_workspace_id) THEN
      RAISE EXCEPTION 'invalid instrument rate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','instrument','id',p_operation->>'instrumentId',
      'label',coalesce((SELECT i.name FROM api.instruments i WHERE i.id = (p_operation->>'instrumentId')::uuid),'Instrument'));
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','ratePerHour',
          'before',(SELECT jsonb_build_object('ratePerHour',r.rate_per_hour,'currency',r.currency)
                      FROM api.instrument_rates r WHERE r.instrument_id = (p_operation->>'instrumentId')::uuid),
          'after',CASE WHEN jsonb_typeof(p_operation->'ratePerHour') = 'number'
                       THEN jsonb_build_object('ratePerHour',p_operation->'ratePerHour','currency',p_operation->>'currency') END
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',1,'destructive',jsonb_typeof(p_operation->'ratePerHour') = 'null'
      )
    );

  ELSIF v_kind = 'model_field.create' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    IF p_operation - ARRAY['kind','workspaceId','modelKey','fieldName','label','logicalType','nullable','defaultValue','validation','unit','description'] <> '{}'::jsonb
       OR (p_operation->>'workspaceId')::uuid IS DISTINCT FROM p_workspace_id
       OR length(btrim(coalesce(p_operation->>'fieldName',''))) NOT BETWEEN 1 AND 63
       OR length(btrim(coalesce(p_operation->>'label',''))) NOT BETWEEN 1 AND 200
       OR p_operation->>'logicalType' NOT IN ('text','integer','decimal','boolean','date','timestamp','category','reference')
       OR (p_operation->'validation' IS NOT NULL AND jsonb_typeof(p_operation->'validation') IS DISTINCT FROM 'object')
       OR (p_operation->'unit' IS NOT NULL AND jsonb_typeof(p_operation->'unit') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'invalid model field create operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_operation->>'workspaceId','label','New model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','field','before',NULL,'after',p_operation - 'kind'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',true,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'model_field.update' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    SELECT workspace_id INTO v_workspace FROM api.record_field_definitions WHERE id = (p_operation->>'definitionId')::uuid;
    IF p_operation - ARRAY['kind','definitionId','patch'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR jsonb_typeof(p_operation->'patch') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid model field update operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_workspace_id,'label','Model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','field','before',NULL,'after',p_operation->'patch'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'model_field.activate' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'schema.edit');
    SELECT workspace_id INTO v_workspace FROM api.record_field_definitions WHERE id = (p_operation->>'definitionId')::uuid;
    IF p_operation - ARRAY['kind','definitionId'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id THEN
      RAISE EXCEPTION 'invalid model field activate operation' USING ERRCODE = '22023';
    END IF;
    v_target := jsonb_build_object('type','workspace','id',p_workspace_id,'label','Model field');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'changes',jsonb_build_array(jsonb_build_object('path','lifecycle','before','draft','after','active'))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','configuration','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
      )
    );

  ELSIF v_kind = 'sheet_instance.materialize' THEN
    PERFORM internal.require_agent_proposal_permission(p_workspace_id, 'record.create');
    SELECT workspace_id, revision, lifecycle INTO v_workspace, v_revision, v_lifecycle
      FROM api.sheet_instances WHERE id = (p_operation->>'instanceId')::uuid;
    IF p_operation - ARRAY['kind','instanceId','expectedRevision','outputName','outputSchemaVersionId','previewDigest'] <> '{}'::jsonb
       OR v_workspace IS DISTINCT FROM p_workspace_id
       OR v_lifecycle IS DISTINCT FROM 'active'
       OR p_operation->>'expectedRevision' IS NULL
       OR length(btrim(coalesce(p_operation->>'outputName',''))) NOT BETWEEN 1 AND 200
       OR coalesce(p_operation->>'previewDigest','') !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid Sheet Instance materialization operation' USING ERRCODE = '22023';
    END IF;
    v_preview := api.preview_sheet_materialization(
      (p_operation->>'instanceId')::uuid,
      (p_operation->>'expectedRevision')::bigint,
      nullif(p_operation->>'outputSchemaVersionId','')::uuid
    );
    IF v_preview->>'previewDigest' IS DISTINCT FROM p_operation->>'previewDigest' THEN
      RAISE EXCEPTION 'materialization preview digest is stale' USING ERRCODE = 'SB089';
    END IF;
    v_target := jsonb_build_object('type','sheet_instance','id',p_operation->>'instanceId','label','Sheet Instance materialization');
    RETURN jsonb_build_object(
      'preview', jsonb_build_object(
        'formatVersion',1,'kind',v_kind,'target',v_target,
        'expectedRevision',(p_operation->>'expectedRevision')::bigint,
        'currentRevision',v_revision,
        'changes',jsonb_build_array(jsonb_build_object(
          'path','materialization','before',NULL,
          'after',jsonb_build_object(
            'outputName',btrim(p_operation->>'outputName'),
            'outputSchemaVersionId',p_operation->>'outputSchemaVersionId',
            'previewDigest',p_operation->>'previewDigest',
            'fieldCount',jsonb_array_length(v_preview->'derivedOutputFields'),
            'sourceVersions',v_preview->'sourceVersions'
          )
        ))
      ),
      'impact', jsonb_build_object(
        'formatVersion',1,'mutationClass','data','target',v_target,
        'createsDraft',false,'affectedRows',0,'destructive',false
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
$function$;
--> statement-breakpoint
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
    ELSIF v_result.operation_kind = 'notebook_block.update' THEN
      v_execution := to_jsonb(api.update_block_payload(
        (v_operation->>'blockId')::uuid,
        v_operation->'payload',
        (v_operation->>'expectedVersion')::integer,
        coalesce((v_operation->>'payloadSchemaVersion')::integer,1)
      ));
    ELSIF v_result.operation_kind = 'notebook_block.move' THEN
      v_execution := api.move_block(
        (v_operation->>'blockId')::uuid,
        (v_operation->>'expectedStructureVersion')::integer,
        nullif(v_operation->>'afterBlockId','')::uuid,
        nullif(v_operation->>'beforeBlockId','')::uuid
      );
    ELSIF v_result.operation_kind = 'notebook_block.delete' THEN
      v_execution := api.delete_block(
        (v_operation->>'blockId')::uuid,
        (v_operation->>'expectedStructureVersion')::integer
      );
    ELSIF v_result.operation_kind = 'sheet_instance.update' THEN
      v_execution := to_jsonb(api.update_sheet_instance(
        (v_operation->>'instanceId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->'state'
      ));
    ELSIF v_result.operation_kind = 'sheet_instance.archive' THEN
      v_execution := to_jsonb(api.archive_sheet_instance(
        (v_operation->>'instanceId')::uuid,
        (v_operation->>'expectedRevision')::bigint
      ));
    ELSIF v_result.operation_kind = 'sheet_instance.restore' THEN
      v_execution := to_jsonb(api.restore_sheet_instance(
        (v_operation->>'instanceId')::uuid,
        (v_operation->>'expectedRevision')::bigint
      ));
    ELSIF v_result.operation_kind = 'template.upgrade' THEN
      v_execution := api.apply_notebook_template_upgrade(
        (v_operation->>'recordId')::uuid,
        (v_operation->>'expectedStructureVersion')::integer,
        (v_operation->>'targetVersionId')::uuid,
        v_operation->'decisions',
        v_operation->'parameterInputs'
      );
    ELSIF v_result.operation_kind = 'record.comment.create' THEN
      v_execution := api.create_record_comment(
        (v_operation->>'recordId')::uuid,
        v_operation->>'targetKind',
        coalesce(v_operation->'target','{}'::jsonb),
        v_operation->>'body',
        ARRAY(SELECT jsonb_array_elements_text(coalesce(v_operation->'mentions','[]'::jsonb)))
      );
    ELSIF v_result.operation_kind = 'reagent_order.mark_ordered' THEN
      v_execution := to_jsonb(api.mark_reagent_ordered(
        (v_operation->>'orderId')::uuid,
        v_operation->>'orderReference',
        (v_operation->>'expectedOn')::date,
        v_operation->>'supplier',
        (v_operation->>'supplierRecordId')::uuid,
        (v_operation->>'totalPrice')::numeric,
        v_operation->>'currency'
      ));
      -- The canonical result carries the price; the proposal keeps only the order.
      v_execution := jsonb_build_object('orderId', v_execution->>'id', 'status', v_execution->>'status');
    ELSIF v_result.operation_kind = 'reagent_order.set_price' THEN
      PERFORM api.set_reagent_order_price(
        (v_operation->>'orderId')::uuid,
        (v_operation->>'totalPrice')::numeric,
        v_operation->>'currency'
      );
      v_execution := jsonb_build_object('orderId', v_operation->>'orderId', 'priced', v_operation->>'totalPrice' IS NOT NULL);
    ELSIF v_result.operation_kind = 'instrument_rate.set' THEN
      PERFORM api.set_instrument_rate(
        (v_operation->>'instrumentId')::uuid,
        (v_operation->>'ratePerHour')::numeric,
        v_operation->>'currency'
      );
      v_execution := jsonb_build_object('instrumentId', v_operation->>'instrumentId', 'rated', v_operation->>'ratePerHour' IS NOT NULL);
    ELSIF v_result.operation_kind = 'model_field.create' THEN
      v_execution := to_jsonb(api.create_model_field(
        v_result.workspace_id,
        v_operation->>'modelKey',
        v_operation->>'fieldName',
        v_operation->>'label',
        v_operation->>'logicalType',
        coalesce((v_operation->>'nullable')::boolean,true),
        v_operation->'defaultValue',
        coalesce(v_operation->'validation','{}'::jsonb),
        v_operation->'unit',
        v_operation->>'description'
      ));
    ELSIF v_result.operation_kind = 'model_field.update' THEN
      v_execution := to_jsonb(api.update_model_field(
        (v_operation->>'definitionId')::uuid,
        v_operation->'patch'
      ));
    ELSIF v_result.operation_kind = 'model_field.activate' THEN
      v_execution := to_jsonb(api.activate_model_field(
        (v_operation->>'definitionId')::uuid
      ));
    ELSIF v_result.operation_kind = 'sheet_instance.materialize' THEN
      v_execution := api.materialize_sheet_instance(
        (v_operation->>'instanceId')::uuid,
        (v_operation->>'expectedRevision')::bigint,
        v_operation->>'outputName',
        nullif(v_operation->>'outputSchemaVersionId','')::uuid,
        v_operation->>'previewDigest',
        v_result.id
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
$function$;
--> statement-breakpoint
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
    WHEN v_kind IN ('notebook_block.update','notebook_block.move','notebook_block.delete') THEN 'projects:write'
    WHEN v_kind IN ('sheet_instance.update','sheet_instance.archive','sheet_instance.restore','sheet_instance.materialize') THEN 'sheets:write'
    WHEN v_kind = 'template.upgrade' THEN 'templates:write'
    WHEN v_kind = 'record.comment.create' THEN 'projects:write'
    WHEN v_kind IN ('model_field.create','model_field.update','model_field.activate') THEN 'models:write'
    WHEN v_kind IN ('reagent_order.mark_ordered','reagent_order.set_price','instrument_rate.set') THEN 'facility:write'
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
$function$;
--> statement-breakpoint
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
  ELSIF p_proposal.operation_kind = 'instrument_rate.set' THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'instrument.manage');
  ELSIF p_proposal.operation_kind IN (
    'notebook_block.insert','notebook_block.update','notebook_block.move',
    'notebook_block.delete','record.create','record.custom_fields.update',
    'sheet_instance.create','sheet_instance.update','sheet_instance.archive',
    'sheet_instance.restore','sheet_instance.materialize',
    'template.instantiate','template.upgrade',
    'record.comment.create'
  ) THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'record.create');
  ELSE
    PERFORM api.require_capability(p_proposal.workspace_id,'schema.edit');
  END IF;
END;
$function$;
--> statement-breakpoint
ALTER FUNCTION internal.agent_operation_contract_core(uuid, jsonb) OWNER TO migrator;
ALTER FUNCTION internal.agent_operation_execute_core(uuid) OWNER TO migrator;
ALTER FUNCTION internal.agent_operation_policy_evaluate_core(uuid, jsonb, jsonb) OWNER TO migrator;
ALTER FUNCTION internal.require_agent_operation_capability(api.agent_operation_proposals) OWNER TO migrator;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION internal.pipeline_action_errors(p_actions jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO ''
    AS $_$
DECLARE
  v_catalogue constant jsonb := $catalogue$[{"operation":"insert_block","rpc":"insert_block","label":"Insert a notebook block","description":"Insert a block into a notebook record, after a named block. A step may propose this instead of doing it.","proposalKind":"notebook_block.insert","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_type","type":"text","required":true,"nullable":false},{"name":"p_payload","type":"jsonb","required":true,"nullable":false},{"name":"p_payload_schema_version","type":"integer","required":false,"nullable":false},{"name":"p_after_block_id","type":"uuid","required":false,"nullable":true},{"name":"p_expected_structure_version","type":"integer","required":false,"nullable":false},{"name":"p_before_block_id","type":"uuid","required":false,"nullable":true}]},{"operation":"create_project","rpc":"create_project","label":"Create project","description":"Create a project in the run workspace.","arguments":[{"name":"p_title","type":"text","required":true,"nullable":false}]},{"operation":"create_model_record","rpc":"create_model_record","label":"Create record","description":"Create an experiment, sample, material, report or supported model record in a project.","arguments":[{"name":"p_project_id","type":"uuid","required":true,"nullable":false},{"name":"p_kind","type":"text","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":false},{"name":"p_status","type":"text","required":false,"nullable":false},{"name":"p_tags","type":"text[]","required":false,"nullable":false},{"name":"p_properties","type":"jsonb","required":false,"nullable":false},{"name":"p_custom_fields","type":"jsonb","required":false,"nullable":false}]},{"operation":"update_record_custom_fields","rpc":"update_record_custom_fields","label":"Update record properties","description":"Update workspace properties using the current record metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_values","type":"jsonb","required":true,"nullable":false}]},{"operation":"archive_record","rpc":"archive_record","label":"Archive record","description":"Archive a record using the current metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false}]},{"operation":"restore_record","rpc":"restore_record","label":"Restore record","description":"Restore an archived record using the current metadata version.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false}]},{"operation":"create_record_link","rpc":"create_record_link","label":"Link records","description":"Create a link from a source record to a target record in the workspace.","arguments":[{"name":"p_source_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_target_kind","type":"text","required":true,"nullable":false},{"name":"p_target_identifier","type":"text","required":true,"nullable":false},{"name":"p_link_type","type":"text","required":true,"nullable":false},{"name":"p_target_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_label","type":"text","required":false,"nullable":true}]},{"operation":"transfer_sample","rpc":"transfer_sample","label":"Move sample","description":"Record a sample storage transfer with chain-of-custody evidence.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_to_location","type":"text","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"receive_sample","rpc":"receive_sample","label":"Receive sample stock","description":"Add sample stock and record the receipt.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_unit","type":"text","required":false,"nullable":true},{"name":"p_location","type":"text","required":false,"nullable":true},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"consume_sample","rpc":"consume_sample","label":"Consume sample stock","description":"Reduce sample stock and record its use.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_quantity","type":"numeric","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"edit_sample","rpc":"edit_sample","label":"Update sample details","description":"Update sample metadata without bypassing custody operations.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_title","type":"text","required":true,"nullable":true},{"name":"p_properties","type":"jsonb","required":true,"nullable":true},{"name":"p_tags","type":"text[]","required":true,"nullable":true},{"name":"p_notes","type":"text","required":true,"nullable":true},{"name":"p_custom_fields","type":"jsonb","required":true,"nullable":true}]},{"operation":"archive_sample","rpc":"archive_sample","label":"Archive sample","description":"Archive a sample with custody evidence","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"restore_sample","rpc":"restore_sample","label":"Restore sample","description":"Restore an archived sample with custody evidence.","arguments":[{"name":"p_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_notes","type":"text","required":false,"nullable":true}]},{"operation":"record_reagent_movement","rpc":"record_reagent_movement","label":"Record material movement","description":"Receive, consume or adjust material stock through its governed movement operation.","arguments":[{"name":"p_reagent_record_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_metadata_version","type":"integer","required":true,"nullable":false},{"name":"p_operation","type":"text","required":true,"nullable":false},{"name":"p_quantity_delta","type":"numeric","required":false,"nullable":false},{"name":"p_reason","type":"text","required":false,"nullable":true}]},{"operation":"mark_reagent_ordered","rpc":"mark_reagent_ordered","label":"Mark an order as placed","description":"Mark a requested reagent order as ordered, with its supplier, price and currency.","proposalKind":"reagent_order.mark_ordered","arguments":[{"name":"p_order_id","type":"uuid","required":true,"nullable":false},{"name":"p_order_reference","type":"text","required":false,"nullable":true},{"name":"p_expected_on","type":"date","required":false,"nullable":true},{"name":"p_supplier","type":"text","required":false,"nullable":true},{"name":"p_supplier_record_id","type":"uuid","required":false,"nullable":true},{"name":"p_total_price","type":"numeric","required":false,"nullable":true},{"name":"p_currency","type":"text","required":false,"nullable":true}]},{"operation":"set_reagent_order_price","rpc":"set_reagent_order_price","label":"Set the price of an order","description":"Record or change what a reagent order cost, so spend adds up. Needs the right to place orders.","proposalKind":"reagent_order.set_price","arguments":[{"name":"p_order_id","type":"uuid","required":true,"nullable":false},{"name":"p_total_price","type":"numeric","required":true,"nullable":true},{"name":"p_currency","type":"text","required":false,"nullable":true}]},{"operation":"set_instrument_rate","rpc":"set_instrument_rate","label":"Set an instrument’s recharge rate","description":"Set what each booked hour of an instrument is charged, or no charge with an empty rate. Needs the right to manage instruments.","proposalKind":"instrument_rate.set","arguments":[{"name":"p_instrument_id","type":"uuid","required":true,"nullable":false},{"name":"p_rate_per_hour","type":"numeric","required":true,"nullable":true},{"name":"p_currency","type":"text","required":true,"nullable":true}]},{"operation":"commit_dataset_row_batch","rpc":"commit_dataset_row_batch","label":"Commit dataset rows","description":"Commit a validated row batch at the expected dataset revision.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_dataset_revision","type":"bigint","required":true,"nullable":false},{"name":"p_rows","type":"jsonb","required":true,"nullable":false},{"name":"p_idempotency_key","type":"text","required":true,"nullable":false,"server":"idempotency"}]},{"operation":"snapshot_dataset","rpc":"snapshot_dataset","label":"Snapshot dataset","description":"Create an immutable dataset version with a label.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_dataset_revision","type":"bigint","required":true,"nullable":false},{"name":"p_label","type":"text","required":true,"nullable":false}]},{"operation":"archive_dataset","rpc":"archive_dataset","label":"Archive dataset","description":"Archive a dataset through dependency and revision checks.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]},{"operation":"restore_dataset","rpc":"restore_dataset","label":"Restore dataset","description":"Restore an archived dataset at the expected revision.","arguments":[{"name":"p_dataset_id","type":"uuid","required":true,"nullable":false},{"name":"p_expected_revision","type":"bigint","required":true,"nullable":false}]}]$catalogue$::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_action jsonb; v_definition jsonb; v_argument jsonb; v_key text;
  v_names text[] := '{}';
BEGIN
  IF jsonb_typeof(p_actions) IS DISTINCT FROM 'array' THEN
    RETURN '[{"code":"invalid_shape","field":"actions","message":"actions must be an array"}]'::jsonb;
  END IF;
  IF jsonb_array_length(p_actions) > 20 THEN
    RETURN '[{"code":"too_many","field":"actions","message":"At most twenty ELN actions are allowed."}]'::jsonb;
  END IF;
  FOR v_action IN SELECT value FROM jsonb_array_elements(p_actions) LOOP
    IF jsonb_typeof(v_action) IS DISTINCT FROM 'object'
      OR coalesce(v_action->>'name','') !~ '^[a-z][a-z0-9_]{0,47}$'
      OR v_action->>'name' = ANY(v_names)
      OR v_action->>'name' IN ('constructor','prototype') THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"Each action needs a unique lowercase name."}]'::jsonb;
      CONTINUE;
    END IF;
    v_names := array_append(v_names, v_action->>'name');
    SELECT value INTO v_definition FROM jsonb_array_elements(v_catalogue) WHERE value->>'operation' = v_action->>'operation';
    IF v_definition IS NULL THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"Unsupported ELN action."}]'::jsonb;
      CONTINUE;
    END IF;
    IF v_action ? 'mode' AND v_action->>'mode' NOT IN ('execute','propose') THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"unknown action mode"}]'::jsonb;
      CONTINUE;
    END IF;
    IF v_action ? 'forEach' AND (
         jsonb_typeof(v_action->'forEach') IS DISTINCT FROM 'object'
         OR (SELECT count(*) FROM jsonb_object_keys(v_action->'forEach')) <> 1
         OR coalesce(v_action->'forEach'->>'$ref','') !~ '^(previous|parameters|output|actions)(\.[A-Za-z0-9_-]+)*$') THEN
      v_errors := v_errors || '[{"code":"invalid_value","field":"actions","message":"An action that repeats for each row needs a list to take the rows from."}]'::jsonb;
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_action->'arguments') IS DISTINCT FROM 'object' THEN
      v_errors := v_errors || '[{"code":"invalid_shape","field":"actions","message":"Action inputs must be an object."}]'::jsonb;
      CONTINUE;
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_action->'arguments') LOOP
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_definition->'arguments') arg WHERE arg->>'name' = v_key AND NOT arg ? 'server') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','invalid_value','field','actions','message','This action input is not editable: ' || v_key));
      END IF;
    END LOOP;
    FOR v_argument IN SELECT value FROM jsonb_array_elements(v_definition->'arguments') LOOP
      IF v_argument->'required' = 'true'::jsonb AND NOT v_argument ? 'server' AND NOT (v_action->'arguments') ? (v_argument->>'name') THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('code','missing_required','field','actions','message','Required action input: ' || (v_argument->>'name')));
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_errors;
END $_$;
--> statement-breakpoint
ALTER FUNCTION internal.pipeline_action_errors(p_actions jsonb) OWNER TO migrator;
