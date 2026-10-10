---
id: subtask-172
title: EXP-05.4 — Conflict resolution
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-168
tags:
  - EXP-05.4
  - EXP
---

# EXP-05.4 — Conflict resolution

Step 4 of 5 in [EXP-05](../../tasks/EXP.md#exp-05--offline-editing-and-conflict-resolution); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed. api.sheet_cell_conflicts keeps both sides of a conflict with their authors and times, the coordinator added the missing raise path (api.record_cell_conflict, idempotent on an open conflict for the same cell and refusing to attribute a local edit to anyone but the caller), api.resolve_cell_conflict records the chosen value, the resolver and a required reason and refuses a second decision, and an unresolved conflict is a work item for the person whose edit conflicted. CellConflictPanel shows both sides with their authors, times and origin, lets the person choose a side or enter their own with a required reason, never renders as settled unless it is, and reports what the model does not record (no per-side edit reason, no stored pre-edit value). The panel is mounted in the sheet workspace against the selected cell, matched by stable row key and field id, with resolve invalidating the sheet-instance and work-items queries; a sheet with open conflicts shows the count with a way to reach the first. Eight panel tests, two workspace tests, seven DB tests. Not verified: the live grid round-trip and visual placement.
  - 2026-10-10: UI implemented; the server half landed earlier. CellConflictPanel shows both sides - each value with its author, its time and whether it came from this device or elsewhere - and lets the person choose one or enter their own, with a required reason; Resolve stays disabled until the reason is given and a refused RPC keeps the controls open with the server's message, so a conflict can never look settled when it is not. A resolved conflict renders the decision, the resolver and the reason instead of the controls. Eight tests. It also reports what the model does not record rather than filling the gap: the conflict table has no per-side edit reason and the pre-edit value is not stored, so the panel takes it optionally. NOT wired: the panel needs the grid selection to carry a row key (SheetCellSelection currently has only rowNumber) and the sheet workspace to mount it - recorded in the task note, along with invalidating the work-items query on resolve so the cell_conflict item refreshes.
