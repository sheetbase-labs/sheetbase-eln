---
id: subtask-167
title: EXP-04.6 — Pipeline proposal block (PIPE-03 provides data)
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.6
  - EXP
---

# EXP-04.6 — Pipeline proposal block (PIPE-03 provides data)

Step 6 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The notebook's pipeline_output block renders a linked agent-operation proposal with the design's Compare / Accept / Reject wired to the real decide_agent_operation and execute_agent_operation RPCs, including the reject reason and the expected-revision guard; Compare shows the proposal's preview and impact against the block's current output. A block with no linked proposal, or one that is unreadable or already decided, states that rather than showing inert controls, and a read-only surface never posts a decision (it links to the decision surface instead). Nine tests cover those states; 23 pass with the block validator's file. Two deviations: the proposal is pinned on the existing pipeline_output block via payload.proposalId rather than a separate block type, and the decision controls live in the block editor because it is the only surface told readOnly. PIPE-03 still owes: a propose action mode, a run_id or discovery rule on a proposal, a notebook-block operation kind the proposals check accepts, and an apply RPC for a block insert.
