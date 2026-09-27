---
id: subtask-94
title: SHELL-03.3 — List, notebook and review scopes registered by their screens as those…
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-91
tags:
  - SHELL-03.3
  - SHELL
---

# SHELL-03.3 — List, notebook and review scopes registered by their screens as those…

Step 3 of 4 in [SHELL-03](../../tasks/SHELL.md#shell-03--keyboard-shortcuts-and-command-palette-frame); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: ShortcutProvider accepts route-scoped definitions via useRegisterShortcuts; useShortcutScope/useRegisterShortcuts now depend on stable register/setScope so registering never loops. Tests for firing, unmount and global suppression. Screens register as they migrate.
