---
id: task-252
title: MDL-01 — Workspace-defined record models
type: task
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-251
related:
  - task-2
  - task-8
tags:
  - MDL-01
  - MDL
  - wave-E
---

# MDL-01 — Workspace-defined record models

Spec: [MDL-01 in tasks/MDL.md](../../tasks/MDL.md#mdl-01--workspace-defined-record-models)

- Stream: MDL (epic-251)
- Wave: E
- Waits on: DEC-01 (task-2), DEC-07 (task-8)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: docs/knowledge/decisions/0051-workspace-defined-record-models.md:24-48 — accepted generic host decision; src/db/schema.ts:1621-1630 — global model_kinds, no workspace record_models; src/components/v3/models/models-data.ts:17-22 — Models UI uses Dataset schema registry. Remaining: Accepted decision is complete; all three implementation steps remain: workspace-owned versioned model identity/prefix and RLS; generic records/validation/search/lineage; API/SDK exposure. Dataset schema models do not satisfy custom record kinds. See docs/knowledge/roadmap-4/RECONCILIATION.md#mdl-01. Source audit, not fresh service/browser acceptance.
- 2026-10-03: All steps done; closed by roadmap sync.
- 2026-10-04: 0306 fixes duplicate model-key cardinality on populated multi-workspace data; claims-free record/manifest regression preserves workspace-local validation. 25 focused DB tests and 6 record-model API tests pass.
