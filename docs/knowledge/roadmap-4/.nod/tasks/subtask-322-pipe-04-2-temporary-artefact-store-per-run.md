---
id: subtask-322
title: PIPE-04.2 — Temporary artefact store per run (deleted at run end unless kept)
type: subtask
status: todo
priority: low
created: "2026-09-27"
updated: "2026-09-27"
parent: task-320
tags:
  - PIPE-04.2
  - PIPE
---

# PIPE-04.2 — Temporary artefact store per run (deleted at run end unless kept)

Step 2 of 3 in [PIPE-04](../../tasks/PIPE.md#pipe-04--file-and-figure-outputs); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented on the runner side. A run's artefacts live under a per-run directory on the runner's host; releaseArtefacts(key, keep) either deletes them or writes a keep marker next to the bytes - a marker rather than a database row, because the runner owns the bytes and a row could drift from what is actually there. Kept artefacts outlive the run because a proposal can reference one (PIPE-03). pruneArtefacts removes unkept directories past a window, so a run that dies before releasing is abandoned rather than kept by accident. The root is read per call rather than at module load so a deployment can point it elsewhere without a restart. Verified: 9 runner tests covering release both ways and pruning an abandoned run while leaving a kept one. Remaining: the app does not call release at run end yet - the runner side is done, the run-end wiring is not.
