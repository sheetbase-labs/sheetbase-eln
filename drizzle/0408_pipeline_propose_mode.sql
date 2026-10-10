-- PIPE-03.1 — a pipeline can propose instead of acting.
--
-- The owner decided a proposal may be proposed by *either* an AI agent or a pipeline run,
-- so there is one proposal system, one accept path and one audit, and the record says which
-- kind proposed it. That is what the first two blocks do: the kind list gains a notebook
-- block insert, and propose_agent_operation accepts a pipeline provenance beside the agent
-- one.
--
-- The last two blocks give the new kind a contract (what a reader is shown before deciding)
-- and an execution (what accepting does). Accepting applies through the canonical
-- api.insert_block, as the accepting person, exactly like every other kind.
--
-- The functions are patched rather than reproduced: each patch asserts its marker was found,
-- so a failure to match raises instead of silently leaving the function unchanged.

-- 1. The kind list.
ALTER TABLE api.agent_operation_proposals
  DROP CONSTRAINT chk_agent_operation_proposals_kind;
--> statement-breakpoint
ALTER TABLE api.agent_operation_proposals
  ADD CONSTRAINT chk_agent_operation_proposals_kind CHECK (
    operation_kind IN (
      'dataset_schema.create',
      'sheet_definition.create',
      'sheet_definition.update_draft',
      'pipeline_definition.create',
      'pipeline_definition.create_version',
      'pipeline_definition.update_draft',
      'dataset_rows.commit',
      'notebook_block.insert'
    )
  );
--> statement-breakpoint

-- 2. Provenance: an agent, or a pipeline run.
DO $$
DECLARE
  def text;
  agent_open text := 'IF jsonb_typeof(p_provenance) IS DISTINCT FROM ''object''';
  agent_close text := 'OR length(btrim(p_provenance->''model''->>''name'')) NOT BETWEEN 1 AND 200 THEN';
  agent_raise text := 'RAISE EXCEPTION ''agent, tool, model, and invocation provenance are required'' USING ERRCODE = ''22023'';
  END IF;';
  pipeline_guard text;
