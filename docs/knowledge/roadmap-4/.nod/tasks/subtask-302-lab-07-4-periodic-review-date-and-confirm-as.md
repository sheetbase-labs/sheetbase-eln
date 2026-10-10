---
id: subtask-302
title: LAB-07.4 — Periodic review date and confirm-as-current / start new version
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-09"
parent: task-298
tags:
  - LAB-07.4
  - LAB
---

# LAB-07.4 — Periodic review date and confirm-as-current / start new version

Step 4 of 6 in [LAB-07](../../tasks/LAB.md#lab-07--controlled-protocols); the full step text is under “Steps” there.

## Work Log
  - 2026-10-09: verified and marked done. drizzle/0354 adds protocol_versions.review_due_at; drizzle/0355 adds api.confirm_protocol_version_current (extends the date for an effective, still-current version with a reason and an audited event, refuses superseded) and api.protocol_version_usage; tests/db/protocol-periodic-review.test.ts covers all three. Starting a new version remains api.create_protocol_version. Remaining at task level: the ProtocolDetail screen exit.
  - 2026-10-09: server contract + DB tests landed (drizzle/0354, 0355; tests/db/protocol-periodic-review.test.ts, 3 cases). api.confirm_protocol_version_current extends review_due_at for an effective, still-current version with a reason and an audited protocol_version event; superseded versions are refused (SB113). api.protocol_version_usage returns the pinned experiments and the acknowledged users, workspace-scoped. Remaining: the ProtocolsList/ProtocolDetail screen exits.
