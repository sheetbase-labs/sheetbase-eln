---
id: task-371
title: PORTAL-02 — Portal
type: task
status: in-progress
priority: low
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-369
related:
  - task-2
  - task-370
  - task-352
tags:
  - PORTAL-02
  - PORTAL
  - wave-E
---

# PORTAL-02 — Portal

Spec: [PORTAL-02 in tasks/PORTAL.md](../../tasks/PORTAL.md#portal-02--portal)

- Stream: PORTAL (epic-369)
- Wave: E
- Waits on: DEC-01 (task-2), PORTAL-01 (task-370), REV-02 (task-352)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0250_client_portal.sql:104 — approved-only manual share; :182 portal RPCs scope approved shares to caller client.; tests/db/client-portal.test.ts:180 — automatic sharing when project enabled; :208 invitation/accept; :253 messages; :300 workspace/client isolation tests present.; drizzle/0253_client_portal_messages.sql — client/team message table and RLS/RPCs implemented.; src/routes/client-portal.tsx:202 — shared record/report table only renders title/kind/shared date, no approved document/PDF/verification-code download.; src/lib/auth.ts:19 — only GitHub social provider configured, not ADR email client sign-in; tests/db/client-portal.test.ts:155 checks records/blocks/projects but does not explicitly exercise complete comments/dataset-row/file-denial matrix.. Remaining: 1 Finish ADR-compatible client email authentication and full denial matrix including comments/dataset rows/files; 2 acceptance-test sharing/messages and intended manual/team UI; 3 approved record content/PDF/verification code, milestones and complete portal flow/parity (implemented /client-portal route differs from proposed /portal). Current portal is substantial partial, not not-started; do not mark all exits from presence of RLS tests. See docs/knowledge/roadmap-4/RECONCILIATION.md#portal-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PORTAL-01, REV-02. Other partial implementation can continue; these are full-task acceptance dependencies.
