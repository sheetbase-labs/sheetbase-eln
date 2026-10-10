---
id: subtask-362
title: REV-04.1 — Read model comparing the frozen revision's cited snapshots with the latest…
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-361
tags:
  - REV-04.1
  - REV
---

# REV-04.1 — Read model comparing the frozen revision's cited snapshots with the latest…

Step 1 of 3 in [REV-04](../../tasks/REV.md#rev-04--evidence-versus-live); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0383; tests/db/revision-drift.test.ts, 4 cases). api.revision_drift(revision_id) compares a frozen revision with live data: the record's name as signed versus now (LAB-06 renaming), the comments added after signing, and each cited dataset version against the dataset's latest, returning one drifted flag. The frozen content stays in api.revision_evidence_package; this read model carries only the comparison. The test covers no-drift, a rename in both directions, comments after signing, and a caller without record access (42501).
