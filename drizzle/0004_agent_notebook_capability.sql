-- Notebook block proposals use the canonical Notebook capability.
--
-- `notebook_block.insert` was already a validated proposal kind, but the
-- approval/execution gate fell through to `schema.edit`. Notebook blocks are
-- authored under `record.create` (the same capability `insert_block` requires
-- for a person), so an ordinary member could not approve a proposal they were
-- allowed to author. Keep the gate aligned with the canonical operation.
--
-- Delegation is deliberately not extended: notebook inserts remain
-- human_required until a policy target and UI are designed for them.

CREATE OR REPLACE FUNCTION internal.require_agent_operation_capability(p_proposal api.agent_operation_proposals)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF p_proposal.operation_kind LIKE 'pipeline_definition.%' THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'pipelines.manage');
  ELSIF p_proposal.operation_kind = 'dataset_rows.commit' THEN
    IF NOT api.is_workspace_writer(p_proposal.workspace_id) THEN
      RAISE EXCEPTION 'workspace writer required' USING ERRCODE='42501';
    END IF;
  ELSIF p_proposal.operation_kind = 'notebook_block.insert' THEN
    PERFORM api.require_capability(p_proposal.workspace_id,'record.create');
  ELSE
    PERFORM api.require_capability(p_proposal.workspace_id,'schema.edit');
  END IF;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION internal.require_agent_operation_capability(p_proposal api.agent_operation_proposals) OWNER TO migrator;
