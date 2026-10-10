---
id: subtask-188
title: MOB-01.1 — Phone layout below 600px in the shell
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-187
tags:
  - MOB-01.1
  - MOB
---

# MOB-01.1 — Phone layout below 600px in the shell

Step 1 of 2 in [MOB-01](../../tasks/MOB.md#mob-01--phone-shell); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: closed. The v3 shell (src/components/v3/shell/app-shell.tsx, the shell __root.tsx actually renders) already carries the phone layout: the bottom bar (BottomTabs) shows Today, Scan, Inbox and Menu below md, with min-h-14 (56px) targets and safe-area padding; the sidebar is lg-only and there is no shell-level inspector, so nothing but the destinations is on screen. The missing piece was the header back button, now added as PhoneBackButton in TopBar: it is md:hidden and absent on the bottom bar's own destinations (/, /scan, /inbox, /settings), where there is nowhere to go back to. Verified in the running app at 390px: the bar rendered at 56px per target, no Back button on /, and Back present on /projects. app-shell.test.tsx gains two cases and the Link mock now forwards className. Note: src/components/shell/shell.tsx is a legacy shell referenced only by its own test, so the change was made in the v3 shell and an initial edit to the legacy one was reverted.
