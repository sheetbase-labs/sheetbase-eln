---
id: task-125
title: PROJ-01 — Project properties and list
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-124
related:
  - task-2
tags:
  - PROJ-01
  - PROJ
  - wave-B
---

# PROJ-01 — Project properties and list

Spec: [PROJ-01 in tasks/PROJ.md](../../tasks/PROJ.md#proj-01--project-properties-and-list)

- Stream: PROJ (epic-124)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-28: UI port: /projects list, detail and Overview/Folders/Members/Settings tabs are ported on project_list_summary, project_members and folders, with create/edit/archive through the RPCs.
- 2026-09-28: All steps done; closed by roadmap sync.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0237_black_ender_wiggin.sql:16 — typed client property migration.; drizzle/0238_project_details_clients.sql:157 — update_project_details exists.; src/components/v3/projects/projects-page.tsx:101-145 — URL-backed filters/sorts and archive exclusion.; src/components/v3/projects/projects-page.tsx:693-790 — new-project dialog accepts title/client/stage only; no copy-structure selection.. Remaining: Finish copy-structure workflow over members/milestones/protocols, preserving no-record-copy invariant; verify list/dialog acceptance and archived read-only behavior. See docs/knowledge/roadmap-4/RECONCILIATION.md#proj-01. Source audit, not fresh service/browser acceptance.
