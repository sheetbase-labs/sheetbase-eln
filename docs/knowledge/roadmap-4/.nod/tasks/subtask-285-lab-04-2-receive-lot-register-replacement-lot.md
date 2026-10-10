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
  - 2026-10-10: server half of the replacement-lot flow landed (drizzle/0384; tests/db/replacement-lot.test.ts, 4 cases). api.register_replacement_lot creates a sibling lot for the same material - inheriting supplier, catalogue number and storage, taking a new lot number, expiry and quantity - and links it to the lot it replaces with a replacement relation, so the inspector can state whether a replacement exists. It goes through api.create_record so the new lot takes the next identifier from the material sequence, and it returns JSON because a record composite reaches the client as an opaque string. Quarantine is also wired in the inspector through record_reagent_movement. Remaining on this step: the CoA file link (the certificate is currently a text field rather than a file link) and the inspector dialog for registering the replacement (the RPC exists, the button does not), plus the expiry-driven refusal alongside the quarantine refusal already landed in drizzle/0376.
  - 2026-10-10: a quarantined material is refused as a used reference (drizzle/0376; tests/db/materials-quarantine-refusal.test.ts, 2 cases). The materials block validated a target's kind, identifier and title but not its status, so an experiment could record usage of a quarantined sample or reagent; it now raises SB120 and accepts the material again once released. Verified against the protocol-material-blocks and sample-release suites. Remaining on this step: the same refusal on the Sheet materialisation path, the expiry-driven state (LAB-02's hold transition), and the replacement-lot/CoA metadata.
