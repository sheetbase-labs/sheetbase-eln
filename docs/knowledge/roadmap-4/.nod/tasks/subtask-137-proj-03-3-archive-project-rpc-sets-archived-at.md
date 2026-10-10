---
id: subtask-137
title: "PROJ-03.3 — Archive project RPC: sets archived_at"
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-134
tags:
  - PROJ-03.3
  - PROJ
---

# PROJ-03.3 — Archive project RPC: sets archived_at

Step 3 of 4 in [PROJ-03](../../tasks/PROJ.md#proj-03--members-roles-and-project-settings); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: api.archive_project/unarchive_project (admin-only, reversible), records read-only via internal.project_is_archived trigger, audited; tests/db/project-archive.test.ts.
