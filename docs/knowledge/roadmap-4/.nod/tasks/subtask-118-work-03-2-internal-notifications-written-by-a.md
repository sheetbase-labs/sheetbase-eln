---
id: subtask-118
title: WORK-03.2 — internal.notifications written by a trigger on api.change_events for the…
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-116
tags:
  - WORK-03.2
  - WORK
---

# WORK-03.2 — internal.notifications written by a trigger on api.change_events for the…

Step 2 of 4 in [WORK-03](../../tasks/WORK.md#work-03--notifications-and-preferences); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: internal.notifications + api.my_notifications view + mark_notifications_read; a trigger on api.change_events writes review_requested (assigned reviewers) and review_returned_or_signed (submitter). DB tests. The other six event types arrive with their owning tasks.
