---
id: subtask-210
title: DSET-03.3 — Snapshots and Compare tabs per design
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
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
- 2026-10-02: 2026-10-02 reopened against current code: see DSET-03 reconciliation note and RECONCILIATION.md#dset-03. Implemented subsets retained; full step requirement is not met.
- 2026-10-03: Snapshots route gains manual Create snapshot (existing snapshotDataset, label dialog, writer gating, mapped error toasts), a completed inspector (creator/source/cited-by/hash/retention) and a Compare picker linking both versions; compare.tsx now pages with useInfiniteQuery (p_limit 100/p_offset) and a Load more control driven by the server counts, flag deltas unchanged. Evidence: snapshot-data.test.ts + snapshots.test.tsx + compare.test.tsx (19), pnpm test 304/3242, interactions/areas/screens green. Commit next.
