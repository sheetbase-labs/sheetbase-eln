---
id: task-365
title: REV-05 — Tamper-evident audit trail
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-346
related:
  - task-2
  - task-5
tags:
  - REV-05
  - REV
  - wave-C
---

# REV-05 — Tamper-evident audit trail

Spec: [REV-05 in tasks/REV.md](../../tasks/REV.md#rev-05--tamper-evident-audit-trail)

- Stream: REV (epic-346)
- Wave: C
- Waits on: DEC-01 (task-2), DEC-04 (task-5)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/settings/audit.tsx:22 — v3 audit page uses append-only change_events; line 30 caps loaded rows at 200.; src/routes/settings/audit.tsx:53 — local operation/text filtering; line 69 exports only visible rows.; src/db/schema.ts — current change-event model has no audit-chain previous/content hash; no nightly chain verifier found in migrations/scripts.. Remaining: 1 Hash chain and append-only insertion semantics; 2 nightly chain plus signed-digest verification/System entries; 3 full range/actor/project filters, retention and inspection export beyond last-200 UI, verification-result display. Existing append-only log is not a tamper-evident chain. See docs/knowledge/roadmap-4/RECONCILIATION.md#rev-05. Source audit, not fresh service/browser acceptance.
