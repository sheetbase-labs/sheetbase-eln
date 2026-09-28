---
id: task-81
title: SHELL-01 — New shell and navigation
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: epic-80
related:
  - task-2
  - task-4
tags:
  - SHELL-01
  - SHELL
  - wave-A
---

# SHELL-01 — New shell and navigation

Spec: [SHELL-01 in tasks/SHELL.md](../../tasks/SHELL.md#shell-01--new-shell-and-navigation)

- Stream: SHELL (epic-80)
- Wave: A
- Waits on: DEC-01 (task-2), DEC-03 (task-4)
- Steps: 5 subtasks

## Work Log
- 2026-09-27: Parity gap found while rendering /help as Gareth P.: the running shell is still the legacy 'Sheetbase ELN' layout (grouped nav, sidebar brand) rather than the v3 topbar + design nav. SHELL-01.2/.3 must land for shell parity.
- 2026-09-28: UI port (branch roadmap-4/ui-app3, PR pending): the ELN UI is being replaced with sheetbase-app-3's. Foundations staged under src/components/v3 (kit, icons, types, token bridge, shell); root chrome switch renders ported routes in app-3's shell. Home, Projects (list/detail/Overview/Folders/Members/Settings) and Inbox ported onto real RPCs; superseded ELN pages/tests deleted. Next: Schedule, Search.
