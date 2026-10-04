---
id: task-178
title: SRCH-01 — Search coverage
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-177
related:
  - task-2
tags:
  - SRCH-01
  - SRCH
  - wave-B
---

# SRCH-01 — Search coverage

Spec: [SRCH-01 in tasks/SRCH.md](../../tasks/SRCH.md#srch-01--search-coverage)

- Stream: SRCH (epic-177)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/lib/search.ts:810-836 — separate cell/file-content RPC helpers exist.; docs/knowledge/roadmap-4/tasks/SRCH.md:41-72 — published Dataset cells and CSV/TXT/JSON extraction implemented; Sheet values/PDF extraction still deferred.; tests/db/comment-search.test.ts and tests/db/dataset-cell-search.test.ts — targeted contract tests exist.. Remaining: Complete Sheet-cell indexing and PDF text extraction, integrate coverage into user-visible search, verify archived behavior and populated scale/permission evidence; tests were not run. See docs/knowledge/roadmap-4/RECONCILIATION.md#srch-01. Source audit, not fresh service/browser acceptance.
