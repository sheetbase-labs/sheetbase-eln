---
id: subtask-123
title: WORK-04.2 — Booking dialog
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-121
tags:
  - WORK-04.2
  - WORK
---

# WORK-04.2 — Booking dialog

Step 2 of 2 in [WORK-04](../../tasks/WORK.md#work-04--schedule); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The booking dialog is extracted from src/routes/schedule.tsx into src/components/v3/schedule/book-dialog.tsx and submits through the existing create_booking RPC path (src/lib/calendar.ts). It deliberately does not pre-filter on availability or qualification, because the server is the authority: a refusal is surfaced with its reason. Four component tests cover a valid booking reaching the RPC with the chosen instrument and time, an unqualified instrument, a clashing slot, and required fields blocking the call. Not done: a next-free-slot preview, which needs a server RPC that does not exist (a migration), and a client-side overlap computation would be a second availability authority.
