---
id: subtask-262
title: MDL-03.1 — api.approval_requests
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-261
tags:
  - MDL-03.1
  - MDL
---

# MDL-03.1 — api.approval_requests

Step 1 of 3 in [MDL-03](../../tasks/MDL.md#mdl-03--approval-of-model-versions); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: api.approval_requests (reusable: object kind, version id, required approver roles, state pending/approved/returned/withdrawn, submitter/approver/reasons) + decisions; submit/withdraw/approve/return RPCs; publish_dataset_schema_version refuses without a completed approval; independence enforced; pending approvals surface as an approval_requested work item for the required roles. Evidence: migration 0290 (applied to dev DB), tests/db/approval-requests.test.ts (9), full pnpm test:db 154/1257, pnpm test 3386, interactions/areas/phone/screens green, db:generate clean. Commit bb8eca02.
