---
id: subtask-112
title: WORK-02.1 — Home (/)
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-111
tags:
  - WORK-02.1
  - WORK
---

# WORK-02.1 — Home (/)

Step 1 of 4 in [WORK-02](../../tasks/WORK.md#work-02--home-and-inbox-pages); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: Home (/) rebuild: page frame with title/date line and Open inbox action, counts row, Awaiting your review table, Continue working, Today bookings, Needs attention. (Earlier Home notes were mis-filed under WORK-02.2.)
- 2026-10-02: WORK-02: Home 'Continue working' now uses the personal recents read model (fetchRecentItems) and renders the design columns; the read model exposes canonical status plus describeRecentChange/recentStatusLabel. Home shows the HomeFirstRun checklist from real state when there are no recents. The Inbox registers j/k through the single registry (list scope) driving the selected row and inspector. The superseded dashboard-data layer is deleted. Evidence: recents/work-02 unit tests, pnpm test 302/3196, interactions (17, x3), areas, screens 96x2, phone all green. Commits 623482c1, 468b7e95.
