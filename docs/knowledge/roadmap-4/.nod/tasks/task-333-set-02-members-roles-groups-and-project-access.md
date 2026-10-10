---
id: task-333
title: SET-02 — Members, roles, groups and project access
type: task
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
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
- 2026-10-08: Coordinator (local): shared DataClient now accepts native 204 void responses; regression test added; data-client suite 22/22. Native Settings browser case not yet rerun locally. Original Settings parity remains red.
- 2026-10-09: Coordinator (local): repaired the systemic post-0323 DB fixture gap. A project is private to its lead until an explicit rule exists, but ~90 DB suites inserted projects as migrator with no lead, so writes were denied. Added tests/db/helpers.ts grantProjectAccess + ensureSessions and fixed DSET, PROJ, calendar, planner, notebook, WORK, samples, model seeded and review/signature suites. ~30 suites moved from red to green.
- 2026-10-10: All steps done; closed by roadmap sync.
