---
id: task-150
title: "EXP-02 — Overview: plan, progress and readiness"
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-144
related:
  - task-2
tags:
  - EXP-02
  - EXP
  - wave-D
---

# EXP-02 — Overview: plan, progress and readiness

Spec: [EXP-02 in tasks/EXP.md](../../tasks/EXP.md#exp-02--overview-plan-progress-and-readiness)

- Stream: EXP (epic-144)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/experiments/$expId/overview.tsx:101-132 — protocol links followed by explicit 'Step progress is not modelled' message.; src/routes/experiments/$expId/overview.tsx:135-190 — key results show links/placeholder, not readiness.; Search of current src and drizzle found no experiment_readiness RPC.. Remaining: Implement server readiness shared with submit, protocol-step progress/evidence, follows/upstream creation and exact resolving deep links. See docs/knowledge/roadmap-4/RECONCILIATION.md#exp-02. Source audit, not fresh service/browser acceptance.
