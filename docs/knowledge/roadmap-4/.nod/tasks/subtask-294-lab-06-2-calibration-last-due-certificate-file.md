---
id: subtask-294
title: LAB-06.2 — Calibration (last, due, certificate file) and qualified_for
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-292
tags:
  - LAB-06.2
  - LAB
---

# LAB-06.2 — Calibration (last, due, certificate file) and qualified_for

Step 2 of 5 in [LAB-06](../../tasks/LAB.md#lab-06--instruments-identity-calibration-and-qualification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. Optical parity is deferred by the owner's instruction to stop treating visual comparisons as the gate. LAB-06.2 - calibration (last, due, certificate) and qualified_for are implemented server-side in drizzle/0364-0366 with the instrument qualification and booking-check tests passing.
  - 2026-10-10: user qualification per instrument landed (drizzle/0364, 0365; tests/db/instrument-qualifications.test.ts, 4 cases): api.instruments.qualified_for plus api.instrument_qualifications with an expiry, admin-granted and audited, api.set_instrument_qualification / api.revoke_instrument_qualification / api.instrument_qualification_list and the internal.instrument_qualified predicate the booking path will read. Expiry decides 'current'; another workspace sees nothing. Remaining on this step: the calibration certificate file wiring on the instrument page, and the booking check itself (LAB-06.3).
