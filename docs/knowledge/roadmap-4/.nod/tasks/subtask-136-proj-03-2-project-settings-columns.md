---
id: subtask-136
title: PROJ-03.2 — Project settings columns
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-134
tags:
  - PROJ-03.2
  - PROJ
---

# PROJ-03.2 — Project settings columns

Step 2 of 4 in [PROJ-03](../../tasks/PROJ.md#proj-03--members-roles-and-project-settings); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed. The three columns exist with an admin-only api.update_project_settings; require_independent_reviewer is enforced by the signature trigger, require_effective_protocol by api.start_experiment (drizzle/0351, tests/db/experiment-start-lifecycle.test.ts) and auto_share_to_client by the portal readers (drizzle/0343-0348, tests/db/client-portal.test.ts, portal-signature-evidence, workspace-group-access). The members Training column now reads exact-version training (drizzle/0357, tests/db/member-training-status.test.ts) and archiving is admin-only with its own tests (tests/db/project-archive.test.ts).
  - 2026-10-09: effective-protocol enforcement is no longer store-only - api.start_experiment enforces it (drizzle/0351, DB tests) and the members Training column now reads exact-version training (drizzle/0357, tests/db/member-training-status.test.ts). Project roles/groups/training display detail and settings/archive permission verification remain.
  - 2026-10-09: effective-protocol enforcement is no longer store-only. api.start_experiment (drizzle/0351) refuses to start an experiment when the project requires an effective protocol and none is pinned/eligible/acknowledged, with DB tests (tests/db/experiment-start-lifecycle.test.ts). The members Training column now reads exact-version training instead of the coarse record-level table (drizzle/0357, tests/db/member-training-status.test.ts). Remaining: project roles/groups/training display detail and settings/archive permission verification.
- 2026-09-27: PR #206: project settings columns (require_effective_protocol, require_independent_reviewer, auto_share_to_client) + admin-only update_project_settings; require_independent_reviewer enforced by a signature trigger with DB tests. EXP-03 and PORTAL enforce the other two.
- 2026-10-02: 2026-10-02 reopened against current code: see PROJ-03 reconciliation note and RECONCILIATION.md#proj-03. Implemented subsets retained; full step requirement is not met.
