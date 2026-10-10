---
id: subtask-165
title: EXP-04.4 — Inspector tabs
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.4
  - EXP
---

# EXP-04.4 — Inspector tabs

Step 4 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The inspector's tabs (Properties, Comments, History) exist as NotebookInspector with Properties built on canonicalCellFacts; Comments and History are slots fed by the existing CommentPanel and NotebookHistoryPanel. The selected cell is lifted out of the sheet workspace to the route as a stable callback (SheetCellSelection), adapted through canonicalCellFacts and rendered at the head of the existing Properties tab, so the route's record metadata and its other tabs are unchanged - an addition to a live surface, not a replacement. Selection is gated on the grid's own selection report, so an untouched Sheet leaves the inspector describing the record. 124 tests across five files, including a route test that drives a real cell selection and asserts the value, unit and validation notice appear while the record metadata stays. Not covered: historical mode, where the hook is disabled and frozen evidence mounts no grid.
