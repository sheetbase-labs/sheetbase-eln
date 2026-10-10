---
id: subtask-181
title: SRCH-01.3 — File contents
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-178
tags:
  - SRCH-01.3
  - SRCH
---

# SRCH-01.3 — File contents

Step 3 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: canonical search now covers cell values and file contents (drizzle/0363, tests/db/data-04-search.test.ts). api.search gains dataset_row and sheet_row results from the SRCH-01.2 indexes (with the matched column and a snippet) and reports text found inside an uploaded file as the file's own hit (matched_field file_contents, reported once), with name matches still ranking above incidental cell text. Verified against the design seed: the C-150 query returns dataset_row 11, sheet_row 1 and record 8 (was record 8 only). The design's exact nine (Samples 2, Sheet rows 1, Dataset rows 3, Comments 1, Experiments 1, Files 1) is now a DSYS-05 seed-fidelity question about which rows match, not a search-coverage gap. SRCH-01.2 is complete (dataset half existed, sheet half added); SRCH-01.3 remains partial only for PDF text, which needs a text-layer parser.
- 2026-09-28: PR #206: CSV/TXT/JSON uploads extract text into file_objects.extracted_text; the text feeds the maintained record search vector and api.search_file_contents returns the matching line and line number, scoped by RLS. DB tests cover member, viewer, outsider and records; the upload test proves extraction. PDF text-layer extraction needs a parser dependency and remains.
