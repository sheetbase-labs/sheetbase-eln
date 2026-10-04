---
id: subtask-330
title: SET-01.1 — /settings/general per SettingsGeneral
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-329
tags:
  - SET-01.1
  - SET
---

# SET-01.1 — /settings/general per SettingsGeneral

Step 1 of 3 in [SET-01](../../tasks/SET.md#set-01--workspace-general-settings); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: workspace_settings gains site/timezone/date_format/number_format with the admin-only update_workspace_general RPC; DB tests. The /settings/general page follows.
- 2026-09-28: PR #206: /settings now shows the workspace general settings form (site, time zone, date/number format) with Save; component test.
- 2026-09-28: PR #206: the general settings page now edits the workspace Name through the admin-only api.update_workspace_name (with DB tests for admin, non-admin and an invalid name) alongside site, time zone and formats. Consolidating the scattered format helpers in notebook-data/calendar/planner/workspace-admin onto log format-numbers remains.
- 2026-10-02: 2026-10-02 reopened against current code: see SET-01 reconciliation note and RECONCILIATION.md#set-01. Implemented subsets retained; full step requirement is not met.
