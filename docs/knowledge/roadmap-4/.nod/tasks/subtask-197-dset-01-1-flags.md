---
id: subtask-197
title: DSET-01.1 — Flags
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-196
tags:
  - DSET-01.1
  - DSET
---

# DSET-01.1 — Flags

Step 1 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: api.dataset_value_flags table + flag_dataset_value / clear_dataset_value_flag RPCs (writer-gated, row/field validated, duplicate active flag upserts) with RLS and DB tests. Copying flags into the next snapshot remains.
- 2026-09-28: PR #206: snapshot_dataset now freezes active value flags into dataset_version_flags; DB test proves a flag is captured. System-written validation flags remain.
- 2026-10-02: Mechanism landed: api.dataset_value_flags.source ('manual'|'system'); internal.sync_dataset_value_system_flags writes/clears the out_of_range system flag from the field's soft validation.extensions rule, only touching system flags; validate/commit batch call it and snapshot_dataset freezes source. Manual reason contract unchanged. Evidence: migration 0275 + tests/db/dataset-system-flags.test.ts (7), full pnpm test:db 141/1162 green, db:generate clean, typecheck/lint clean. Commit f6395251.. next. REMAINING for this step: rule sources for missing_unit, above_curve and high_cv are not in schema metadata yet (need import header unit state, curve definitions, replicate grouping); the writer helper is ready for them.
- 2026-10-03: Rules completed. `missing_unit` (numeric field whose quantity metadata requires a unit) and `high_cv` (CV across rows sharing a `groupByFieldId` value, `minReplicates` default 3) implemented in migration 0295 plus provenance columns (system_rule, evaluated_value, threshold, evaluated_at, cleared_reason) in 0294; snapshot freezes provenance. Clear contract: a system flag needs a reason from a writer, records reason+actor, and the override stands while the evaluated value is unchanged; manual flags unchanged. `high_cv` reconciles once per commit and via api.recompute_dataset_system_flags; row rules stay in validate/commit. `above_curve` documented as not implemented (no calibration-curve contract) in tasks/DSET.md. UI surfaces rule provenance and requires a reason to clear; evidence: tests/db/dataset-system-rule-flags.test.ts (11), db:generate clean, typecheck/check clean.
