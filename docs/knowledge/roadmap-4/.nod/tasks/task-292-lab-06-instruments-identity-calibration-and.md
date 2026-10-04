---
id: task-292
title: "LAB-06 — Instruments: identity, calibration and qualification"
type: task
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-269
related:
  - task-2
tags:
  - LAB-06
  - LAB
  - wave-D
---

# LAB-06 — Instruments: identity, calibration and qualification

Spec: [LAB-06 in tasks/LAB.md](../../tasks/LAB.md#lab-06--instruments-identity-calibration-and-qualification)

- Stream: LAB (epic-269)
- Wave: D
- Waits on: DEC-01 (task-2)
- Steps: 5 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/instruments/$instrumentId.tsx:70-128 — calibration records/history and due status.; src/routes/instruments/$instrumentId.tsx:272-307 — calibration write dialog.; drizzle/0257_overconfident_the_fallen.sql:1 — instrument calibration table and capability.; src/components/v3/schedule/schedule-data.ts:151-167 — bookings use unqualified generic createBooking.. Remaining: Complete qualified-for/user qualification, booking checks, rename/location/signed-name preservation and used-by/telemetry acceptance; calibration alone covers only part of step 2. See docs/knowledge/roadmap-4/RECONCILIATION.md#lab-06. Source audit, not fresh service/browser acceptance.
