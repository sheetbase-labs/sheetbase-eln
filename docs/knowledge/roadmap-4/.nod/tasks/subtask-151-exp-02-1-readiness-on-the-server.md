---
id: subtask-151
title: EXP-02.1 — Readiness on the server
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-150
tags:
  - EXP-02.1
  - EXP
---

# EXP-02.1 — Readiness on the server

Step 1 of 4 in [EXP-02](../../tasks/EXP.md#exp-02--overview-plan-progress-and-readiness); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0382; tests/db/experiment-readiness.test.ts, 5 cases). api.experiment_readiness(record_id) reports validation errors from the checks that did not pass on the record's latest revision (with the sheet/cell location carried in the check payload), open comment threads (roots only), and required Sheet parameters with no value and no binding, and returns ready only when all three are empty. api.submit_record_revision now reads the same function and refuses with SB123, so the list and the block cannot disagree; the test proves both directions (blocked while a thread is open, submitted once the record is ready). The submit RPC is patched from its current definition rather than rebuilt, so unrelated later changes to it cannot be lost. Note for the remaining EXP-02 steps: the author-facing surface still computes readiness client-side in src/lib/assist-guide.ts, so wiring the guide to this RPC is the follow-up rather than part of this server step.
