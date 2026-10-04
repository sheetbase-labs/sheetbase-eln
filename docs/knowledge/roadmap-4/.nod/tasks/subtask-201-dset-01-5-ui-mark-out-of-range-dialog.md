---
id: subtask-201
title: "DSET-01.5 — UI: \"Mark out of range\" dialog"
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-02"
parent: task-196
tags:
  - DSET-01.5
  - DSET
---

# DSET-01.5 — UI: "Mark out of range" dialog

Step 5 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: Reusable v3 ValueActions component (value-actions.tsx) in the dataset rows selected-value inspector: Mark out of range (reason category + comment), Clear flag (manual/system shown separately), Request repeat (derived sample + planned rows, toast). Non-writers read-only; RPC errors toast. flagDatasetValue/clearDatasetValueFlag wrappers added. Dataset frame gains Overview/Data/Snapshots/Compare tabs so Rows is reachable from experiments. Evidence: value-actions.test.tsx (8), pnpm test 304/3242, interactions/areas/screens green after applying migrations to the dev DB. Commit fe2f5f12. Caveat: Request repeat's source sample resolves from a reference field or a sample-labelled text value; the ELISA seed has no matching sample so it is disabled there.
