---
id: subtask-238
title: SHEET-03.1 — New target kinds sheet_cell, sheet_row, sheet_range anchored to stable row…
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-237
tags:
  - SHEET-03.1
  - SHEET
---

# SHEET-03.1 — New target kinds sheet_cell, sheet_row, sheet_range anchored to stable row…

Step 1 of 2 in [SHEET-03](../../tasks/SHEET.md#sheet-03--sheet-cell-and-range-comments); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed; no new code needed. api.comments already admits sheet_cell, sheet_row and sheet_range (with the sheet_instance_id coupling and the record/revision rules), and tests/db/sheet-comments.test.ts (11 cases) proves the anchoring: exact identities retained after asymmetric sorting, filtering, row insertion and field label evolution; row and range anchors listed in the embedding Record; composed source identities retained through Definition upgrades and source deletion; stale revisions, coordinates, unknown identities and forged ownership refused; viewer and other-workspace mutation denied.
