---
id: subtask-214
title: DSET-04.3 — "Keep" RPC with reason
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-211
tags:
  - DSET-04.3
  - DSET
---

# DSET-04.3 — "Keep" RPC with reason

Step 3 of 3 in [DSET-04](../../tasks/DSET.md#dset-04--snapshot-retention); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.keep_dataset_version stores a keep beside the immutable snapshot (dataset_version_keeps, not exposed) with a required reason; retention honours it. DB tests.
- 2026-09-27: Correction: the Keep RPC landed; the warning banner before removal and the SnapshotRemoved tombstone view remain, so this step is not complete.
- 2026-10-03: Keep action (api.keep_dataset_version with required reason, writer-gated, mapped errors), truthful prune warning from retention.reason/keptUntil/policy (most urgent, overdue first), and tombstone presentation for rowsRemovedAt (Removed rows, What's left inspector, compare explained). Evidence: snapshot-data.test.ts + snapshots.test.tsx + dataset-explorer-data.test.ts (63), pnpm test, interactions/areas/screens green. Commit next. Caveat: api.dataset_version_list computes contentHash from frozen rows at read time, so after pruning the hash/row count are lost; the tombstone deliberately shows neither. Persisting the frozen hash/pruned count needs a migration.
