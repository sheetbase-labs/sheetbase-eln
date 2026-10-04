---
id: task-139
title: PROJ-04 — Folders and files
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-124
related:
  - task-2
tags:
  - PROJ-04
  - PROJ
  - wave-B
---

# PROJ-04 — Folders and files

Spec: [PROJ-04 in tasks/PROJ.md](../../tasks/PROJ.md#proj-04--folders-and-files)

- Stream: PROJ (epic-124)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/projects/$projectId/folders.tsx:65-121 — reads project records and moves selected record IDs only.; src/db/schema.ts:719 — placement is records.folder_id.; src/routes/experiments/$expId/files.tsx — current files surface exists; src/routes/projects/$projectId.tsx:99 links folders but has no Files route/tab.. Remaining: Mixed-kind placement and project Files surface remain; deliver explicit file version chain/new-version upload, retained old downloads and parser/parsed-into/retention provenance. Validate cross-project refusal. See docs/knowledge/roadmap-4/RECONCILIATION.md#proj-04. Source audit, not fresh service/browser acceptance.
