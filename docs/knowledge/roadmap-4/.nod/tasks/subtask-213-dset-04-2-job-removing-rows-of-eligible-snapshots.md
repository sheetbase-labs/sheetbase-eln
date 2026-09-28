---
id: subtask-213
title: DSET-04.2 — Job removing rows of eligible snapshots
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-09-28"
parent: task-211
tags:
  - DSET-04.2
  - DSET
---

# DSET-04.2 — Job removing rows of eligible snapshots

Step 2 of 3 in [DSET-04](../../tasks/DSET.md#dset-04--snapshot-retention); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.prune_dataset_versions removes row data only for eligible snapshots (archived past uncited retention, no keep, no signed citation), keeps identity/history/counts, records removal and emits a change event; immutability guard bypassed only inside the job. DB test.
- 2026-09-28: PR #206: restored PLAT-03/GOV-01 security invariants — RLS on the new internal tables, empty search_path on the preference RPCs, writer gate on dataset archive/restore, and quarantined the caller-scoped preference/follow RPCs in the mutation inventory. Full test:db green (1011).
