---
id: subtask-354
title: REV-02.2 — Author signature at submission
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-352
tags:
  - REV-02.2
  - REV
---

# REV-02.2 — Author signature at submission

Step 2 of 3 in [REV-02](../../tasks/REV.md#rev-02--signature-meanings-and-author-signing); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. api.submit_record_revision signs the authored meaning at submission through the author signing token (fresh author password token required, SB002) and records it via internal.record_revision_signature; witness requests live in api.signature_witness_requests and surface as work items. Evidence: tests/db/rev-02-author-submission.test.ts (17) and tests/db/gov-04-review-signatures.test.ts.
