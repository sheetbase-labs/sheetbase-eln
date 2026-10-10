---
id: subtask-264
title: MDL-03.3 — Pending state UI (SchemaPending)
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-261
tags:
  - MDL-03.3
  - MDL
---

# MDL-03.3 — Pending state UI (SchemaPending)

Step 3 of 3 in [MDL-03](../../tasks/MDL.md#mdl-03--approval-of-model-versions); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Model versions surface: submit for approval (reason/roles/independence), locked SchemaPending state with submitter + roles, withdraw/approve/return-with-reason by a required approver, returned PromoteRejected state with reason, approval trail, and Publish gated on approval state. Server RPCs authoritative. Evidence: model-approval tests (16; 26 in the models area), pnpm test, interactions/areas/screens green. Commit next.
