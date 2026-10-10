---
id: task-316
title: PIPE-03 — ELN actions as proposals
type: task
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-305
related:
  - task-2
  - task-306
tags:
  - PIPE-03
  - PIPE
  - wave-E
---

# PIPE-03 — ELN actions as proposals

Spec: [PIPE-03 in tasks/PIPE.md](../../tasks/PIPE.md#pipe-03--eln-actions-as-proposals)

- Stream: PIPE (epic-305)
- Wave: E
- Waits on: DEC-01 (task-2), PIPE-01 (task-306)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/lib/pipelines/config.ts:67 — action shape only name/operation/arguments, no propose mode.; src/lib/pipeline-actions.server.ts — executor uses existing direct canonical action dispatch; existing agent proposal surface is separate.; docs/knowledge/roadmap-4/tasks/PIPE.md:147 — requested proposal block/run linkage/accept-as-person scope.. Remaining: All three steps: pipeline proposal persistence instead of immediate action, accept/reject/supersession lifecycle with person/run attribution, in-place notebook Compare/Accept/Reject. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-03. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PIPE-01. Other partial implementation can continue; these are full-task acceptance dependencies.
- 2026-10-10: All steps done; closed by roadmap sync.
