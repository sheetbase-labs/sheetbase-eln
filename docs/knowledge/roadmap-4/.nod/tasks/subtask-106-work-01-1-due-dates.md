---
id: subtask-106
title: WORK-01.1 — Due dates
type: subtask
status: todo
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-105
tags:
  - WORK-01.1
  - WORK
---

# WORK-01.1 — Due dates

Step 1 of 5 in [WORK-01](../../tasks/WORK.md#work-01--work-items); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: review_submissions.due_at + projects.default_review_period_days; insert trigger sets due_at from the project period (7-day fallback, explicit value overrides); my_work_items and reviews.ts expose dueAt. Submit-time override param still to wire with the submit dialog.
