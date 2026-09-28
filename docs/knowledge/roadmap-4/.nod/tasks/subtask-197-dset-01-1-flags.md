---
id: subtask-197
title: DSET-01.1 — Flags
type: subtask
status: in-progress
priority: medium
created: "2026-09-27"
updated: "2026-09-28"
parent: task-196
tags:
  - DSET-01.1
  - DSET
---

# DSET-01.1 — Flags

Step 1 of 5 in [DSET-01](../../tasks/DSET.md#dset-01--value-flags-and-repeats); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: api.dataset_value_flags table + flag_dataset_value / clear_dataset_value_flag RPCs (writer-gated, row/field validated, duplicate active flag upserts) with RLS and DB tests. Copying flags into the next snapshot remains.
