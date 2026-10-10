---
id: subtask-326
title: PIPE-05.2 — Failure notifications create a work item for the owner
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-324
tags:
  - PIPE-05.2
  - PIPE
---

# PIPE-05.2 — Failure notifications create a work item for the owner

Step 2 of 3 in [PIPE-05](../../tasks/PIPE.md#pipe-05--notification-channels); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified implemented and closed; no new code needed. api.my_work_items already derives a run_failed item for the pipeline's creator - the owner - from the run's own status (`pr.status='failed' AND pd.created_by_user_id=api.current_user_id()`), with the run's error message as the reason. Deriving it rather than storing it on a notification means the item cannot drift from the run: it appears when the run failed and disappears if the run is retried successfully, and no notification has to have been sent for the owner to see it. tests/db/my-work-items.test.ts covers it directly: the pipeline's creator sees the failed run with its identifier and a needs_action state, and another user in the same workspace sees nothing. The connector-failure variant is derived the same way for the connector's owner. Note: the notification *channels* that would also tell the owner (PIPE-05.1) are still open; this step is the inbox item, which does not depend on them.
