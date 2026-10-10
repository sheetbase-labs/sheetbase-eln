---
id: subtask-358
title: REV-03.2 — sign_revision requires the token
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-356
tags:
  - REV-03.2
  - REV
---

# REV-03.2 — sign_revision requires the token

Step 2 of 4 in [REV-03](../../tasks/REV.md#rev-03--signing-with-password-re-entry-and-signature-certification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. api.sign_revision refuses without a token (fresh password token required, SB002), consumes the grant for the sign meaning, rejects a meaning mismatch between token and request, and records the auth method on the signature row (auth_method is constrained to session+name-confirmation or password).
