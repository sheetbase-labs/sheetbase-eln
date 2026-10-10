---
id: subtask-143
title: PROJ-04.4 — Files tab
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-139
tags:
  - PROJ-04.4
  - PROJ
---

# PROJ-04.4 — Files tab

Step 4 of 4 in [PROJ-04](../../tasks/PROJ.md#proj-04--folders-and-files); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented. The files tab did not exist; src/routes/projects/$projectId/files.tsx now lists the project's file records joined to their api.file_objects metadata with the design's columns (Name, Kind, Size, Uploaded by, Uploaded), linking each to its file record and showing an honest empty state. The data layer is exported and covered by files.test.ts (3 cases: the join, the title fallback when object metadata is absent, and the empty project asking for no objects). Route registered by pnpm generate-routes; the page returns HTTP 200 with the shell, and its content is client-rendered.
