---
id: task-174
title: EXP-06 — History tab
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-144
related:
  - task-2
tags:
  - EXP-06
  - EXP
  - wave-B
---

# EXP-06 — History tab

Spec: [EXP-06 in tasks/EXP.md](../../tasks/EXP.md#exp-06--history-tab)

- Stream: EXP (epic-144)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 2 subtasks

## Work Log
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/experiments/$expId/history.tsx:25-39 — selects only revisions with reason/time/digest and limit 50.; src/routes/experiments/$expId/history.tsx:47-75 — simple table; no actor/category filters, inspector or CSV action.. Remaining: Restore real audit timeline with category/actor filters, old/new/reason/session/knock-on details, workspace timezone and matching filtered export; completed History step contradicted by current code. See docs/knowledge/roadmap-4/RECONCILIATION.md#exp-06. Source audit, not fresh service/browser acceptance.
- 2026-10-08: Coordinator (local): EXP-06 immutable audit capture integrated as migration 0326 and accepted after independent review. tests/db/exp-06-history.test.ts passes 4/4 on a fresh disposable database; typecheck, focused audit units (50) and eslint pass. Remaining: scientific/Sheet worker causality, revocation/isolation and the wider negative matrix.
