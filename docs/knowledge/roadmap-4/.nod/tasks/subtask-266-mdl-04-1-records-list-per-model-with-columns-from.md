---
id: subtask-266
title: MDL-04.1 — Records list per model with columns from fields
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-03"
parent: task-265
tags:
  - MDL-04.1
  - MDL
---

# MDL-04.1 — Records list per model with columns from fields

Step 1 of 3 in [MDL-04](../../tasks/MDL.md#mdl-04--model-lists-generated-forms-and-record-pages); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: MDL-04.1 implemented. New /models/$modelId/records route + RecordModelRecords (shared TanStack DataTable): columns are the model's active record_field_definitions; search, status and per-field filters; CSV export via new dependency-free lib/export/delimited (fixed node:zlib leak into the client bundle). Kind-aware /models/$modelId/ index redirect (uuid->fields, key->records) and built-in kind fallback. Seed: design Cell bank model (CB-, 10 fields, 7 records). Acceptance: pnpm typecheck; pnpm test 3411; pnpm test:screens 98 routes x2 green; pnpm test:areas, test:interactions, test:phone, test:crawl green.
