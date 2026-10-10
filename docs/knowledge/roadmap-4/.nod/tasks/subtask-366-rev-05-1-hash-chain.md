---
id: subtask-366
title: REV-05.1 — Hash chain
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-365
tags:
  - REV-05.1
  - REV
---

# REV-05.1 — Hash chain

Step 1 of 3 in [REV-05](../../tasks/REV.md#rev-05--tamper-evident-audit-trail); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: hash chain landed (drizzle/0377; tests/db/audit-hash-chain.test.ts, 4 cases). Every api.change_events row stores previous_hash and its own entry_hash, computed by a BEFORE INSERT trigger over the canonical field set (workspace, sequence, entity, operation, record, project, actor, credential, client, payload, created_at); the existing history was backfilled in sequence order. Entries are append-only (SB121 on UPDATE and DELETE) and api.verify_audit_chain recomputes the chain for a workspace admin, reporting the first entry that does not match. Remaining in REV-05: the nightly verification job (REV-05.2) and the AuditLog page (REV-05.3).
