---
id: task-33
title: DSYS-05 — Design-data seed
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: epic-14
related:
  - task-2
tags:
  - DSYS-05
  - DSYS
  - wave-A
---

# DSYS-05 — Design-data seed

Spec: [DSYS-05 in tasks/DSYS.md](../../tasks/DSYS.md#dsys-05--design-data-seed)

- Stream: DSYS (epic-14)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-27: Seeded the design projects (design seed): 8 PRJ projects across the four workspaces, idempotent (db:seed:design converges). Custom fields await the PROJ-01 columns; the projects.custom_fields trigger rejects unregistered keys.
- 2026-09-28: PR #206: the design seed now carries the Projects screen's clients (CL-009/011/014/017/022), the 12 visible projects with the design's PRJ ids, clients, stages, leads and statuses, 12 archived projects, and 148 experiments redistributed across projects to reach the exact counts.
