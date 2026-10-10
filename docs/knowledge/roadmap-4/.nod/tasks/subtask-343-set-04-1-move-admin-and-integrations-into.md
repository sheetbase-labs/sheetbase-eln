---
id: subtask-343
title: SET-04.1 — Move /admin/* and /integrations into /settings/* routes with the v3 settings…
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-342
tags:
  - SET-04.1
  - SET
---

# SET-04.1 — Move /admin/* and /integrations into /settings/* routes with the v3 settings…

Step 1 of 3 in [SET-04](../../tasks/SET.md#set-04--integrations-and-api); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. The surface exists and renders real seeded data in the parity screenshot runs; the owner has deferred optical comparison as a gate, so the remaining fidelity deltas are recorded as diagnostics rather than blockers. SET-04.1 - the settings routes live under src/routes/settings/ (access, api, audit, diagnostics, instruments, integrations, members, signatures), each backed by the same v3 settings surface.
