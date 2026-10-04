---
id: task-265
title: MDL-04 — Model lists, generated forms and record pages
type: task
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: epic-251
related:
  - task-2
  - task-252
tags:
  - MDL-04
  - MDL
  - wave-E
---

# MDL-04 — Model lists, generated forms and record pages

Spec: [MDL-04 in tasks/MDL.md](../../tasks/MDL.md#mdl-04--model-lists-generated-forms-and-record-pages)

- Stream: MDL (epic-251)
- Wave: E
- Waits on: DEC-01 (task-2), MDL-01 (task-252)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/routes/models/$modelId/datasets.tsx:20-42 — lists Dataset schema instances, not generic records; src/components/v3/models/models-data.ts:17-22 — record/measurement split not represented; src/routes/records/$recordId/notebook.tsx — canonical notebook rather than proposed generated model record detail. Remaining: All three steps remain after MDL-01: field-driven record list/filter/export; generated versioned form with matching server errors and ID preview; sectioned record detail with version additions, used-by/history/integration results. Existing field editors are reusable baseline only. See docs/knowledge/roadmap-4/RECONCILIATION.md#mdl-04. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates MDL-01. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-03: MDL-04.1 done (subtask-266). Remaining steps: MDL-04.2 generated form (shared client/server validation, ID preview) and MDL-04.3 record page (sections, later-version field banner, used-by, history, integration results).
- 2026-10-03: All steps done; closed by roadmap sync.
