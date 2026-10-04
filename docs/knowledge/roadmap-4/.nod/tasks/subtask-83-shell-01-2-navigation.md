---
id: subtask-83
title: SHELL-01.2 — Navigation
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-03"
parent: task-81
tags:
  - SHELL-01.2
  - SHELL
---

# SHELL-01.2 — Navigation

Step 2 of 5 in [SHELL-01](../../tasks/SHELL.md#shell-01--new-shell-and-navigation); the full step text is under “Steps” there.

## Work Log
- 2026-09-27: PR #205: v3 navigation order/labels (Home, Inbox, Schedule; Projects…Models; Settings at the foot) and chrome moved to a full-width top bar (brand, workspace switcher, centred search, New, bell, account).
- 2026-09-27: PR #206: pinned projects group in the navigation from user_favourites (with status dots), seeded for the design user.
- 2026-09-27: PR #206: Inbox nav count from the caller's open work items, alongside the Pipelines failure count.
- 2026-09-28: PR #206: removed Integrations and Administration from the primary navigation — the v3 design lists neither; they belong under Settings. Experiments and Protocols are still missing pending their routes (EXP-01.2, LAB-07.6).
- 2026-10-02: 2026-10-02 reopened against current code: see SHELL-01 reconciliation note and RECONCILIATION.md#shell-01. Implemented subsets retained; full step requirement is not met.
- 2026-10-03: Permission-aware nav implemented (de8a7ccb): NavItem carries roles/capability; shell filters primaryNav/recordNav by workspace role; settings-nav.ts filters workspace-admin and integrations surfaces. 12 unit tests; typecheck/lint clean. Browser screens NOT re-run after this change.
- 2026-10-03: 2026-10-03: Uniform shell coverage: added /records/$recordId and /records/$recordId/ to the v3 route list (they are layouts that always nest a v3 child). Remaining non-v3 routes are the DEC-03 keep-internal surfaces /foundations, /sheetbase-components and /docs/$name (production redirects home; no parity). Keyboard/focus verified by src/components/v3/shell/app-shell.test.tsx (nav links are real anchors in tab order, live counts render, mod+\ collapses to the rail, ? opens the registry dialog).
