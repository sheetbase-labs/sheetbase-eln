---
id: subtask-339
title: SET-03.1 — Profile fields
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-338
tags:
  - SET-03.1
  - SET
---

# SET-03.1 — Profile fields

Step 1 of 3 in [SET-03](../../tasks/SET.md#set-03--profile-sessions-and-sign-in-security); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: profile fields landed (drizzle/0372, 0373; tests/db/user-profile.test.ts, 3 cases). api.my_profile and api.set_user_profile hold initials, job title and time zone on the existing api.user_preferences row beside the appearance preference; initials are derived from the name when unset, the time zone is validated against pg_timezone_names, and only the signed-in person edits their own profile. Signatures print the Better Auth full name captured at signing, which already held.
