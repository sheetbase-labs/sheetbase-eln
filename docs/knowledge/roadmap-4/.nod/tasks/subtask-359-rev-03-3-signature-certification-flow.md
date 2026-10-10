---
id: subtask-359
title: REV-03.3 — Signature certification flow
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-356
tags:
  - REV-03.3
  - REV
---

# REV-03.3 — Signature certification flow

Step 3 of 4 in [REV-03](../../tasks/REV.md#rev-03--signing-with-password-re-entry-and-signature-certification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator); no schema change needed, because the server already enforces certification in signature-step-up.server.ts and api.sign_revision. The signing surfaces now read the signer's own certification and say certification is required - with a link to Settings and no password field or Sign control - before the step-up would have refused opaquely. The gate is part of the single presentation mirror: availableSignatureMeanings takes certificationCurrent and returns no meanings when it is false, and a revoked certification is not current. Settings certification, statement version, identity verification and withdrawal already existed and were left intact. Seven tests cover the uncertified message and link, the meanings gate, and that a revoked certification is not current. Remaining: submit-notebook-dialog (the author's 'Authored' signature at submission) still surfaces nothing about certification - that is REV-02.2 scope.
