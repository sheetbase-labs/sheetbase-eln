---
id: subtask-367
title: REV-05.2 — Nightly verification job writing a System entry with the result
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-365
tags:
  - REV-05.2
  - REV
---

# REV-05.2 — Nightly verification job writing a System entry with the result

Step 2 of 3 in [REV-05](../../tasks/REV.md#rev-05--tamper-evident-audit-trail); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: nightly verification landed (drizzle/0378; tests/db/audit-verification-job.test.ts, 3 cases; scripts/audit-verification.ts; docs/operations/audit-verification.md). api.run_audit_verification verifies the hash chain and every signed revision's integrity digest and writes one System entry per workspace with the result; the runner iterates workspaces as the schema owner and exits non-zero on failure, for the 06:00 cron fixed by DEC-04. Verified on the local database: five workspaces reported, process-development checked 1000 chain entries and 2 signed revisions. 'system' joins the audit subject vocabulary, and a claim-less caller is accepted only when it owns the function, so the runner needs no fabricated session. Remaining in REV-05: the AuditLog page with filters and export (REV-05.3).
