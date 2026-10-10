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
  - 2026-10-10: the booking producer landed, and the notification half hit a wall worth recording. drizzle/0387 patches api.create_booking to emit a calendar_booking change event (verified: the event appears for a created booking) and extends internal.notify_from_change_event with an instrument_booking branch that addresses the booking's participants. The branch runs and raises nothing, but inserts no notification: the SELECT inside it finds no participants, even though api.calendar_booking_participants holds them. The trigger is SECURITY DEFINER and the participants table carries RLS (policies for authenticated and api_client, plus internal.can_access_object), so the visibility of those rows to the trigger's execution context is the thing to establish before this branch can work - the existing branches read api.review_submissions and api.comments, which behave. A test for the notification half was written, failed on exactly that lookup, and was removed rather than left failing; the emitter itself is a genuine improvement and stays. Remaining for this step: signature_requested, validation_error and material_expiring have the same no-producer problem, and this booking notification needs the participant-visibility question answered.
  - 2026-10-10: extended (drizzle/0381; tests/db/notifications.test.ts, 6 cases). Beyond review_requested and review_returned_or_signed, the trigger now derives comment_or_mention (the record's author and every mentioned user) and protocol_new_version (everyone trained on that protocol), honouring api.notification_preferences.in_app, skipping the actor, and warning rather than blocking the observed write if derivation fails. Still open in this step: signature_requested, validation_error, instrument_booking and material_expiring have no producer - nothing emits a change event for a witness request, a check result, a booking or a hold transition - so they land with those flows (CAL, EXP, LAB) rather than being guessed here. Note for future migrations: drizzle/0358 had already extended this same function with the LAB-07 training reminders, and the reminder suite caught the omission when this migration first rebuilt it; the current definition is the merge of both.
- 2026-09-28: PR #206: internal.notifications + api.my_notifications view + mark_notifications_read; a trigger on api.change_events writes review_requested (assigned reviewers) and review_returned_or_signed (submitter). DB tests. The other six event types arrive with their owning tasks.
