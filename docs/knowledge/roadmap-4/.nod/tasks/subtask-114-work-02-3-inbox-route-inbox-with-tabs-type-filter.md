---
id: subtask-114
title: WORK-02.3 — Inbox route /inbox with tabs, type filter, J/K navigation
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-111
tags:
  - WORK-02.3
  - WORK
---

# WORK-02.3 — Inbox route /inbox with tabs, type filter, J/K navigation

Step 3 of 4 in [WORK-02](../../tasks/WORK.md#work-02--home-and-inbox-pages); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: /inbox route (tabs, type filter counts, due-date groups, row selection, inspector, J/K via the scoped-shortcut registry, InboxEmpty state) and nav Inbox → /inbox. Remaining: delete the /reviews list and repoint its links; data-issue/material kinds.
- 2026-09-27: PR #206: deleted the /reviews list route and its test, repointed Home, dashboard-data and review breadcrumbs to /inbox, and rewrote the browser test against /inbox. Remaining kinds arrive with WORK-01.4.
