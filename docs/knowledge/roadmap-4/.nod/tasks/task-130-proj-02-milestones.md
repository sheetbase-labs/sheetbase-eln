---
id: task-130
title: PROJ-02 — Milestones
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-124
related:
  - task-2
tags:
  - PROJ-02
  - PROJ
  - wave-B
---

# PROJ-02 — Milestones

Spec: [PROJ-02 in tasks/PROJ.md](../../tasks/PROJ.md#proj-02--milestones)

- Stream: PROJ (epic-124)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/projects/$projectId/milestones.tsx:53-58 — uses study_tasks milestone and study_deliverables.; src/routes/projects/$projectId/milestones.tsx:156-233 — create, due-date change, visibility and mark-done mutations.; src/routes/projects/$projectId/index.tsx:119-165 — overview milestones use live read model.. Remaining: Record current study-task/deliverable choice in canonical task; verify/complete reorder and evidence linking/derived completion rather than manual done alone; verify overview variants. Earlier read-only-baseline prose is stale. See docs/knowledge/roadmap-4/RECONCILIATION.md#proj-02. Source audit, not fresh service/browser acceptance.
