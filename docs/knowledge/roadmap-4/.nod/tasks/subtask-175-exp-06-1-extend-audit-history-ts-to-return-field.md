---
id: subtask-175
title: EXP-06.1 — Extend audit-history.ts to return field
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-174
tags:
  - EXP-06.1
  - EXP
---

# EXP-06.1 — Extend audit-history.ts to return field

Step 1 of 2 in [EXP-06](../../tasks/EXP.md#exp-06--history-tab); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. src/lib/audit-history.ts returns the field/old/new changes (changesOf, describeAuditEvent), the reason, the session and client from the payload, and auditKnockOnEvents for explicitly linked effects; src/components/audit/experiment-history.test.tsx asserts the captured values, the session, the client and the knock-on region.
