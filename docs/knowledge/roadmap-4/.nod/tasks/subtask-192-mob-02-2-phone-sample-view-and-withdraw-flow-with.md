---
id: subtask-192
title: MOB-02.2 — Phone sample view and withdraw flow with numeric keypad component
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-190
tags:
  - MOB-02.2
  - MOB
---

# MOB-02.2 — Phone sample view and withdraw flow with numeric keypad component

Step 2 of 4 in [MOB-02](../../tasks/MOB.md#mob-02--bench-flows); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Phone sample view + withdraw flow: LAB-01.3 adds the phone-width withdraw dialog with a numeric keypad, available/reserved/remaining and optional derived container (calling withdraw_sample); phone.mjs now asserts the bottom sheet, keypad, balance summary and operability at 390px (non-mutating). Evidence: pnpm test:phone 27 checks green x3. Commit next. REMAINING: the phone sample view itself reuses the sample detail; destination is the derived container.
