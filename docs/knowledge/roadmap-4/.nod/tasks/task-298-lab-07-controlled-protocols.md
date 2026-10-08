---
id: task-298
title: LAB-07 — Controlled protocols
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-08"
parent: epic-269
related:
  - task-2
tags:
  - LAB-07
  - LAB
  - wave-D
---

# LAB-07 — Controlled protocols

Spec: [LAB-07 in tasks/LAB.md](../../tasks/LAB.md#lab-07--controlled-protocols)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 6 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/db/schema.ts:3479-3508 — protocol training keyed by protocol record/user, no version.; src/routes/protocols/$protocolId.tsx:482-489 — manual training status write.; src/routes/experiments/$expId/overview.tsx:130-132 — explicitly no protocol version stored in this experiment surface.; docs/knowledge/roadmap-4/tasks/LAB.md:296-338 — controlled versions/acknowledgement/start/deviation requirements.. Remaining: Complete effective/superseded lifecycle, per-version training/enforcement/reminders, periodic review and pinned-version deviation history; respect regulated-use decision gates. Existing Training tab is not controlled protocol delivery. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-07. Source audit, not fresh service/browser acceptance.
- 2026-10-08: Coordinator (local): controlled-protocol server contracts implemented as migration 0328 (protocol_versions, acknowledgements, project_protocols, eligibility and start guards) with the approval engine extended for protocol_revision stage ordering. tests/db/controlled-protocols.test.ts passes 9/9; protocol units 22. Remaining: deviations, periodic review, used-by and parity.
