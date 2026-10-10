---
id: subtask-272
title: LAB-01.2 — Reservations
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-270
tags:
  - LAB-01.2
  - LAB
---

# LAB-01.2 — Reservations

Step 2 of 3 in [LAB-01](../../tasks/LAB.md#lab-01--withdrawals-and-reservations); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: api.sample_reservations (active/cancelled/fulfilled) with create/cancel RPCs (workspace writer), internal.sample_reserved_quantity sums active reservations so withdraw_sample refuses into reserved volume, and api.sample_quantity_balances returns used (consume events)/reserved/current/free. Sample data module exposes reservations + balances. Evidence: migration 0285 (applied to dev DB), tests/db/sample-reservations.test.ts (5), full pnpm test:db 150/1225, pnpm test, interactions/areas/screens green, db:generate clean. Commit next.
