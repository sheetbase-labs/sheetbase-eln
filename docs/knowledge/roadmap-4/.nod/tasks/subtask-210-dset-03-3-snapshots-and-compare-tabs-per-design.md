---
id: subtask-210
title: DSET-03.3 — Snapshots and Compare tabs per design
type: subtask
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-09-28"
parent: task-207
tags:
  - DSET-03.3
  - DSET
---

# DSET-03.3 — Snapshots and Compare tabs per design

Step 3 of 3 in [DSET-03](../../tasks/DSET.md#dset-03--snapshots-and-comparison); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: the dataset Versions tab now shows each snapshot's row count and change against the previous one, with a compare summary, from api.dataset_version_list / compare_dataset_versions. The full Compare tab and 'Save a snapshot now' remain.
- 2026-09-28: PR #206: 'Save a snapshot now' dialog in the Versions tab (api.snapshot_dataset with the live revision and a label); the full Compare tab remains.
- 2026-09-28: PR #206: dedicated Compare tab — pick two snapshots, read added/changed/removed rows with per-field from→to and column changes from compare_dataset_versions.
