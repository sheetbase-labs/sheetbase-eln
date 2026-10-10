---
id: task-134
title: PROJ-03 — Members, roles and project settings
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-124
related:
  - task-2
  - task-7
tags:
  - PROJ-03
  - PROJ
  - wave-B
---

# PROJ-03 — Members, roles and project settings

Spec: [PROJ-03 in tasks/PROJ.md](../../tasks/PROJ.md#proj-03--members-roles-and-project-settings)

- Stream: PROJ (epic-124)
- Wave: B
- Waits on: DEC-01 (task-2), DEC-06 (task-7)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0182_project_settings_enforcement.sql:3-7 — independent reviewer implemented; effective protocol delegated to future owner.; drizzle/0252_client_portal_project_switch.sql:22-52 — automatic sharing switch participates in portal reads.; drizzle/0244_project_members.sql:51-75 — members expose access level and is_lead, not full project-role/training contract.; src/routes/projects/$projectId/members.tsx:147-167 — current lead/access UI.. Remaining: Complete project roles/groups/training display and effective-protocol server enforcement; verify settings/archive permissions. Store-only effective flag contradicts completed settings step. See docs/knowledge/roadmap-4/RECONCILIATION.md#proj-03. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
