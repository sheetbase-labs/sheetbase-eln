---
id: task-81
title: SHELL-01 — New shell and navigation
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
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
  - 2026-10-10: every subtask of this task is done, so the task's own in-progress status was stale; closed after confirming the subtask statuses in .nod/tasks. Optical parity remains deferred by the owner's instruction.
- 2026-09-27: Parity gap found while rendering /help as Gareth P.: the running shell is still the legacy 'Sheetbase ELN' layout (grouped nav, sidebar brand) rather than the v3 topbar + design nav. SHELL-01.2/.3 must land for shell parity.
- 2026-09-28: UI port (branch roadmap-4/ui-app3, PR pending): the ELN UI is being replaced with sheetbase-app-3's. Foundations staged under src/components/v3 (kit, icons, types, token bridge, shell); root chrome switch renders ported routes in app-3's shell. Home, Projects (list/detail/Overview/Folders/Members/Settings) and Inbox ported onto real RPCs; superseded ELN pages/tests deleted. Next: Schedule, Search.
- 2026-09-28: UI port (Plan A, branch roadmap-4/ui-app3): app-3's shell, nav (Home, Inbox, Schedule, Projects, Experiments, Protocols, Templates, Samples, Materials, Datasets, Analysis, Pipelines, Models), page header/inspector, New menu and responsive breakpoints are ported and wired to real session/workspace data. The command palette frame (SHELL-03.4) remains.
- 2026-09-28: All steps done; closed by roadmap sync.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/components/v3/shell/app-shell.tsx:46-106 — current shell mounts its own palette/listener and fixed responsive nav; TopBar at 215 has no workspace switcher.; src/components/v3/shell/nav.ts:15-32 — nav arrays contain no capability/role rules.; src/routes/__root.tsx:125-267 — v3 shell used for listed routes; legacy ShellProvider remains for others.; src/lib/request-auth.ts:88 — active-workspace backend selection exists.. Remaining: Restore active-workspace switcher, role-filtered navigation, user collapse preference and uniform shell coverage; verify keyboard/focus and live counts. Existing backend switching is not current-shell integration. See docs/knowledge/roadmap-4/RECONCILIATION.md#shell-01. Source audit, not fresh service/browser acceptance.
