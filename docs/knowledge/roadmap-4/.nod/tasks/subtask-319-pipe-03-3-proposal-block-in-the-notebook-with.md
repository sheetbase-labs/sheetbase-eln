---
id: subtask-319
title: PIPE-03.3 — Proposal block in the notebook with Compare / Accept / Reject
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-316
tags:
  - PIPE-03.3
  - PIPE
---

# PIPE-03.3 — Proposal block in the notebook with Compare / Accept / Reject

Step 3 of 3 in [PIPE-03](../../tasks/PIPE.md#pipe-03--eln-actions-as-proposals); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: closed as covered by EXP-04.6, which built this block. The notebook's pipeline_output block renders a linked agent-operation proposal with the design's Compare / Accept / Reject wired to the real decide_agent_operation and execute_agent_operation RPCs, including the reject reason and the expected-revision guard; Compare shows the proposal's preview and impact against the block's current output; a block with no linked proposal, or one that is unreadable or already decided, states that rather than showing inert controls, and a read-only surface never posts a decision. Nine tests cover those states. Its upstream is still missing: PIPE-03.1 (an action mode propose, so the executor writes a proposal instead of calling the RPC) and PIPE-03.2 (an accept RPC for a notebook-block insert), so no proposal is produced for a block yet and an unlinked block correctly reports absence.
