---
id: subtask-85
title: SHELL-01.4 — Active workspace
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-81
tags:
  - SHELL-01.4
  - SHELL
---

# SHELL-01.4 — Active workspace

Step 4 of 5 in [SHELL-01](../../tasks/SHELL.md#shell-01--new-shell-and-navigation); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: 2026-10-02 reopened against current code: see SHELL-01 reconciliation note and RECONCILIATION.md#shell-01. Implemented subsets retained; full step requirement is not met.
- 2026-10-02: The active workspace now works in the current shell: the v3 top bar lists the caller's memberships and sets the active workspace through the existing set_active_workspace RPC, then re-resolves the shell context. Backend selection (request-auth), the RPC/RLS and the member-only DB contract (tests/db/shell-02-user-preferences.test.ts, 'stores the active workspace only for a member') already existed; this closes the UI half. Evidence: interactions suite ('top bar shows the workspace switcher', 'workspace switcher lists the memberships') green, 3 consecutive runs. Commit 5ee7667b on GWP/roadmap-4-shell.
