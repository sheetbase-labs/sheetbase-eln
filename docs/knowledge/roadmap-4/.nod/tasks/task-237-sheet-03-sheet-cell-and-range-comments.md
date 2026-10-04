---
id: task-237
title: SHEET-03 — Sheet-cell and range comments
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-226
related:
  - task-2
tags:
  - SHEET-03
  - SHEET
  - wave-C
---

# SHEET-03 — Sheet-cell and range comments

Spec: [SHEET-03 in tasks/SHEET.md](../../tasks/SHEET.md#sheet-03--sheet-cell-and-range-comments)

- Stream: SHEET (epic-226)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 2 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/db/schema.ts:1537-1538 — comment target constraint only revision/block/table_region/diff; src/routes/sheets/$sheetId.tsx:74 — presence only, row-thread anchors await contract. Remaining: Both steps remain: stable canonical Sheet row/cell/range target model with stability proofs, then markers/inspector/shortcut/record comments/search. Existing table_region dataset comments are not Sheet cell anchors. See docs/knowledge/roadmap-4/RECONCILIATION.md#sheet-03. Source audit, not fresh service/browser acceptance.
- 2026-10-04: Owner requested full original SHEET-03 completion, one commit per task. Assigned canonical stable cell/row/range anchors and end-to-end grid/inspector/comment/search acceptance. Waiting on serial migration slot after REV; no exit accepted yet.
