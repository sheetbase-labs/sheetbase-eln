---
id: task-333
title: SET-02 — Members, roles, groups and project access
type: task
status: in-progress
priority: low
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-328
related:
  - task-2
  - task-6
  - task-7
tags:
  - SET-02
  - SET
  - wave-E
---

# SET-02 — Members, roles, groups and project access

Spec: [SET-02 in tasks/SET.md](../../tasks/SET.md#set-02--members-roles-groups-and-project-access)

- Stream: SET (epic-328)
- Wave: E
- Waits on: DEC-01 (task-2), DEC-05 (task-6), DEC-06 (task-7)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/settings/members.tsx:43 — role labels/descriptions reuse canonical roles; real membership/invitation administration at lines 76-123.; src/routes/settings/access.tsx:45 — access UI explicitly grants individual people, not groups; mutation input userId at lines 104-109.; src/lib/workspace-admin.ts:573 — client-viewer role description exists; no workspace-group/access-request schema found in current src/db/schema.ts.. Remaining: 1 Complete documented role mapping and training/certification columns; 2 group memberships/grants and immediate RLS-backed matrix; 3 audited request/approval; 4 finish SettingsMembers/SettingsAccess against these semantics and parity. Existing people-grant pages do not satisfy group access task. See docs/knowledge/roadmap-4/RECONCILIATION.md#set-02. Source audit, not fresh service/browser acceptance.
