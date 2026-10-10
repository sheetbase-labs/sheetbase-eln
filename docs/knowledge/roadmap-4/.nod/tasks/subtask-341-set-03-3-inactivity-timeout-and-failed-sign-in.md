---
id: subtask-341
title: SET-03.3 — Inactivity timeout and failed sign-in lockout
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-338
tags:
  - SET-03.3
  - SET
---

# SET-03.3 — Inactivity timeout and failed sign-in lockout

Step 3 of 3 in [SET-03](../../tasks/SET.md#set-03--profile-sessions-and-sign-in-security); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: done. Two of the three parts already existed and were verified rather than rebuilt. The failed sign-in lockout is DEC-04's signing re-authentication lockout: internal.signature_password_attempts records failures with a locked_until, three consecutive failures lock signing for fifteen minutes, the refusal names the reason, and the transition writes a password-lockout-started audit entry through the same audit boundary as every other governed event (src/lib/signature-step-up.server.ts, drizzle/0314/0315). The signed-out surface exists as src/components/offline/signed-out-surface.tsx, rendered by src/routes/sign-in.tsx in its signed-out state and explaining the kept offline edits. What was genuinely missing was the inactivity timeout, and that is what this adds: src/lib/auth.ts now configures session.expiresIn 1800 with updateAge 300, so the window is refreshed by activity rather than elapsing on a fixed clock - which is what an unattended workstation needs. Verified behaviourally, not by restating the configuration: tests/db/auth-session.test.ts creates a session through Better Auth's own adapter and asserts the stamped expiry is the configured window, and that the refresh interval is shorter than the window so the expiry really is idle-based; the existing expired-session case covers enforcement. 16 tests in that file pass.
- 2026-09-27: Blocked on a decision: DEC-04 (ADR-0045) specifies sign-re-authentication lockout (3 failed password attempts lock signing for 15 min with an audit entry), not sign-in lockout. The step's 'failed sign-in lockout' needs a separate decision before implementation; deferring rather than inventing a policy.
