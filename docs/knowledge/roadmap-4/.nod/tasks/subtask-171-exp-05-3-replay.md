---
id: subtask-171
title: EXP-05.3 — Replay
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-168
tags:
  - EXP-05.3
  - EXP
---

# EXP-05.3 — Replay

Step 3 of 5 in [EXP-05](../../tasks/EXP.md#exp-05--offline-editing-and-conflict-resolution); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). Edits are replayed strictly in sequence order when the connection returns, and each is removed from the store only once it has actually committed: a non-overlapping edit goes through the canonical write path, a stale sheet-cell edit is not overwritten but raises a conflict through api.record_cell_conflict with the draft staying queued, a refused write is reported as refused and stays queued rather than being reported as committed, and a sheet holding an unresolved conflict blocks later cell and row edits to that sheet with the reason stated. It runs on the live-status transition to live and also on mount when already live, which covers retained drafts after sign-in, and it refreshes the unsynced list. It is the first writer into the device store, so the offline UI's count, markers and list now have something to show. Sixteen tests. Limits recorded: overlap detection for a bound column relies on the sheet instance revision moving, so a concurrent change to a bound dataset or record row that does not move it cannot be told from a clean write - the store records the sheet's expected revision, not per-dataset-row revisions; and no browser-level offline test was run. The row-key length concern the implementer raised is unfounded: row keys are the system's own addressing scheme, either 'sb-row-v1:' plus 64 hex (74 characters) or a UUID (36), both well inside the 128-character bound the raise RPC enforces.
