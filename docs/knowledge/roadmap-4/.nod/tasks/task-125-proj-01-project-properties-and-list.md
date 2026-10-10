---
id: task-125
title: PROJ-01 — Project properties and list
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
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
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-09-28: UI port: /projects list, detail and Overview/Folders/Members/Settings tabs are ported on project_list_summary, project_members and folders, with create/edit/archive through the RPCs.
- 2026-09-28: All steps done; closed by roadmap sync.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0237_black_ender_wiggin.sql:16 — typed client property migration.; drizzle/0238_project_details_clients.sql:157 — update_project_details exists.; src/components/v3/projects/projects-page.tsx:101-145 — URL-backed filters/sorts and archive exclusion.; src/components/v3/projects/projects-page.tsx:693-790 — new-project dialog accepts title/client/stage only; no copy-structure selection.. Remaining: Finish copy-structure workflow over members/milestones/protocols, preserving no-record-copy invariant; verify list/dialog acceptance and archived read-only behavior. See docs/knowledge/roadmap-4/RECONCILIATION.md#proj-01. Source audit, not fresh service/browser acceptance.
- 2026-10-09: Coordinator (local): implemented api.create_project_from_structure (migration 0331), the atomic project-structure copy PROJ-01 was missing: copies milestones/deliverables into a new project, resets completion, copies no records/evidence, requires explicit source management and the exact source revision. tests/db/project-copy-structure.test.ts passes 6/6.
