---
id: task-352
title: REV-02 — Signature meanings and author signing
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-346
related:
  - task-2
tags:
  - REV-02
  - REV
  - wave-C
---

# REV-02 — Signature meanings and author signing

Spec: [REV-02 in tasks/REV.md](../../tasks/REV.md#rev-02--signature-meanings-and-author-signing)

- Stream: REV (epic-346)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: drizzle/0044_sign_001_electronic_signatures.sql:196 — sign_revision accepts only approve-for-record/witness; line 305 writes session+name-confirmation.; src/components/notebook/sign-notebook-dialog.tsx:50 — default still approve-for-record; options from existing signature meanings.; src/routes/settings/signatures.tsx:47 — UI displays Authored/Reviewed/Approved policy labels, which does not widen the executable signature RPC.. Remaining: All three steps: canonical role-restricted expanded meaning vocabulary/migration, author signature at submission/witness work item, actual expanded meanings in signed records and evidence packages. Existing signature tables do not establish these new semantics. See docs/knowledge/roadmap-4/RECONCILIATION.md#rev-02. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
