---
id: subtask-199
title: DSET-01.3 — Planned rows
type: subtask
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-09-28"
parent: task-196
tags:
  - DSET-01.3
  - DSET
---

# DSET-01.3 — Planned rows

Step 3 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: planned rows — dataset_rows status/scheduled_at, api.plan_dataset_row (writer-gated) and a trigger refusing values on a planned row; tests/db/planned-dataset-rows.test.ts. NOTE: the DB test could not be executed because the local Docker/Postgres engine became unresponsive after an OrbStack restart; typecheck and lint pass.
