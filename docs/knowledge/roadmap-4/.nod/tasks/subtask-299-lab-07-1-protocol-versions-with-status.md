---
id: subtask-299
title: LAB-07.1 — Protocol versions with status
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-09"
parent: task-298
tags:
  - LAB-07.1
  - LAB
---

# LAB-07.1 — Protocol versions with status

Step 1 of 6 in [LAB-07](../../tasks/LAB.md#lab-07--controlled-protocols); the full step text is under “Steps” there.

## Work Log
  - 2026-10-09: verified against the current code and marked done. drizzle/0328 implements api.create_protocol_version / set_protocol_version_status (draft, in_review, effective, superseded, retired), effective_at, change_summary and the shared approval_requests chain; tests/db/controlled-protocols.test.ts (9 cases) proves the chain order, that approval is not effective, eligibility/supersede and the freeze of the version's revision.
