---
id: subtask-353
title: REV-02.1 — Widen meanings
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-352
tags:
  - REV-02.1
  - REV
---

# REV-02.1 — Widen meanings

Step 1 of 3 in [REV-02](../../tasks/REV.md#rev-02--signature-meanings-and-author-signing); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. api.signatures allows authored, reviewed, reviewed-and-approved, witnessed, witness and approve-for-record, and internal.assert_signature_target enforces the post-submission vocabulary and role rules: reviewed and reviewed-and-approved require the review state (reviewed-and-approved needs state approved) and a non-author reviewer, while witnessed requires an explicit witness request for that exact revision digest from someone other than the author (42501 otherwise). Covered by tests/db/gov-04-review-signatures.test.ts and tests/db/rev-02-author-submission.test.ts.
