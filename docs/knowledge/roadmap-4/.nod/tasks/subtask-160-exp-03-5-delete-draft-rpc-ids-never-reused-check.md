---
id: subtask-160
title: EXP-03.5 — Delete draft RPC; IDs never reused (check the identifier sequence)
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-155
tags:
  - EXP-03.5
  - EXP
---

# EXP-03.5 — Delete draft RPC; IDs never reused (check the identifier sequence)

Step 5 of 5 in [EXP-03](../../tasks/EXP.md#exp-03--new-experiment-from-a-protocol); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0380; tests/db/experiment-delete-draft.test.ts, 4 cases). api.delete_experiment_draft accepts only a status 'draft' experiment, only its author or a workspace admin, and only a record with no revisions or review submissions (the restrict foreign keys on api.revisions and api.review_submissions are the backstop). The deletion is audited as a record change, and internal.id_sequences is untouched, so the identifier is never reused: the test deletes two drafts and checks that each new experiment receives a fresh identifier.
