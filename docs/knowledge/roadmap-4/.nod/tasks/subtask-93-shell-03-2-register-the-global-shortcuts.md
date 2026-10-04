---
id: subtask-93
title: SHELL-03.2 — Register the global shortcuts
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: task-91
tags:
  - SHELL-03.2
  - SHELL
---

# SHELL-03.2 — Register the global shortcuts

Step 2 of 4 in [SHELL-03](../../tasks/SHELL.md#shell-03--keyboard-shortcuts-and-command-palette-frame); the full step text is under “Steps” there.

## Work Log
- 2026-10-02: 2026-10-02 reopened against current code: see SHELL-03 reconciliation note and RECONCILIATION.md#shell-03. Implemented subsets retained; full step requirement is not met.
- 2026-10-02: The v3 AppShell mounts one ShortcutProvider (no ad-hoc keydown): createGlobalShortcuts now includes the design's C/Create, the ? dialog is generated from the same definitions, mod+\ collapses the rail with the per-user preference, and the Help page opens the dialog through OPEN_SHORTCUTS_EVENT. The old ad-hoc Cmd-K listener in app-shell is removed (the palette is controlled, so search-palette installs none). Evidence: src/lib/global-shortcuts.test.ts (create), interactions suite green (?, registry dialog, Esc, input suppression, G then H, platform-correct palette key). Commit e0cd7537 on GWP/roadmap-4-shell.
