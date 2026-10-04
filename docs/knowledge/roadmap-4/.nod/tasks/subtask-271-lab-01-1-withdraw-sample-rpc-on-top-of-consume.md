---
id: subtask-271
title: LAB-01.1 — withdraw_sample RPC on top of consume
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-270
tags:
  - LAB-01.1
  - LAB
---

# LAB-01.1 — withdraw_sample RPC on top of consume

Step 1 of 3 in [LAB-01](../../tasks/LAB.md#lab-01--withdrawals-and-reservations); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: api.withdraw_sample on top of consume_sample: purpose experiment required and recorded on the consume event, over-withdrawal into reserved volume refused with the available amount, hold/quarantine/allowed-use refusals delegated to consume, optional derived container sample created with a create event + lineage link in one transaction. internal.sample_reserved_quantity is the step-2 hook (returns 0 now). Evidence: migration 0284 (applied to dev DB), tests/db/sample-withdraw.test.ts (10), full pnpm test:db 149/1220, pnpm test, interactions/areas/screens green, db:generate clean. Commit next.
