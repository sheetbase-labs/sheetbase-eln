---
id: subtask-317
title: PIPE-03.1 — Action mode propose stored per action
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-316
tags:
  - PIPE-03.1
  - PIPE
---

# PIPE-03.1 — Action mode propose stored per action

Step 1 of 3 in [PIPE-03](../../tasks/PIPE.md#pipe-03--eln-actions-as-proposals); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0408, 0409; tests/db/pipeline-propose-mode.test.ts and a case in pipelines.test.ts). The owner decided one proposal system should serve both an AI agent and a pipeline run, so: the kind list gains notebook_block.insert; propose_agent_operation accepts a pipeline provenance ({kind:'pipeline', pipelineId, pipelineName, definitionVersionId, runId, invocationId}) beside the agent one, so a pipeline is not squeezed into agent fields; internal.agent_operation_contract gains a branch validating the operation (recordId, afterBlockId, block, expectedRevision) and building the preview and impact a reader sees before deciding; internal.agent_operation_execute gains a branch applying it through the canonical api.insert_block as the accepting person; the action catalogue gains insert_block in both places it is mirrored (src/lib/pipelines/actions.ts and the governed catalogue inside internal.pipeline_action_errors); PipelineAction gains mode 'execute' | 'propose', validated on both sides, and the executor writes the proposal instead of calling the RPC when a step proposes. An operation with no proposal form cannot be proposed, and validation refuses it before the run starts rather than failing mid-run. Inserting content is a consequential write, so a proposal waits for a person rather than auto-executing. The SQL functions were patched rather than reproduced, and every patch asserts its marker was found so a missed match raises instead of leaving a function unchanged. Verified: 3 DB tests on the proposal (nothing changes before accept, accept is attributed to the person, a malformed pipeline provenance is refused), one on the executor (a propose step writes the proposal and inserts no block), and 55 unit tests.
  - 2026-10-10: DECISION TAKEN (owner), implementation next. How a pipeline's proposal says who proposed it: the owner chose to keep one proposal system and let a proposal be proposed by *either* an AI agent or a pipeline run, so the record is truthful and there is still one approval path. Rejected: writing the pipeline into the agent/model fields (those fields would mean two things and a reader could not tell a pipeline from an agent), and a second pipeline-proposal table (honest fields, but a second lifecycle with its own accept/reject/expire/audit, and the notebook block would have to render two shapes). Implementation plan, in order: (1) a migration adding 'notebook_block.insert' to chk_agent_operation_proposals_kind and relaxing propose_agent_operation's provenance check to accept either the agent shape or a pipeline shape ({kind:'pipeline', pipelineId, pipelineName, definitionVersionId, runId, invocationId}); (2) a branch in internal.agent_operation_contract for the new kind, validating the operation's keys (recordId, afterBlockId, block, expectedRevision) and building preview and impact; (3) a risk class for it in internal.agent_operation_policy_evaluate; (4) a branch in internal.agent_operation_execute applying it through the canonical block-insert RPC as the accepting user; (5) PipelineAction gains mode 'execute' | 'propose' in src/lib/pipelines/actions.ts and src/lib/pipeline-actions.server.ts writes the proposal instead of calling the RPC when the mode is 'propose'; (6) a DB test proving nothing changes before accept and that accept is attributed to the person with the run number. The kind list is a fixed set with no notebook-block kind today, so (1) is required whichever option had been chosen.
