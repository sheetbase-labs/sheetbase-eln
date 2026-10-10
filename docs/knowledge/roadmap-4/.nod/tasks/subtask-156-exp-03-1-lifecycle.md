---
id: subtask-156
title: EXP-03.1 — Lifecycle
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-155
tags:
  - EXP-03.1
  - EXP
---

# EXP-03.1 — Lifecycle

Step 1 of 5 in [EXP-03](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. api.set_experiment_status enforces the lifecycle (draft/in_progress/in_review/returned/approved) with allowed transitions, optimistic metadata_version and a reason, and api.start_experiment drives draft to in_progress. Covered by tests/db/experiment-start-lifecycle.test.ts,
 experiment-decision, experiment-fields and experiment-delete-draft suites.
