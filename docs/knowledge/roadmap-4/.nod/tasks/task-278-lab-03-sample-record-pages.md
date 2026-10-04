---
id: task-278
title: LAB-03 — Sample record pages
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-269
related:
  - task-2
tags:
  - LAB-03
  - LAB
  - wave-D
---

# LAB-03 — Sample record pages

Spec: [LAB-03 in tasks/LAB.md](../../tasks/LAB.md#lab-03--sample-record-pages)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/samples/$sampleId/measurements.tsx:51-56 — reads sample_measurements.; src/routes/samples/$sampleId/measurements.tsx:159-170 — editable Record measurement action writes standalone measurement RPC.; docs/knowledge/roadmap-4/tasks/LAB.md:128-157 — explicitly requires read-only Dataset/integration aggregation with source-row links.; src/routes/samples/$sampleId/history.tsx — sample event history exists.. Remaining: Resolve measurement workflow conflict: aggregate authoritative Dataset/integration values with row provenance, then complete label/hold meter and verify lineage/details acceptance. Current measurement tab is implemented differently, not accepted task delivery. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-03. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.
- 2026-10-03: Reopened: the measurement-tab exit is met (read-only aggregation with source links), but 'the seeded SMP-2231 matches the design' is not: the design hold meter ('5 of 14 days used') and label ('2-8 C, use by') need LAB-02's hold duration/harvest/condition fields, which are not started; the sample model has only an optional expiryDate and the design seed stores none. LAB-02 owns unblocking this.
- 2026-10-03: Seed parity: SMP-2231 now carries holdCondition '2-8 C', holdStartedAt 2026-09-20, holdDurationDays 14 and holdUntil 2026-10-04 in properties, so at the frozen design clock (25 Sep 2026) the hold meter computes 5 of 14 days used, use by 04 Oct, matching the board; migration 0283 un-protects the hold base fields as user-editable metadata. The measurement tab aggregates dataset/integration values with source links. Evidence: db:seed:design idempotent, full pnpm test:db 147/1205, pnpm test, interactions/areas/screens green, db:generate clean. Commits d4f0d533.. next. Exit met: measurement tab shows only dataset/integration values with row links; seeded SMP-2231 matches the design hold meter.
