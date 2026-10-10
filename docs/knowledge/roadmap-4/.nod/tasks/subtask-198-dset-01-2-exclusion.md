---
id: subtask-198
title: DSET-01.2 — Exclusion
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
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
- 2026-09-28: PR #206: shared filterRowsByFlags; live charts and the representations chart path both exclude flagged values. Server-side fx criteria and pipeline inputs remain.
- 2026-09-28: PR #206: pipeline inputs exclude flagged values — the version-row materialiser skips a (row, field) present in dataset_version_flags. Server-side; fx criteria remain.
- 2026-09-28: PR #206: analysis panel test mocks the flags fetch (fixes the suite after wiring).
- 2026-10-02: DSET-01.2 exclusion closed for the composed working-sheet calculation path: one buildFlagIndex over api.dataset_value_flags marks a bound dataset input excluded when isValueFlagged, EXCLUDED propagates through calculation/calculated-column deps, and calculateSheetSnapshotReport/handleSheetCalculation report {valueCount,rowCount,kinds} via the shared summariseExcludedValues helper. Clearing a flag restores the value. Analysis/chart/pipeline exclusion already existed and is reused, not duplicated. Evidence: dataset-flags/sheet-calculation/exclusion unit tests (26), pnpm test 303/3234, interactions/areas/screens green. Commit f6395251. Note: the design's include-flagged checkbox and a UI surface for the count are DSET-01.5 scope; calculation.server.ts has no dataset-row provenance so the sheet path is the dataset-backed fx path.
