---
id: task-356
title: REV-03 — Signing with password re-entry and signature certification
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-04"
parent: epic-346
related:
  - task-2
  - task-5
tags:
  - REV-03
  - REV
  - wave-C
---

# REV-03 — Signing with password re-entry and signature certification

Spec: [REV-03 in tasks/REV.md](../../tasks/REV.md#rev-03--signing-with-password-re-entry-and-signature-certification)

- Stream: REV (epic-346)
- Wave: C
- Waits on: DEC-01 (task-2), DEC-04 (task-5)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0248_signature_certification.sql:24 — self-certification RPC and status model implemented; tests/db/signature-certification.test.ts:67 covers certify/withdraw/visibility.; src/components/notebook/sign-notebook-dialog.tsx:93 — signing uses submission/meaning/typed-name/digest only; lines 174-181 request typed name, not password.; drizzle/0044_sign_001_electronic_signatures.sql:305 — actual sign_revision records session+name-confirmation; no short-lived revision-bound token argument.; drizzle/0261_agent_policy_governance_fix.sql:36 — certification gates agent policy creation specifically; this must not be mistaken for a sign_revision gate.. Remaining: 1 Authenticated password/provider step-up and single-use user/session/revision token; 2 require token and certification in sign_revision; 3 admin identity verification/password/practice signature beyond current self-certification; 4 password-focused signing dialog and denial/reuse tests. Preserve self-certification as implemented subset, not full REV-03.3 done. See docs/knowledge/roadmap-4/RECONCILIATION.md#rev-03. Source audit, not fresh service/browser acceptance.
- 2026-10-04: Parent integrated password step-up, independent certification/enrolment/recovery gates, native fixture adaptation and idempotent seed through0315. Full REV-03 original exit acceptance assigned before task commit. Parent executed full validate3595 tests, combined real DB66 tests and canonical API22 tests. Formal visual/external acceptance limits remain; no closure from a checkpoint.
