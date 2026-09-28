---
id: task-256
title: MDL-02 — Model editor
type: task
status: in-progress
priority: low
created: "2026-09-27"
updated: "2026-09-28"
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
