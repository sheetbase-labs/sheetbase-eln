---
id: subtask-318
title: PIPE-03.2 — Accept RPC applies the change through the canonical RPC as the accepting user
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-316
tags:
  - PIPE-03.2
  - PIPE
---

# PIPE-03.2 — Accept RPC applies the change through the canonical RPC as the accepting user

Step 2 of 3 in [PIPE-03](../../tasks/PIPE.md#pipe-03--eln-actions-as-proposals); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed (drizzle/0410; tests/db/pipeline-propose-mode.test.ts, 4 cases). Accepting applies the change through the canonical RPC as the accepting person (implemented with PIPE-03.1: execute_agent_operation calls api.insert_block for the new kind, and the test proves the block lands with executed_by_user_id set to the person who accepted). Rejecting records its reason through decide_agent_operation, already covered by the agent-evaluation and agent-workflow suites. Superseding is now implemented: a pipeline runs on a schedule, so a propose step proposes the same change on every run, and only the newest should be actionable. A newer proposal supersedes older *pending* ones with the same operation payload (the same change) against the same target - comparing the operation, not just the target, so two different changes to one record do not collide. The superseded proposal is cancelled rather than deleted so the history shows the request was made and what became of it, with the reason recorded, and an idempotent replay returns early and supersedes nothing. Verified: the same change proposed twice supersedes the first, a different change to the same record leaves it pending.
