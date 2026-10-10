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
  - 2026-10-10: extended (drizzle/0381; tests/db/notifications.test.ts, 6 cases). Beyond review_requested and review_returned_or_signed, the trigger now derives comment_or_mention (the record's author and every mentioned user) and protocol_new_version (everyone trained on that protocol), honouring api.notification_preferences.in_app, skipping the actor, and warning rather than blocking the observed write if derivation fails. Still open in this step: signature_requested, validation_error, instrument_booking and material_expiring have no producer - nothing emits a change event for a witness request, a check result, a booking or a hold transition - so they land with those flows (CAL, EXP, LAB) rather than being guessed here. Note for future migrations: drizzle/0358 had already extended this same function with the LAB-07 training reminders, and the reminder suite caught the omission when this migration first rebuilt it; the current definition is the merge of both.
- 2026-09-28: PR #206: internal.notifications + api.my_notifications view + mark_notifications_read; a trigger on api.change_events writes review_requested (assigned reviewers) and review_returned_or_signed (submitter). DB tests. The other six event types arrive with their owning tasks.
