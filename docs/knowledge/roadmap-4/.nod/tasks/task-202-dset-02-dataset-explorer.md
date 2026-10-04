---
id: task-202
title: DSET-02 — Dataset explorer
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-195
related:
  - task-2
tags:
  - DSET-02
  - DSET
  - wave-C
---

# DSET-02 — Dataset explorer

Spec: [DSET-02 in tasks/DSET.md](../../tasks/DSET.md#dset-02--dataset-explorer)

- Stream: DSET (epic-195)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/datasets/$datasetId/rows.tsx:66-147 — data view and flags; src/routes/datasets/$datasetId.tsx:42 — dataset frame; src/routes/datasets/$datasetId/compare.tsx:65 — comparison tab; src/routes/datasets/$datasetId/imports.tsx — absent; no set_dataset_field_unit found in src/drizzle. Remaining: 1 list/detail/data(rows)/columns/snapshots/compare/history partly implemented; import/legacy redirect parity needs closure. 2 list exists but full issue inspector/partial-error acceptance unverified. 3 import read model and complete Used-by missing. 4 audited unit correction RPC with schema/snapshot/parser mapping updates absent. See docs/knowledge/roadmap-4/RECONCILIATION.md#dset-02. Source audit, not fresh service/browser acceptance.
