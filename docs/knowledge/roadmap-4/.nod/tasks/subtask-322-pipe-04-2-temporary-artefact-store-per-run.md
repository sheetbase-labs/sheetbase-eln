---
id: subtask-322
title: PIPE-04.2 — Temporary artefact store per run (deleted at run end unless kept)
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-320
tags:
  - PIPE-04.2
  - PIPE
---

# PIPE-04.2 — Temporary artefact store per run (deleted at run end unless kept)

Step 2 of 3 in [PIPE-04](../../tasks/PIPE.md#pipe-04--file-and-figure-outputs); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed (drizzle/0417). A run's artefacts live under a per-run directory on the runner's host; the runner gained a release endpoint and releaseArtefacts(key, keep) either deletes them or writes a keep marker next to the bytes - a marker rather than a database row, because the runner owns the bytes and a row could drift from what is actually there. The app releases settled runs in a scheduler sweep rather than at each exit, because a run ends in several places and an external HTTP call does not belong inside the transaction any of them holds; one unreachable runner must not stop the sweep, so a failed release leaves the run unmarked for the next tick. Kept means the run produced a proposal, since a proposal can reference a file the run produced (PIPE-03) and discarding those would leave the proposal pointing at nothing. The release is recorded in api.pipeline_artefact_releases rather than on the run, because the run's result is deliberately immutable once settled. The artefact key is the run and collection accumulates rather than clearing, since a run can have several Python steps. pruneArtefacts removes unkept directories past a window, so a run that died before releasing is abandoned rather than kept by accident. Verified: 9 runner tests and 38 DB tests including the release, the retry on an unreachable runner, and that a drained sweep finds nothing left to do.
  - 2026-10-10: implemented on the runner side. A run's artefacts live under a per-run directory on the runner's host; releaseArtefacts(key, keep) either deletes them or writes a keep marker next to the bytes - a marker rather than a database row, because the runner owns the bytes and a row could drift from what is actually there. Kept artefacts outlive the run because a proposal can reference one (PIPE-03). pruneArtefacts removes unkept directories past a window, so a run that dies before releasing is abandoned rather than kept by accident. The root is read per call rather than at module load so a deployment can point it elsewhere without a restart. Verified: 9 runner tests covering release both ways and pruning an abandoned run while leaving a kept one. Remaining: the app does not call release at run end yet - the runner side is done, the run-end wiring is not.
