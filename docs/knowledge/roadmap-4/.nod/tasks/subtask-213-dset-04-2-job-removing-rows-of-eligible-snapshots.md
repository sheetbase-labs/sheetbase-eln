---
id: subtask-213
title: DSET-04.2 — Job removing rows of eligible snapshots
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
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
- 2026-10-02: 2026-10-02 reopened against current code: see DSET-04 reconciliation note and RECONCILIATION.md#dset-04. Implemented subsets retained; full step requirement is not met.
- 2026-10-03: Scheduled retention sweep added: src/lib/dataset-retention-scheduler.server.ts follows the pipeline-scheduler pattern and calls api.prune_dataset_versions(100) every 6h from src/start.ts, guarded by SHEETBASE_SCHEDULER_ENABLED and disabled under the test runner unless explicitly enabled; failures are logged and do not break the interval. Admin diagnostics report the scheduler state and last-24h pruned count. Evidence: dataset-retention-scheduler.server.test.ts (5), typecheck/lint clean, pnpm build green. Commit cbafa6ee.
