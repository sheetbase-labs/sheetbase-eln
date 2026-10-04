---
id: subtask-180
title: SRCH-01.2 — Cell values
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-178
tags:
  - SRCH-01.2
  - SRCH
---

# SRCH-01.2 — Cell values

Step 2 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: published Dataset cell values are indexed in api.dataset_cell_search (partitioned by dataset_version_values, trigger-maintained, RLS-scoped) and api.search_cells returns the dataset, matched field label, value and highlighted snippet. DB tests cover member, viewer, outsider and cross-workspace claims. Sheet row values remain: they depend on the SHEET capability's instance state shape, so that half lands with SHEET.
