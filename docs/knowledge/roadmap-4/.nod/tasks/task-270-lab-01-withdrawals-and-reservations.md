---
id: task-270
title: LAB-01 — Withdrawals and reservations
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-269
related:
  - task-2
tags:
  - LAB-01
  - LAB
  - wave-D
---

# LAB-01 — Withdrawals and reservations

Spec: [LAB-01 in tasks/LAB.md](../../tasks/LAB.md#lab-01--withdrawals-and-reservations)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/samples/$sampleId.tsx:59-65 — withdraw passes quantity/notes to consumeSample.; src/routes/samples/$sampleId/usage.tsx:27-40 — usage reads record_links, not quantity/reservation ledger.; Search current src/drizzle found no withdraw_sample or sample_reservations.. Remaining: Purpose/derived-container withdrawal, reservations and used/reserved/free semantics remain; preserve sample_events authority and enforce reserved-volume refusal server-side. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-01. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.