BEGIN
  def := pg_get_functiondef('api.propose_agent_operation(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
  IF position('pipeline provenance is incomplete' in def) > 0 THEN RETURN; END IF;

  IF position(agent_open in def) = 0 OR position(agent_close in def) = 0
     OR position(agent_raise in def) = 0 THEN
    RAISE EXCEPTION 'provenance patch marker not found';
  END IF;

  -- Wrap the agent checks so a pipeline provenance skips them...
  def := replace(def, agent_open,
    'IF coalesce(p_provenance->>''kind'','''') <> ''pipeline'' AND ('
    || 'jsonb_typeof(p_provenance) IS DISTINCT FROM ''object''');
  def := replace(def, agent_close,
    'OR length(btrim(p_provenance->''model''->>''name'')) NOT BETWEEN 1 AND 200) THEN');

  -- ...and check the pipeline shape instead.
  pipeline_guard := agent_raise || E'\n'
    || '  IF p_provenance->>''kind'' = ''pipeline'' AND (' || E'\n'
    || '       p_provenance - ARRAY[''kind'',''pipelineId'',''pipelineName'',''definitionVersionId'',''runId'',''invocationId''] <> ''{}''::jsonb' || E'\n'
    || '       OR length(btrim(coalesce(p_provenance->>''pipelineId'',''''))) NOT BETWEEN 1 AND 200' || E'\n'
    || '       OR length(btrim(coalesce(p_provenance->>''pipelineName'',''''))) NOT BETWEEN 1 AND 200' || E'\n'
    || '       OR length(btrim(coalesce(p_provenance->>''runId'',''''))) NOT BETWEEN 1 AND 200' || E'\n'
    || '       OR length(btrim(coalesce(p_provenance->>''invocationId'',''''))) NOT BETWEEN 1 AND 200) THEN' || E'\n'
    || '    RAISE EXCEPTION ''pipeline provenance is incomplete'' USING ERRCODE = ''22023'';' || E'\n'
    || '  END IF;';
  def := replace(def, agent_raise, pipeline_guard);

  EXECUTE def;
END $$;
--> statement-breakpoint

-- 3. Contract: what a reader is shown before deciding.
DO $$
DECLARE
  def text;
  marker text := E'  ELSE\n    RAISE EXCEPTION ''unsupported or human-only operation kind''';
  branch text;
BEGIN
  def := pg_get_functiondef('internal.agent_operation_contract(uuid,jsonb)'::regprocedure);
  IF position('notebook_block.insert' in def) > 0 THEN RETURN; END IF;
  IF position(marker in def) = 0 THEN
    RAISE EXCEPTION 'contract patch marker not found';
  END IF;

  branch := E'  ELSIF v_kind = ''notebook_block.insert'' THEN\n'
    || E'    PERFORM internal.require_agent_proposal_permission(p_workspace_id, ''record.create'');\n'
    || E'    SELECT workspace_id, structure_version INTO v_workspace, v_revision\n'
    || E'      FROM api.records WHERE id = (p_operation->>''recordId'')::uuid;\n'
    || E'    IF p_operation - ARRAY[''kind'',''recordId'',''afterBlockId'',''block'',''expectedRevision''] <> ''{}''::jsonb\n'
    || E'       OR v_workspace IS DISTINCT FROM p_workspace_id\n'
    || E'       OR p_operation->>''expectedRevision'' IS NULL\n'
    || E'       OR jsonb_typeof(p_operation->''block'') IS DISTINCT FROM ''object''\n'
    || E'       OR length(btrim(coalesce(p_operation->''block''->>''type'',''''))) NOT BETWEEN 1 AND 48\n'
    || E'       OR jsonb_typeof(p_operation->''block''->''payload'') IS DISTINCT FROM ''object'' THEN\n'
    || E'      RAISE EXCEPTION ''invalid notebook block operation'' USING ERRCODE = ''22023'';\n'
    || E'    END IF;\n'
    || E'    v_target := jsonb_build_object(''type'',''record'',''id'',p_operation->>''recordId'',''label'',''Notebook block'');\n'
    || E'    RETURN jsonb_build_object(\n'
    || E'      ''preview'', jsonb_build_object(\n'
    || E'        ''formatVersion'',1,''kind'',v_kind,''target'',v_target,\n'
    || E'        ''expectedRevision'',(p_operation->>''expectedRevision'')::bigint,\n'
    || E'        ''currentRevision'',v_revision,\n'
    || E'        ''changes'', jsonb_build_array(jsonb_build_object(\n'
    || E'          ''path'',''blocks'',''before'',NULL,\n'
    || E'          ''after'', jsonb_build_object(\n'
    || E'            ''afterBlockId'',p_operation->''afterBlockId'',\n'
    || E'            ''type'',p_operation->''block''->>''type'',\n'
    || E'            ''payload'',p_operation->''block''->''payload''\n'
    || E'          )\n'
    || E'        ))\n'
    || E'      ),\n'
    || E'      ''impact'', jsonb_build_object(\n'
    || E'        ''formatVersion'',1,''mutationClass'',''content'',''target'',v_target,\n'
    || E'        ''createsDraft'',false,''affectedRows'',1,''destructive'',false\n'
    || E'      )\n'
    || E'    );\n';

  def := replace(def, marker, branch || marker);
  EXECUTE def;
END $$;
--> statement-breakpoint

-- 4. Execution: accepting applies it, as the accepting person.
DO $$
DECLARE
  def text;
  marker text := E'    ELSE\n      RAISE EXCEPTION ''unsupported or human-only operation kind''';
  branch text;
BEGIN
  def := pg_get_functiondef('internal.agent_operation_execute(uuid)'::regprocedure);
  IF position('notebook_block.insert' in def) > 0 THEN RETURN; END IF;
  IF position(marker in def) = 0 THEN
    RAISE EXCEPTION 'execute patch marker not found';
  END IF;

  branch := E'    ELSIF v_result.operation_kind = ''notebook_block.insert'' THEN\n'
    || E'      v_execution := api.insert_block(\n'
    || E'        (v_operation->>''recordId'')::uuid,\n'
    || E'        v_operation->''block''->>''type'',\n'
    || E'        v_operation->''block''->''payload'',\n'
    || E'        coalesce((v_operation->''block''->>''payloadSchemaVersion'')::integer, 1),\n'
    || E'        nullif(v_operation->>''afterBlockId'','''')::uuid,\n'
    || E'        (v_operation->>''expectedRevision'')::integer,\n'
    || E'        NULL\n'
    || E'      );\n';

  def := replace(def, marker, branch || marker);
  EXECUTE def;
END $$;
--> statement-breakpoint

NOTIFY pgrst, 'reload schema';
