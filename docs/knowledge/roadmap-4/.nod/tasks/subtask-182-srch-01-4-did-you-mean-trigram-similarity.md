---
id: subtask-182
title: "SRCH-01.4 — \"Did you mean\": trigram similarity"
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-178
tags:
  - SRCH-01.4
  - SRCH
---

# SRCH-01.4 — "Did you mean": trigram similarity

Step 4 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: api.search_did_you_mean — pg_trgm similarity over record identifiers, workspace-scoped; DB tests incl. other-workspace isolation.
- 2026-09-28: PR #206: search_did_you_mean gains an include_archived flag (archived hidden by default); DB test.
