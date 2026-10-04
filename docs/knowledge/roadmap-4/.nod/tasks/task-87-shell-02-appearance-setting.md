---
id: task-87
title: SHELL-02 — Appearance setting
type: task
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-80
related:
  - task-2
tags:
  - SHELL-02
  - SHELL
  - wave-A
---

# SHELL-02 — Appearance setting

Spec: [SHELL-02 in tasks/SHELL.md](../../tasks/SHELL.md#shell-02--appearance-setting)

- Stream: SHELL (epic-80)
- Wave: A
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-09-27: SHELL-02 complete: user_preferences table/RPC, ThemeProvider reads the server value and writes on change, appearance options in the account menu. Profile control lands with SET-03.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/components/theme-provider.tsx:63-109 — server read/write and local cache exist, but no storage event or media-query change listener.; src/components/v3/lib/theme.ts:12-58 — separate local listener Set, localStorage read/apply; no cross-tab listener.; src/components/v3/shell/app-shell.tsx:392-449 — account segmented control writes server appearance.. Remaining: Unify provider state; implement and verify cross-tab updates, live System changes and SSR/server initial preference. Persistence alone does not meet exit. See docs/knowledge/roadmap-4/RECONCILIATION.md#shell-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: All steps done; closed by roadmap sync.
- 2026-10-02: Browser acceptance added: tests/browser-scripts/interactions.mjs now proves another open tab follows the appearance change and a separate browser context (same user) loads the server preference. pnpm test:interactions green (8 checks). Commits cf2e89ca, and the test commit on GWP/roadmap-4-shell.
