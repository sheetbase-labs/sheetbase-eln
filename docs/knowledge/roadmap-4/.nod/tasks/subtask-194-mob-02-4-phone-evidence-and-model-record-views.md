---
id: subtask-194
title: MOB-02.4 — Phone evidence and model record views
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-190
tags:
  - MOB-02.4
  - MOB
---

# MOB-02.4 — Phone evidence and model record views

Step 4 of 4 in [MOB-02](../../tasks/MOB.md#mob-02--bench-flows); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The evidence page's three-column table becomes a single column below md with the same frozen blocks, 44px rows, and the integrity facts stated inline so the digest is not lost with the inspector; amendment is desktop-only with the reason stated, while open-live-record and export stay reachable. The model record page's actions move into full-width 44px targets below md. Four component tests prove the responsive split by class (jsdom cannot evaluate media queries), not a browser run. Not done: the canvas's before/after value diffs in the phone list, because the frozen snapshot carries no live-vs-signed value pair and no diff should be invented; and the model records list, which is MDL-04.1's wide DataTable, not this view.
