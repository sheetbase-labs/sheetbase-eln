---
id: subtask-157
title: EXP-03.2 — Private drafts
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-155
tags:
  - EXP-03.2
  - EXP
---

# EXP-03.2 — Private drafts

Step 2 of 5 in [EXP-03](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol); the full step text is under “Steps” there.

## Work Log
  -  FINISHED. The fixtures pass turned out to be nine files, not fourteen: capabilities, gov-01-viewer-readonly and anchored-comments carried an explicit 'draft' status, while comment-search, my-work-items, project-folders, workspace-group-access-upgrade, rev-02-author-submission and sheet-comments created experiments with the default status (which is draft) and then read or moved them as another user. Each now sets a non-draft status, and the full suite is back to its known baseline: 204/205 files, 1529/1532 tests, only the three environmental design-scenarios failures. Migration 0391 carries the policy (re-numbered from the earlier attempt, whose 0387 was taken by the booking work), and tests/db/private-draft-experiments.test.ts proves it.
  - 2026-10-10: implemented (drizzle/0387; tests/db/private-draft-experiments.test.ts, 2 cases). The read policies on api.records are permissive and OR together, so the rule is a RESTRICTIVE policy, which ANDs with them: a draft experiment is readable only by its author or by a workspace administrator, and leaving the draft state makes it visible to the team. The rule is deliberately scoped to kind='experiment' AND status='draft', because the experiment lifecycle is what gives 'draft' meaning here and widening it to every kind would change reads the rest of the application depends on. Note: api.has_capability grants workspace.admin to the owner role only, so the test's administrator is a second workspace owner. Verified: author and administrator see the draft, another member does not, and the member sees it once it leaves draft.
