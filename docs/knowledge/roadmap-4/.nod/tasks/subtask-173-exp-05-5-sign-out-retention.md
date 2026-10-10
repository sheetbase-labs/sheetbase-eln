---
id: subtask-173
title: EXP-05.5 — Sign-out retention
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-168
tags:
  - EXP-05.5
  - EXP
---

# EXP-05.5 — Sign-out retention

Step 5 of 5 in [EXP-05](../../tasks/EXP.md#exp-05--offline-editing-and-conflict-resolution); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed (retention by one worker, the sign-out wiring by the coordinator). src/lib/offline/retention.ts retains drafts across sign-out over a narrow port: signing out records a device marker and has no delete path, and signing back in as the same user rebuilds every scope from that user id, while a different user gets nothing. The SignedOut surface says the edits were kept and will sync on return, and the design setting 'Allow offline editing on this workspace devices' is readable and writable (the column and RPC already existed, so no migration). The coordinator then closed the gap the implementer named: AccountMenu.signOut records what the device is holding before the session ends, reading the same store the notebook uses, and never clears it. ShellData.me gained the user id that scopes the marker. The offline guard was narrowed as a deliberate contract change - being offline used to refuse sign-out, which is the opposite of this step, because drafts now survive on the device; only an editor holding unsaved work blocks it. 15 tests for the retention half plus 14 for the shell. Still open: the 'forbid' behaviour of the setting is not enforced anywhere yet (the notebook must not hold drafts when offline editing is false) - that gate belongs to the notebook's offline prop wiring.
