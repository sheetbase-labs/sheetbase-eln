---
id: subtask-209
title: DSET-03.2 — RPC compare_dataset_versions(a, b) returning added, changed
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: task-207
tags:
  - DSET-03.2
  - DSET
---

# DSET-03.2 — RPC compare_dataset_versions(a, b) returning added, changed

Step 2 of 3 in [DSET-03](../../tasks/DSET.md#dset-03--snapshots-and-comparison); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.compare_dataset_versions (added/changed/removed rows, per-field changes incl. flag-only, column changes, paginated) + internal.dataset_version_row_values; tests/db/dataset-version-compare.test.ts.
- 2026-10-02: 2026-10-02 reopened against current code: see DSET-03 reconciliation note and RECONCILIATION.md#dset-03. Implemented subsets retained; full step requirement is not met.
- 2026-10-02: Comparison now includes flag-only changes: internal.dataset_version_row_flags + dataset_version_flag_delta FULL JOINed with values; a row is 'changed' when values differ or the flag delta is non-empty; counts.flags and rows[].flagFields (added/removed/changed with reason/comment) added additively. The boolean-field test is replaced by real flag-only cases. Evidence: migration 0278 (applied to dev DB), tests/db/dataset-version-compare.test.ts (9), full pnpm test:db 143/1176, pnpm test 304/3242, interactions/areas/screens green, db:generate clean. Commit 55329db2.
