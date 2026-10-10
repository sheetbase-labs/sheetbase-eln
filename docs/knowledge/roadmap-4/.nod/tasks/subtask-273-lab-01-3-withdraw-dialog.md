---
id: subtask-273
title: LAB-01.3 — Withdraw dialog
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-270
tags:
  - LAB-01.3
  - LAB
---

# LAB-01.3 — Withdraw dialog

Step 3 of 3 in [LAB-01](../../tasks/LAB.md#lab-01--withdrawals-and-reservations); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Withdraw dialog now uses withdraw_sample (keypad, unit, purpose, notes, optional derived container, available/reserved/remaining, inline + mapped refusals); reserve/cancel flow added; Usage tab rebuilt from api.sample_quantity_balances (used/reserved/free bar), canonical consume events with purpose, and the reservation list. Evidence: withdraw-dialog/sample-usage/ tests (70), pnpm test, interactions/areas/phone/screens green. Commit next.
