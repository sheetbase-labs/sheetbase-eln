---
id: subtask-295
title: LAB-06.3 — Booking RPC checks qualification and calibration (WORK-04)
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-292
tags:
  - LAB-06.3
  - LAB
---

# LAB-06.3 — Booking RPC checks qualification and calibration (WORK-04)

Step 3 of 5 in [LAB-06](../../tasks/LAB.md#lab-06--instruments-identity-calibration-and-qualification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: booking now checks qualification and calibration (drizzle/0366; tests/db/booking-instrument-checks.test.ts, 4 cases). A calendar resource naming an instrument in its metadata represents it: create_booking refuses an unqualified or expired booker (SB115) and an overdue calibration (SB116), and a resource without an instrument is unaffected. Both checks read internal.instrument_qualified and api.instrument_calibrations, the same sources the instrument page shows.
