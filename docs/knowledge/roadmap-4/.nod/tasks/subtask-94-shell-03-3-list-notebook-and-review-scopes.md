---
id: subtask-94
title: SHELL-03.3 — List, notebook and review scopes registered by their screens as those…
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-04"
parent: task-91
tags:
  - SHELL-03.3
  - SHELL
---

# SHELL-03.3 — List, notebook and review scopes registered by their screens as those…

Step 3 of 4 in [SHELL-03](../../tasks/SHELL.md#shell-03--keyboard-shortcuts-and-command-palette-frame); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #206: ShortcutProvider accepts route-scoped definitions via useRegisterShortcuts; useShortcutScope/useRegisterShortcuts now depend on stable register/setScope so registering never loops. Tests for firing, unmount and global suppression. Screens register as they migrate.
- 2026-10-03: 2026-10-03: Scope catalogues added in src/lib/shortcut-scopes.ts (design transcriptions of Lists, Notebook and sheets, Review; a row with no handler is omitted, never a no-op). Registered: Inbox list scope (up/down, J/K, Enter open, / focus filter — Space/X need a multi-select model the ported Inbox does not have); NotebookDocument notebook scope (/ insert, Enter edit, Esc cancel with allowInInput, Tab next cell, alt+mod+m comment via the block's comment trigger — mod+Enter save has no explicit row-save action); review workspace + RevisionDiffReview (N/P change, R reply). mod+shift+Enter approve-and-sign is NOT registered: the workspace has separate Approve and Sign dialogs, no combined action. Tests: src/lib/shortcut-scopes.test.ts, src/routes/inbox.test.tsx, src/components/shortcuts/shortcuts-dialog.test.tsx (registry-backed dialog), src/components/v3/shell/app-shell.test.tsx.
- 2026-10-04: PR #220 registry presentation continuation: modal/help share real registered key/group components, duplicate static catalogue removed. Real browser checks Windows labels, sequences, scope changes, Escape/focus, axe and narrow width pass. Space/X selection, explicit Save row and combined review action remain missing; no Shortcuts parity mapping or annotation change. Whole SHELL-03 stays open.
