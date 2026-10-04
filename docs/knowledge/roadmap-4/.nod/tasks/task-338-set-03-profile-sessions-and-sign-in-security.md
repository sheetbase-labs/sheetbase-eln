---
id: task-338
title: SET-03 — Profile, sessions and sign-in security
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-328
related:
  - task-2
  - task-5
tags:
  - SET-03
  - SET
  - wave-B
---

# SET-03 — Profile, sessions and sign-in security

Spec: [SET-03 in tasks/SET.md](../../tasks/SET.md#set-03--profile-sessions-and-sign-in-security)

- Stream: SET (epic-328)
- Wave: B
- Waits on: DEC-01 (task-2), DEC-04 (task-5)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/settings/profile.tsx:20 — explicitly states initials/job title/timezone have no fields; display name and appearance persist.; src/components/v3/settings/settings-sessions.tsx:55 — listSessions and line 65 revokeSession wired; src/components/v3/settings/settings-sessions.test.tsx:48 exercises other-session sign-out.; src/lib/auth.ts:29 — Better Auth configuration has GitHub social providers and hooks; no task-specific inactivity/3-attempt 15-minute lockout/audit configuration.. Remaining: 1 Persist initials/job title/timezone and signature status; 3 implement and test inactivity timeout and failed-sign-in lockout/audit, signed-out/offline explanatory state. Step 2 implementation and component-test evidence support preserving done, without a fresh passing-test claim. See docs/knowledge/roadmap-4/RECONCILIATION.md#set-03. Source audit, not fresh service/browser acceptance.
