---
id: subtask-199
title: DSET-01.3 — Planned rows
type: subtask
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: task-196
tags:
  - DSET-01.3
  - DSET
---

# DSET-01.3 — Planned rows

Step 3 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: planned rows — dataset_rows status/scheduled_at, api.plan_dataset_row (writer-gated) and a trigger refusing values on a planned row; tests/db/planned-dataset-rows.test.ts. NOTE: the DB test could not be executed because the local Docker/Postgres engine became unresponsive after an OrbStack restart; typecheck and lint pass.
- 2026-09-28: PR #206: DB test verified after the Docker engine recovered (trigger inserted as migrator); migration applied, db:generate clean, gov-01/plat-03 pass.
- 2026-10-02: Planned rows now carry planned_key (partial unique index over active planned rows per dataset); plan_dataset_row/request_repeat accept it; validate_dataset_row_batch takes plannedKey and commit_dataset_row_batch fills a matching active planned row (planned->recorded, values written, operation 'fill') without duplicating; recorded/other-dataset/other-workspace rows are never hijacked; scheduled time preserved. Evidence: migration 0277 + tests/db/planned-row-import-fill.test.ts (7), full pnpm test:db 143/1175 green, db:generate clean, typecheck/lint clean. Commit next. REMAINING: the import wizard does not yet choose which mapped columns form the sample/well key (mapImportSheet does not populate plannedKey); DSET-05's mapping step owns supplying it.
