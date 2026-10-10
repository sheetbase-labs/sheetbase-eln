---
id: task-5
title: DEC-04 — Regulated signing and tamper-evident audit
type: task
status: done
priority: critical
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-1
tags:
  - DEC-04
  - DEC
  - wave-0
---

# DEC-04 — Regulated signing and tamper-evident audit

Spec: [DEC-04 in tasks/DEC.md](../../tasks/DEC.md#dec-04--regulated-signing-and-tamper-evident-audit)

- Stream: DEC (epic-1)
- Wave: 0
- Waits on: nothing
- Steps: 0 subtasks

## Work Log
- 2026-09-27: DEC-04 decided by the product owner 2026-09-27: accept ADR-0045 with the CDMO-under-client-audit intended use; password re-entry for SSO users, certification, meanings Authored/Witnessed/Reviewed/Reviewed-and-approved, 3-attempt/15-minute lockout, SHA-256 hash chain verified nightly at 06:00.
- 2026-09-27: PR #195: DEC-04 recorded.
- 2026-09-27: Consolidated into the wave-0 phase branch and PR #203.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): accepted. Evidence: docs/knowledge/decisions/0045-regulated-intended-use-control-model.md:50. Remaining: Decision recorded; dependent implementation and acceptance remain separate. See docs/knowledge/roadmap-4/RECONCILIATION.md#dec-04. Source audit, not fresh service/browser acceptance.
