---
id: task-121
title: WORK-04 — Schedule
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-104
related:
  - task-2
tags:
  - WORK-04
  - WORK
  - wave-D
---

# WORK-04 — Schedule

Spec: [WORK-04 in tasks/WORK.md](../../tasks/WORK.md#work-04--schedule)

- Stream: WORK (epic-104)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 2 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/schedule.tsx:78-214 — day/week, bookings, review/material panels implemented.; src/routes/schedule.tsx:234 — unavailable state uses weekend assumption.; src/components/v3/schedule/schedule-data.ts:151-167 — bookInstrument delegates to existing createBooking.; src/routes/schedule.tsx:613-632 — dialog submits directly; no next-free-slot or qualification check.. Remaining: Implement real availability, next-free-slot/clash preview and server calibration/qualification refusal; verify active experiment readiness and schedule exit. See docs/knowledge/roadmap-4/RECONCILIATION.md#work-04. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
