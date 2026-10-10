---
id: subtask-142
title: PROJ-04.3 — File versions
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-139
tags:
  - PROJ-04.3
  - PROJ
---

# PROJ-04.3 — File versions

Step 3 of 4 in [PROJ-04](../../tasks/PROJ.md#proj-04--folders-and-files); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: file versions landed (drizzle/0370, 0371; tests/db/file-versions.test.ts, 3 cases). api.register_file_version creates the next row in a chain with its own checksum and previous_version_id, retention_until comes from the workspace policy (audit_retention_days), a trigger refuses DELETE on raw files, and api.file_version_chain lists every version newest-first with the current one marked. The one-file-per-record invariant is kept as a partial unique index on root files (previous_version_id IS NULL), so existing single-file readers keep working. Remaining on this step: the app's upload path should call the RPC, and any reader that wants the latest version rather than the root should filter on the chain. Verified against file-storage, data-04-search and api-credentials: 59 tests green.
