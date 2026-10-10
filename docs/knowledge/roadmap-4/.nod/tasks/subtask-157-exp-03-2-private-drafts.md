---
id: subtask-157
title: EXP-03.2 — Private drafts
type: subtask
status: todo
priority: medium
created: "2026-09-27"
updated: "2026-09-27"
parent: task-155
tags:
  - EXP-03.2
  - EXP
---

# EXP-03.2 — Private drafts

Step 2 of 5 in [EXP-03](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0387; tests/db/private-draft-experiments.test.ts, 2 cases). The read policies on api.records are permissive and OR together, so the rule is a RESTRICTIVE policy, which ANDs with them: a draft experiment is readable only by its author or by a workspace administrator, and leaving the draft state makes it visible to the team. The rule is deliberately scoped to kind='experiment' AND status='draft', because the experiment lifecycle is what gives 'draft' meaning here and widening it to every kind would change reads the rest of the application depends on. Note: api.has_capability grants workspace.admin to the owner role only, so the test's administrator is a second workspace owner. Verified: author and administrator see the draft, another member does not, and the member sees it once it leaves draft.
