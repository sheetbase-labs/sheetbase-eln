---
id: subtask-200
title: DSET-01.4 — Request repeat
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: task-196
tags:
  - DSET-01.4
  - DSET
---

# DSET-01.4 — Request repeat

Step 4 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: api.request_repeat (migration 0276) creates the derived dilution sample (existing LAB-01 sample record + create event) and planned rows via the existing plan_dataset_row helper in one transaction, linking via record_links and carrying measurement provenance; SECURITY DEFINER gated to workspace writer, refuses archived source/dataset, bounds rows, rejects duplicates (SB075). Evidence: tests/db/request-repeat.test.ts (6), full pnpm test:db 142/1168 green, db:generate clean. Commit 61de1712.
