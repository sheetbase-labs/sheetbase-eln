---
id: subtask-282
title: LAB-03.4 — History tab from sample events
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-278
tags:
  - LAB-03.4
  - LAB
---

# LAB-03.4 — History tab from sample events

Step 4 of 4 in [LAB-03](../../tasks/LAB.md#lab-03--sample-record-pages); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: History tab rewritten to the canonical sample_events stream (When/Who/Action/Detail/Change, actor names, deterministic timestamps); sample inspector gains a label card and a truthful hold-time meter derived from stored expiryDate/createdAt, stating 'not recorded' where the design's hold duration/harvest/condition is absent. Evidence: sample-history/label-card/hold-meter tests (20), pnpm test, interactions/areas/screens green. Commit next. BLOCKER for the LAB-03 exit: design parity for SMP-2231's hold meter ('5 of 14 days used') needs LAB-02's hold duration/harvest/condition fields + seed; the model has only an optional expiryDate and the design seed stores none.
