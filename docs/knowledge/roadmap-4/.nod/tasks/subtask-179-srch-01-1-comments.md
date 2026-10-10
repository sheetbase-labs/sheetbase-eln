---
id: subtask-179
title: SRCH-01.1 — Comments
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-178
tags:
  - SRCH-01.1
  - SRCH
---

# SRCH-01.1 — Comments

Step 1 of 4 in [SRCH-01](../../tasks/SRCH.md#srch-01--search-coverage); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: comment text indexed (generated tsvector + GIN, declared in schema.ts); api.search_comments returns record, anchor, author and time, scoped by RLS. DB tests cover member, viewer, outsider and cross-workspace claims.
