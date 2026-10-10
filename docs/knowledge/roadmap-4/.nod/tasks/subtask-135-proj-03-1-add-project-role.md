---
id: subtask-135
title: PROJ-03.1 — Add project_role
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-134
tags:
  - PROJ-03.1
  - PROJ
---

# PROJ-03.1 — Add project_role

Step 1 of 4 in [PROJ-03](../../tasks/PROJ.md#proj-03--members-roles-and-project-settings); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0393, 0394; tests/db/project-role.test.ts, 5 cases). api.project_access gains a nullable project_role with a CHECK over lead/scientist/default_reviewer/oversight, keeping access_level as the permission, so the can_* flags are untouched. grant_project_access takes an optional role and records it after delegating to set_project_member, so the four-argument callers keep working unchanged. The members tab had always shown a "Project role" column rendering the *workspace* membership role, which is a different thing; api.project_members now returns project_role from the person's project_access row and the column renders it, falling back to Lead for the lead and an em dash otherwise. Tests cover the role being recorded alongside unchanged flags, the role left unset for permission-only callers, the vocabulary refusal, the cross-workspace refusal, and the RPC returning the role.
