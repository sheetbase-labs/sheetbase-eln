---
id: subtask-214
title: DSET-04.3 — "Keep" RPC with reason
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-211
tags:
  - DSET-04.3
  - DSET
---

# DSET-04.3 — "Keep" RPC with reason

Step 3 of 3 in [DSET-04](../../tasks/DSET.md#dset-04--snapshot-retention); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.keep_dataset_version stores a keep beside the immutable snapshot (dataset_version_keeps, not exposed) with a required reason; retention honours it. DB tests.
