---
id: task-298
title: LAB-07 — Controlled protocols
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
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
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
  - 2026-10-09: reopened after the steps closed. All six steps now hold, but the task exit is not met: the parity boards for ProtocolsList and ProtocolDetail are red (test-results/parity-coverage.json, 43 mapped boards failing) and the review surface does not yet render protocol_deviations (only the experiment History does). Steps 1-6 verified: drizzle/0328 (versions, approval chain, eligibility), 0351 (start gate), 0354/0355 (periodic review, used-by), 0352/0353/0356 (deviations + History), 0358 (reminders), with DB tests in controlled-protocols, experiment-start-lifecycle, protocol-periodic-review, protocol-deviations, protocol-training-reminders.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/db/schema.ts:3479-3508 — protocol training keyed by protocol record/user, no version.; src/routes/protocols/$protocolId.tsx:482-489 — manual training status write.; src/routes/experiments/$expId/overview.tsx:130-132 — explicitly no protocol version stored in this experiment surface.; docs/knowledge/roadmap-4/tasks/LAB.md:296-338 — controlled versions/acknowledgement/start/deviation requirements.. Remaining: Complete effective/superseded lifecycle, per-version training/enforcement/reminders, periodic review and pinned-version deviation history; respect regulated-use decision gates. Existing Training tab is not controlled protocol delivery. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-07. Source audit, not fresh service/browser acceptance.
- 2026-10-08: Coordinator (local): controlled-protocol server contracts implemented as migration 0328 (protocol_versions, acknowledgements, project_protocols, eligibility and start guards) with the approval engine extended for protocol_revision stage ordering. tests/db/controlled-protocols.test.ts passes 9/9; protocol units 22. Remaining: deviations, periodic review, used-by and parity.
- 2026-10-09: All steps done; closed by roadmap sync.
