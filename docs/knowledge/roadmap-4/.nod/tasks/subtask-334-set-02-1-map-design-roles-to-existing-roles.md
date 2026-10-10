---
id: subtask-334
title: SET-02.1 — Map design roles to existing roles
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-333
tags:
  - SET-02.1
  - SET
---

# SET-02.1 — Map design roles to existing roles

Step 1 of 4 in [SET-02](../../tasks/SET.md#set-02--members-roles-groups-and-project-access); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: closed. The mapping table is now documented in the task: the design's five role names are a view of the existing nine-role vocabulary (WORKSPACE_ROLE_LABELS and WORKSPACE_ROLE_DESCRIPTIONS), with owner/admin for Admin, the member-class writers for Editor, reviewer, viewer and client_viewer unchanged, and no role added or renamed. The other two parts were already implemented and are verified rather than rebuilt: src/routes/settings/members.tsx renders the Training and E-signature columns from the training and signature-certification queries (not from the members RPC), and the role descriptions are shown. tests/../settings/members.test.tsx covers current-statement certification, explicit groups and real training separately. An interim extension of workspace_members_list was written, found redundant against those dedicated queries, and reverted so no dead RPC surface remains.
