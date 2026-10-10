---
id: subtask-293
title: LAB-06.1 — Instrument records with stable INS-nnnn identifiers
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-292
tags:
  - LAB-06.1
  - LAB
---

# LAB-06.1 — Instrument records with stable INS-nnnn identifiers

Step 1 of 5 in [LAB-06](../../tasks/LAB.md#lab-06--instruments-identity-calibration-and-qualification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: rename and move history landed (drizzle/0369; tests/db/instrument-history.test.ts, 3 cases). api.instruments now emits a field-level change event carrying name, location and qualified-for with their previous values (the generic trigger only recorded the new row), an update touching none of them writes no history, and api.instrument_history exposes it newest-first for the page and the signed-name rule. Remaining on this step: the signed-text display itself (LAB-06.4) and the used-by/telemetry surface.
