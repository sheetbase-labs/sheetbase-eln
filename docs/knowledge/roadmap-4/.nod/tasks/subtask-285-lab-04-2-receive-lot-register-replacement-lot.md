---
id: subtask-285
title: LAB-04.2 — Receive lot, register replacement lot, quarantine, CoA file link, released by
type: subtask
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-283
tags:
  - LAB-04.2
  - LAB
---

# LAB-04.2 — Receive lot, register replacement lot, quarantine, CoA file link, released by

Step 2 of 3 in [LAB-04](../../tasks/LAB.md#lab-04--materials-and-lots); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: a quarantined material is refused as a used reference (drizzle/0376; tests/db/materials-quarantine-refusal.test.ts, 2 cases). The materials block validated a target's kind, identifier and title but not its status, so an experiment could record usage of a quarantined sample or reagent; it now raises SB120 and accepts the material again once released. Verified against the protocol-material-blocks and sample-release suites. Remaining on this step: the same refusal on the Sheet materialisation path, the expiry-driven state (LAB-02's hold transition), and the replacement-lot/CoA metadata.
