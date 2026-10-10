---
id: task-145
title: EXP-01 — Experiment page frame and tabs
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-144
related:
  - task-2
tags:
  - EXP-01
  - EXP
  - wave-B
---

# EXP-01 — Experiment page frame and tabs

Spec: [EXP-01 in tasks/EXP.md](../../tasks/EXP.md#exp-01--experiment-page-frame-and-tabs)

- Stream: EXP (epic-144)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-09-28: UI port: /experiments list and detail (Overview, Notebook, Samples, Datasets, Results, Files, History) are ported; the Notebook tab opens the working record notebook.
- 2026-09-28: All steps done; closed by roadmap sync.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/experiments/$expId/samples.tsx:7-15 and datasets.tsx:7-15 — both delegate to generic LinkTab.; src/routes/experiments/$expId/links-tab.tsx:29-74 — only linked ID and link type; no sample inspector or dataset row/provenance view.; src/routes/experiments/$expId/results.tsx:67-124 — real results/decision reads present.; src/routes/experiments/$expId/history.tsx:25-39 — History is revision list.. Remaining: Route split and real tabs exist, but complete sample lineage/properties/print actions and dataset filtered-row/provenance inspector; check list open-issues contract and seven-tab acceptance. See docs/knowledge/roadmap-4/RECONCILIATION.md#exp-01. Source audit, not fresh service/browser acceptance.
