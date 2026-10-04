---
id: subtask-89
title: SHELL-02.2 — ThemeProvider reads the server value
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-87
tags:
  - SHELL-02.2
  - SHELL
---

# SHELL-02.2 — ThemeProvider reads the server value

Step 2 of 3 in [SHELL-02](../../tasks/SHELL.md#shell-02--appearance-setting); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: 2026-10-02 reopened against current code: see SHELL-02 reconciliation note and RECONCILIATION.md#shell-02. Implemented subsets retained; full step requirement is not met.
- 2026-10-02: Unified the appearance store: src/components/v3/lib/theme.ts now owns the sheetbase-theme cache, .dark, data-theme and data-theme-pref, and installs storage (cross-tab) and prefers-color-scheme (live System, while system) listeners. ThemeProvider and the v3 shell share it. Evidence: src/components/v3/lib/theme.test.ts (apply, cross-tab adoption, live System while system, ignore System once explicit), src/components/theme-provider.test.tsx, interactions suite (appearance switch + survives reload) green. Commit cf2e89ca on GWP/roadmap-4-shell.
