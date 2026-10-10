---
id: subtask-364
title: REV-04.3 — Nightly digest verification job recording results
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-361
tags:
  - REV-04.3
  - REV
---

# REV-04.3 — Nightly digest verification job recording results

Step 3 of 3 in [REV-04](../../tasks/REV.md#rev-04--evidence-versus-live); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: satisfied by the REV-05.2 job and closed. scripts/audit-verification.ts runs api.run_audit_verification for every workspace (drizzle/0378), which verifies the audit hash chain AND every signed revision's integrity digest - recomputing internal.revision_integrity_digest against the digest captured at signing and the revision's own digest - and records one System entry per workspace with the result. tests/db/audit-verification-job.test.ts proves a clean run records ok=true and that a rewritten signed revision is detected (firstBadRevisionId). Verified on the local database: five workspaces, process-development checking 1000 chain entries and 2 signed revisions. The 06:00 schedule and the response are documented in docs/operations/audit-verification.md.
