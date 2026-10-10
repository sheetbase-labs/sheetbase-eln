---
id: subtask-117
title: WORK-03.1 — api.notification_preferences
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-116
tags:
  - WORK-03.1
  - WORK
---

# WORK-03.1 — api.notification_preferences

Step 1 of 4 in [WORK-03](../../tasks/WORK.md#work-03--notifications-and-preferences); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: api.notification_preferences (own-row RLS) with save_notification_preference and set_notification_timing (quiet hours + digest on user_preferences); DB tests. The SettingsNotifications page remains.
- 2026-09-28: PR #206: event types aligned to the design's eight; notification-preferences data module and SettingsNotifications page (channel toggles, quiet hours, digest) rendered on /settings.
