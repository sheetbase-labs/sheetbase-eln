---
id: subtask-234
title: SHEET-02.2 — On approval
type: subtask
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-232
tags:
  - SHEET-02.2
  - SHEET
---

# SHEET-02.2 — On approval

Step 2 of 4 in [SHEET-02](../../tasks/SHEET.md#sheet-02--promote-local-columns); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: the owner decided the local-only case should create a new dataset. Groundwork recorded before implementing: there is no dataset-creation RPC, but the creation itself is a single insert - api.materialize_sheet_instance does `INSERT INTO api.datasets(workspace_id, schema_version_id, name, created_by_user_id)` - so the promotion's applied path for a local-only Sheet needs that insert plus writing the local values as rows plus retiring the local column, all in one transaction. The rows need a dataset version, and api.commit_dataset_row_batch is the canonical writer. The existing api.apply_column_promotion (drizzle/0404) already handles the composed case and the returned case; what is missing is this third branch, which is why the step stays open rather than being closed on the composed path alone.
  - 2026-10-10: partially implemented; stays open on a design gap it exposed. api.apply_column_promotion (drizzle/0404) settles a promotion when its MDL-03 approval is decided: returned or withdrawn records the approver's reason and moves nothing, so the columns stay local; approved writes the sheet's values as a snapshot and retires the local column, both through the canonical materialize_sheet_instance and mutate_sheet_instance_local_state, in one transaction. Verified: a return settles as returned with the reason and leaves the column local; applying is refused by the canonical guard and leaves the promotion pending rather than half-applied. THE GAP: materialize_sheet_instance sources a snapshot from the Sheet's dataset *bindings* and refuses a Sheet with none ('materialization requires Dataset composition sources'), so a promotion of a local column in a local-only Sheet cannot be applied at all. The step says 'write values as a new snapshot sourced from the sheet', and a local-only Sheet has no such source - this needs a decision (write a new dataset from the local values, or require the Sheet to be composed before a local column can be promoted) before the applied path can be called done. Also found: settling as returned does not discard the draft version the request forked, so the same Definition cannot be asked for again until that is dealt with.
