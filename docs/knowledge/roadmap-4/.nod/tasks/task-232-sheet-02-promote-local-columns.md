---
id: task-232
title: SHEET-02 — Promote local columns
type: task
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-226
related:
  - task-2
  - task-261
tags:
  - SHEET-02
  - SHEET
  - wave-C
---

# SHEET-02 — Promote local columns

Spec: [SHEET-02 in tasks/SHEET.md](../../tasks/SHEET.md#sheet-02--promote-local-columns)

- Stream: SHEET (epic-226)
- Wave: C
- Waits on: DEC-01 (task-2), MDL-03 (task-261)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/lib/schema-evolution.ts:106-127 — immediate promote_local_field wrapper remains; drizzle/0096_core_055_evolution_promotion.sql:170 — immediate publish path; src/components/sheet/canonical-sheet-lifecycle-panel.tsx:310-338 — explicit materialization is a different existing operation; src/db/schema.ts — no promotion/approval request model. Remaining: 1 approval-backed promotion request absent. 2 approval transaction/snapshot/rebind and returned-state path absent. 3 request/returned UI absent. 4 direct UI caller no longer found, but governance path not implemented; do not confuse materialization with approved column promotion. Depends MDL-03. See docs/knowledge/roadmap-4/RECONCILIATION.md#sheet-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates MDL-03. Other partial implementation can continue; these are full-task acceptance dependencies.
