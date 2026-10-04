---
id: subtask-208
title: DSET-03.1 — Snapshot list read model
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-207
tags:
  - DSET-03.1
  - DSET
---

# DSET-03.1 — Snapshot list read model

Step 1 of 3 in [DSET-03](../../tasks/DSET.md#dset-03--snapshots-and-comparison); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.dataset_version_list (snapshot list with made-by, row count and change vs previous); DB test.
- 2026-10-02: 2026-10-02 reopened against current code: see DSET-03 reconciliation note and RECONCILIATION.md#dset-03. Implemented subsets retained; full step requirement is not met.
- 2026-10-03: Snapshot list read model completed: api.dataset_version_list additively returns createdBy (id/credential/name), contentHash (sha256 over frozen rows/values/flags), source (pipeline run or manual/api), citedBy (signed revisions, pipeline runs, analyses), retention.policy beside reason/keptUntil, and rowsRemovedAt. snapshots.tsx replaces the hardcoded Kept/policy with the real state and shows producer/hash/citations. Evidence: migration 0279 (applied to dev DB), tests/db/dataset-version-list.test.ts (5), full pnpm test:db 144/1181, pnpm test 304/3242, interactions/areas/screens green, db:generate clean. Commit next. Caveat: imports do not yet record a structured producer link, so import snapshots report manual/api (truthful); structured import provenance waits on DSET-05/06.
