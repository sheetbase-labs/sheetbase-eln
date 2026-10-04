---
id: task-91
title: SHELL-03 — Keyboard shortcuts and command palette frame
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-80
related:
  - task-2
tags:
  - SHELL-03
  - SHELL
  - wave-A
---

# SHELL-03 — Keyboard shortcuts and command palette frame

Spec: [SHELL-03 in tasks/SHELL.md](../../tasks/SHELL.md#shell-03--keyboard-shortcuts-and-command-palette-frame)

- Stream: SHELL (epic-80)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/lib/shortcuts.ts:132-157 — registry exists.; src/components/shell/shell.tsx:789-966 — legacy shell mounts ShortcutProvider/dialog.; src/components/v3/shell/app-shell.tsx:55-64 — actual v3 shell instead has ad-hoc Cmd-K keydown.; src/components/v3/search/search-palette.tsx:67-74 — palette installs another Cmd-K listener.. Remaining: Mount one registry for current v3 shell and migrated screens; restore global/list/notebook/review bindings and generated help, then verify input suppression/focus return. See docs/knowledge/roadmap-4/RECONCILIATION.md#shell-03. Source audit, not fresh service/browser acceptance.
