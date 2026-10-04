---
id: task-211
title: DSET-04 — Snapshot retention
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-195
related:
  - task-2
  - task-12
tags:
  - DSET-04
  - DSET
  - wave-C
---

# DSET-04 — Snapshot retention

Spec: [DSET-04 in tasks/DSET.md](../../tasks/DSET.md#dset-04--snapshot-retention)

- Stream: DSET (epic-195)
- Wave: C
- Waits on: DEC-01 (task-2), DEC-11 (task-12)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/db/schema.ts:413-419 — workspace retention defaults exist; drizzle/0189_dataset_version_keep.sql:11-44 — keep RPC with reason; drizzle/0191_dataset_version_prune.sql:25-94 — protected pruning function and tombstone writes; src/routes/datasets/$datasetId/snapshots.tsx:82-84,122-125 — hardcoded Kept and policy text; src/scripts search — no caller scheduling prune_dataset_versions; no settings edit, keep action or removed snapshot page found. Remaining: 1 backend policy exists; workspace settings editing not found, acceptance unverified. 2 prune function exists and DB tests cover direct invocation, but a scheduled job invoking it is missing. 3 keep RPC exists; warning, keep UI and tombstone screen absent. Preserve backend work credit while reopening job-completion claim. See docs/knowledge/roadmap-4/RECONCILIATION.md#dset-04. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.
