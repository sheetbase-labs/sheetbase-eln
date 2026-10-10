---
id: subtask-235
title: SHEET-02.3 — Promote dialog (SheetPromote) and returned banner (PromoteRejected)
type: subtask
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-232
tags:
  - SHEET-02.3
  - SHEET
---

# SHEET-02.3 — Promote dialog (SheetPromote) and returned banner (PromoteRejected)

Step 3 of 4 in [SHEET-02](../../tasks/SHEET.md#sheet-02--promote-local-columns); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: components implemented, wiring not done; stays open. SheetPromote requests a reviewed promotion - pick the target Dataset Schema Definition, see the local field's key/type/unit, give a reason, submit through request_column_promotion (never the direct promote path), with an incompatible field surfacing the server's SB071 refusal rather than a success; PromoteRejected renders only when the promotion is returned, stating the approver's reason and that the column stays local. Six tests cover the request path, the refusal and the banner's wording (it must not claim the column moved). NOT done: neither component is mounted - the dialog belongs in the sheet's local-column affordance (the grid's column menu in canonical-sheet-workspace.tsx, where 'Retire local column' already lives) and the banner in the sheet workspace. Also recorded: the request RPC is per field, so the canvas's multi-column dialog opens per column; the approver's name is not exposed by api.column_promotions, only the reason; and the canvas's 'create a new dataset' target is not available because the RPC path is target='dataset_schema' against an existing Definition, as the ticket specifies.
