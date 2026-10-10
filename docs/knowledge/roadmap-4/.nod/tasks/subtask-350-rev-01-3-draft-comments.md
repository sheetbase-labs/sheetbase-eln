---
id: subtask-350
title: REV-01.3 — Draft comments
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-347
tags:
  - REV-01.3
  - REV
---

# REV-01.3 — Draft comments

Step 3 of 4 in [REV-01](../../tasks/REV.md#rev-01--review-workspace); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (client delegated, server by the coordinator). A reviewer's comment is a private draft ('not sent to the author') until the return carries it: the return button reads 'Return with N comments', and the author then sees a returned banner naming the count, can resolve or reply, and Resubmit stays disabled while threads are open. The return and the publish are one transaction via api.return_revision_with_comments (drizzle/0400), which calls the canonical request_changes_on_review first and then the canonical create_comment per draft - so a refused return cannot leak a draft and a returned review cannot be missing its comments. Verified by a DB test (the reviewer returns with two drafts, the submission is 'returned', both comments are open and anchored; a refused return leaves no comment) plus 54 client tests. Limits: the draft store is the reviewer's browser keyed by revision and reviewer, so drafts are private but not shared across devices, and the return count is derived live from the revision's open threads rather than persisted on the decision.
