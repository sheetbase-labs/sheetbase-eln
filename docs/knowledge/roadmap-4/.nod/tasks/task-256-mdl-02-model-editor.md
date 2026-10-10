---
id: task-256
title: MDL-02 — Model editor
type: task
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-251
related:
  - task-2
tags:
  - MDL-02
  - MDL
  - wave-E
---

# MDL-02 — Model editor

Spec: [MDL-02 in tasks/MDL.md](../../tasks/MDL.md#mdl-02--model-editor)

- Stream: MDL (epic-251)
- Wave: E
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-28: UI port (Plan A, branch roadmap-4/ui-app3): /models list plus /models/$modelId Fields, Versions and Datasets tabs now render the canonical dataset schema registry and write through the existing create_next_dataset_schema_version / publish_dataset_schema_version RPCs. Rules, Relations, Usage tabs, reason-for-change and version migration (MDL-02.2-02.4) remain.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/models/$modelId/edit.tsx:49-52,110-114,136-164 — Dataset schema draft editor exists; src/routes/models/$modelId/versions.tsx:69-99 — status/date/publish table; src/routes/models/$modelId/datasets.tsx:20-23 — dataset instances in place of model records; src/components/v3/models/models-data.ts:17-22 — current model semantics. Remaining: 1 partial routes; rules/relations/usage/record surfaces absent. 2 model_rules with submit effects absent. 3 draft editing exists, reason/record impact/open-experiment migration flow absent. 4 version status list lacks what happened to records. Preserve editor progress; do not mark full model domain complete. See docs/knowledge/roadmap-4/RECONCILIATION.md#mdl-02. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
