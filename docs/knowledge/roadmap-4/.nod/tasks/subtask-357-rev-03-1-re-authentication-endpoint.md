---
id: subtask-357
title: REV-03.1 — Re-authentication endpoint
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-356
tags:
  - REV-03.1
  - REV
---

# REV-03.1 — Re-authentication endpoint

Step 1 of 4 in [REV-03](../../tasks/REV.md#rev-03--signing-with-password-re-entry-and-signature-certification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. src/lib/signature-step-up.server.ts (handleSignatureStepUp) re-verifies the password through Better Auth and issues a short-lived grant bound to user, session, submission and expected revision digest; internal.consume_signature_grant checks those bindings and the meaning before use. Exercised by tests/db/gov-04-review-signatures.test.ts, tests/db/rev-02-author-submission.test.ts and tests/db/sheet-comments.test.ts.
