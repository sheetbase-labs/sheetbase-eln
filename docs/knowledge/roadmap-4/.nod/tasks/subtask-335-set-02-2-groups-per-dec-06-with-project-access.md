---
id: subtask-335
title: SET-02.2 — Groups per DEC-06 with project access rules by group
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-333
tags:
  - SET-02.2
  - SET
---

# SET-02.2 — Groups per DEC-06 with project access rules by group

Step 2 of 4 in [SET-02](../../tasks/SET.md#set-02--members-roles-groups-and-project-access); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified implemented and closed; no new code needed. The group model exists (api.workspace_groups, api.workspace_group_memberships, create_workspace_group / delete_workspace_group / set_workspace_group_member / workspace_groups_list), project access rules are stored per group (api.project_access.group_id with set_project_access_rule), and the defaults exist (project_access_defaults / set_project_access_defaults). The access matrix UI is src/routes/settings/access.tsx, whose 'Project access matrix' table filters and edits rules by group and by user. The acceptance the ticket names - the matrix is a view of the same grants RLS uses, a change takes effect immediately and is audited - is covered by tests/db/workspace-group-access.test.ts (21 cases, titled 'SET-02 canonical group access'), including 'resolves explicit group union at query time, revokes immediately and audits changes', plus 4 route tests on the access page. Not re-verified: the visual matrix against the SettingsAccess canvas (parity is deferred by the owner's instruction).
