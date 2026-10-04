---
id: task-161
title: EXP-04 — Notebook working surface
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-144
related:
  - task-2
tags:
  - EXP-04
  - EXP
  - wave-B
---

# EXP-04 — Notebook working surface

Spec: [EXP-04 in tasks/EXP.md](../../tasks/EXP.md#exp-04--notebook-working-surface)

- Stream: EXP (epic-144)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 6 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/records/$recordId/notebook.tsx:2259-2261 — inspector describes Properties/History/Activity rather than full selected-cell/comments contract.; src/components/notebook/notebook-document.tsx:499-500 — read-only and block discussion behavior exist.; src/lib/collaboration/types.ts:81-123 — Sheet row/cell anchors absent.; src/components/notebook/slash-command-menu.tsx — existing insert menu present.. Remaining: Complete v3 notebook states, selected-cell provenance/validation inspector, row threads, view-only request-access and pipeline proposal experience; establish per-state visual/semantic acceptance rather than treating existing editor as full task. See docs/knowledge/roadmap-4/RECONCILIATION.md#exp-04. Source audit, not fresh service/browser acceptance.
