---
id: subtask-233
title: SHEET-02.1 — Promotion request
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-232
tags:
  - SHEET-02.1
  - SHEET
---

# SHEET-02.1 — Promotion request

Step 1 of 4 in [SHEET-02](../../tasks/SHEET.md#sheet-02--promote-local-columns); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0401; tests/db/schema-evolution.test.ts, 4 cases in the file). api.column_promotions records a pending promotion (instance, field, target, the draft schema version or the model key, state, the approval request, reason, who asked) with a unique open request per field. api.request_column_promotion reuses the same fork (internal.fork_dataset_schema_version) and the same field append that promote_local_field uses, so a request produces exactly the draft version a direct promotion would - and, as before, writes nothing to the dataset: the RPC creates no dataset and no rows. The draft is held pending against an MDL-03 approval request with object_kind 'column_promotion' and the steward as the required approver role. The test proves the pending state, the draft version carrying the field, the pending approval request, an unchanged dataset row count, and that a second request for the same field is refused. Note: for the model_field target the RPC records the pending request but creates no field, because creating one is the approval's effect; SHEET-02.2 owns the applied path for both targets.
