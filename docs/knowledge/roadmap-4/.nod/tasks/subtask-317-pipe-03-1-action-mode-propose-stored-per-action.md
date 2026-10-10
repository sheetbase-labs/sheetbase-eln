---
id: subtask-317
title: PIPE-03.1 — Action mode propose stored per action
type: subtask
status: todo
priority: low
created: "2026-09-27"
updated: "2026-09-27"
parent: task-316
tags:
  - PIPE-03.1
  - PIPE
---

# PIPE-03.1 — Action mode propose stored per action

Step 1 of 3 in [PIPE-03](../../tasks/PIPE.md#pipe-03--eln-actions-as-proposals); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: DECISION TAKEN (owner), implementation next. How a pipeline's proposal says who proposed it: the owner chose to keep one proposal system and let a proposal be proposed by *either* an AI agent or a pipeline run, so the record is truthful and there is still one approval path. Rejected: writing the pipeline into the agent/model fields (those fields would mean two things and a reader could not tell a pipeline from an agent), and a second pipeline-proposal table (honest fields, but a second lifecycle with its own accept/reject/expire/audit, and the notebook block would have to render two shapes). Implementation plan, in order: (1) a migration adding 'notebook_block.insert' to chk_agent_operation_proposals_kind and relaxing propose_agent_operation's provenance check to accept either the agent shape or a pipeline shape ({kind:'pipeline', pipelineId, pipelineName, definitionVersionId, runId, invocationId}); (2) a branch in internal.agent_operation_contract for the new kind, validating the operation's keys (recordId, afterBlockId, block, expectedRevision) and building preview and impact; (3) a risk class for it in internal.agent_operation_policy_evaluate; (4) a branch in internal.agent_operation_execute applying it through the canonical block-insert RPC as the accepting user; (5) PipelineAction gains mode 'execute' | 'propose' in src/lib/pipelines/actions.ts and src/lib/pipeline-actions.server.ts writes the proposal instead of calling the RPC when the mode is 'propose'; (6) a DB test proving nothing changes before accept and that accept is attributed to the person with the run number. The kind list is a fixed set with no notebook-block kind today, so (1) is required whichever option had been chosen.
