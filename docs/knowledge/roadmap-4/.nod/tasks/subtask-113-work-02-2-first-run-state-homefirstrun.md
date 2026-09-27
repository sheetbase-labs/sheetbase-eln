---
id: subtask-113
title: WORK-02.2 — First-run state (HomeFirstRun)
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-111
tags:
  - WORK-02.2
  - WORK
---

# WORK-02.2 — First-run state (HomeFirstRun)

Step 2 of 4 in [WORK-02](../../tasks/WORK.md#work-02--home-and-inbox-pages); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: Home frame starts — page title 'Home' with the workspace date line and an 'Open inbox' action; remaining Main sections (counts, awaiting review, continue working, today schedule, needs attention, recent activity) follow.
- 2026-09-27: PR #206: Home sections aligned — 'Continue working' (recents), 'Awaiting your review' (priorities), and a new 'Needs attention' section from api.my_work_items.
- 2026-09-27: PR #206: Home counts row (to review, experiments in progress, open inbox · N) from real queries; dataset-error and instrument-run counts wait for their data sources.
- 2026-09-27: PR #206: Home 'Today' section from calendar_bookings for the current day.
- 2026-09-27: PR #206: Awaiting your review is now the design's table (Record, Project, Submitted by, Due, Action) with resolved submitter names.
- 2026-09-27: Correcting the tracker: the Home rebuild belongs to WORK-02.1 (subtask-112), not WORK-02.2. First-run state is still todo.
- 2026-09-27: PR #206: first-run 'Get set up' checklist (account created, signature, first project, experiment from a protocol) with your-projects action and Help links, shown when the user has no recents, edits or reviews.
- 2026-09-27: PR #206: first-run 'Your projects' list and 'People to know' from workspace members with resolved names.
