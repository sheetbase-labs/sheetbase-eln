---
id: task-155
title: EXP-03 — New experiment from a protocol
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-144
related:
  - task-2
tags:
  - EXP-03
  - EXP
  - wave-D
---

# EXP-03 — New experiment from a protocol

Spec: [EXP-03 in tasks/EXP.md](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol)

- Stream: EXP (epic-144)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 5 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/experiments/new.tsx:72-81 — protocol selector lists records without effective version identity.; src/routes/experiments/new.tsx:107-123 — creates blank draft then applies reviewer/end/setup in separate operations.; Search current src/drizzle found no start_experiment or set_experiment_status RPC.. Remaining: Controlled lifecycle, private drafts, server start checklist/effective version/training, follows/material copy and verified draft deletion/ID nonreuse remain; existing creation page alone does not meet exit. See docs/knowledge/roadmap-4/RECONCILIATION.md#exp-03. Source audit, not fresh service/browser acceptance.
