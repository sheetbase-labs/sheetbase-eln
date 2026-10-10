---
id: subtask-180
title: SRCH-01.2 — Cell values
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-178
tags:
  - SRCH-01.2
  - SRCH
---

# SRCH-01.2 — Cell values

Step 2 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: canonical search now covers cell values and file contents (drizzle/0363, tests/db/data-04-search.test.ts). api.search gains dataset_row and sheet_row results from the SRCH-01.2 indexes (with the matched column and a snippet) and reports text found inside an uploaded file as the file's own hit (matched_field file_contents, reported once), with name matches still ranking above incidental cell text. Verified against the design seed: the C-150 query returns dataset_row 11, sheet_row 1 and record 8 (was record 8 only). The design's exact nine (Samples 2, Sheet rows 1, Dataset rows 3, Comments 1, Experiments 1, Files 1) is now a DSYS-05 seed-fidelity question about which rows match, not a search-coverage gap. SRCH-01.2 is complete (dataset half existed, sheet half added); SRCH-01.3 remains partial only for PDF text, which needs a text-layer parser.
- 2026-09-28: PR #206: published Dataset cell values are indexed in api.dataset_cell_search (partitioned by dataset_version_values, trigger-maintained, RLS-scoped) and api.search_cells returns the dataset, matched field label, value and highlighted snippet. DB tests cover member, viewer, outsider and cross-workspace claims. Sheet row values remain: they depend on the SHEET capability's instance state shape, so that half lands with SHEET.
