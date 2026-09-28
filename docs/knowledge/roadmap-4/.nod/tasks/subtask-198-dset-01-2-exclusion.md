---
id: subtask-198
title: DSET-01.2 — Exclusion
type: subtask
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-09-28"
parent: task-196
tags:
  - DSET-01.2
  - DSET
---

# DSET-01.2 — Exclusion

Step 2 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: src/lib/dataset-flags.ts — active-flag fetch plus the shared exclusion predicate (buildFlagIndex / isValueFlagged / excludeFlaggedValues) with unit tests. Wiring it into chart-data, analysis, ƒx criteria and pipeline inputs remains.
- 2026-09-28: PR #206: live charts exclude rows whose charted field is flagged — resolveChartDataset attaches active flags and materialiseLiveChart drops them (unit test). Analyses, fx criteria and pipeline inputs remain.
- 2026-09-28: PR #206: analyses exclude flagged values — runAnalysis takes flags, RepresentationTableInput carries them and the Analysis Studio attaches the dataset's active flags (unit test). fx criteria, pipeline inputs and the representations chart path remain.
